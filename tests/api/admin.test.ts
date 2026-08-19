import "../helpers/envMock.ts";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createTestHarness,
  createUserInStore,
  loginViaApi,
  type TestHarness,
} from "../helpers/api.ts";
import { flushTestDb, closeRedis } from "../helpers/redis.ts";

describe("API: admin", () => {
  let h: TestHarness;
  let adminToken: string;
  let userToken: string;
  let userId: string;

  before(async () => {
    await flushTestDb();
    h = createTestHarness();

    await createUserInStore({
      username: "rootadmin",
      email: "rootadmin@example.com",
      password: "Password123!",
      tier: "enterprise",
      role: "admin",
    });
    const user = await createUserInStore({
      username: "pleb",
      email: "pleb@example.com",
      password: "Password123!",
      tier: "free",
    });
    userId = user.id;

    adminToken = (await loginViaApi(h.api, "rootadmin", "Password123!")).accessToken;
    userToken = (await loginViaApi(h.api, "pleb", "Password123!")).accessToken;
  });

  after(async () => {
    h.stop();
    await flushTestDb();
    await closeRedis();
  });

  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
  const userAuth = () => ({ Authorization: `Bearer ${userToken}` });

  it("should deny non-admins", async () => {
    const res = await h.api.get("/admin/users").set(userAuth());
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "FORBIDDEN_ADMIN_ONLY");
  });

  it("should upgrade a user's tier and rate limit", async () => {
    const res = await h.api
      .post(`/admin/users/${userId}/upgrade`)
      .set(adminAuth())
      .send({ newTier: "professional" });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.tier, "professional");
    assert.equal(res.body.data.user.rateLimit, 100);
  });

  it("should reject invalid tiers", async () => {
    const res = await h.api
      .post(`/admin/users/${userId}/upgrade`)
      .set(adminAuth())
      .send({ newTier: "mega" });
    assert.equal(res.status, 400);
  });

  it("should view user details", async () => {
    const res = await h.api.get(`/admin/users/${userId}`).set(adminAuth());
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.username, "pleb");
    assert.ok(!("passwordHash" in res.body.data.user));
  });

  it("should list users", async () => {
    const res = await h.api.get("/admin/users").set(adminAuth());
    assert.equal(res.status, 200);
    assert.ok(res.body.data.total >= 2);
  });

  it("should make a user admin and revoke it", async () => {
    const make = await h.api.post(`/admin/users/${userId}/make-admin`).set(adminAuth());
    assert.equal(make.status, 200);
    assert.equal(make.body.data.user.role, "admin");

    const revoke = await h.api.post(`/admin/users/${userId}/revoke-admin`).set(adminAuth());
    assert.equal(revoke.status, 200);
    assert.equal(revoke.body.data.user.role, "user");
  });

  it("should prevent an admin from changing their own role", async () => {
    const adminId = (await createUserInStore({
      username: "selfadmin",
      email: "selfadmin@example.com",
      password: "Password123!",
      role: "admin",
    })).id;

    const res = await h.api.post(`/admin/users/${adminId}/make-admin`).set(adminAuth());
    assert.equal(res.status, 400);
  });

  it("should delete a user", async () => {
    const doomed = await createUserInStore({
      username: "doomed",
      email: "doomed@example.com",
      password: "Password123!",
    });

    const res = await h.api.delete(`/admin/users/${doomed.id}`).set(adminAuth());
    assert.equal(res.status, 200);
    assert.equal(res.body.data.deleted, true);
  });
});
