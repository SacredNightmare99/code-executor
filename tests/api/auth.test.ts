import "../helpers/envMock.ts";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness, registerViaApi, loginViaApi, type TestHarness } from "../helpers/api.ts";
import { flushTestDb, closeRedis } from "../helpers/redis.ts";

describe("API: auth", () => {
  let h: TestHarness;

  before(async () => {
    await flushTestDb();
    h = createTestHarness();
  });

  after(async () => {
    h.stop();
    await flushTestDb();
    await closeRedis();
  });

  it("should register a user and return tokens", async () => {
    const res = await h.api.post("/auth/register").send({
      username: "newuser",
      email: "newuser@example.com",
      password: "Password123!",
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.username, "newuser");
    assert.equal(res.body.data.user.tier, "free");
    assert.ok(res.body.data.accessToken);
    assert.ok(res.body.data.refreshToken);
    assert.ok(!("passwordHash" in res.body.data.user));
  });

  it("should reject registration with invalid input", async () => {
    assert.equal((await h.api.post("/auth/register").send({})).status, 400);
    assert.equal(
      (await h.api.post("/auth/register").send({ username: "ab", email: "x@y.com", password: "Password123!" })).status,
      400,
    );
    assert.equal(
      (await h.api.post("/auth/register").send({ username: "validname", email: "x@y.com", password: "short" })).status,
      400,
    );
    assert.equal(
      (await h.api.post("/auth/register").send({ username: "validname", email: "notanemail", password: "Password123!" }))
        .status,
      400,
    );
  });

  it("should reject duplicate registration", async () => {
    const res = await h.api.post("/auth/register").send({
      username: "dupuser",
      email: "dup@example.com",
      password: "Password123!",
    });
    assert.equal(res.status, 201);
    const dup = await h.api.post("/auth/register").send({
      username: "dupuser",
      email: "other@example.com",
      password: "Password123!",
    });
    assert.equal(dup.status, 409);
  });

  it("should login with username or email", async () => {
    await registerViaApi(h.api, "loginuser", "login@example.com", "Password123!");

    const byUsername = await loginViaApi(h.api, "loginuser", "Password123!");
    assert.ok(byUsername.accessToken);

    const byEmail = await loginViaApi(h.api, "login@example.com", "Password123!");
    assert.ok(byEmail.accessToken);
  });

  it("should reject invalid credentials", async () => {
    await registerViaApi(h.api, "badpassuser", "badpass@example.com", "Password123!");
    const res = await h.api.post("/auth/login").send({ username: "badpassuser", password: "wrong" });
    assert.equal(res.status, 401);
  });

  it("should reject unauthenticated /auth/me", async () => {
    const res = await h.api.get("/auth/me");
    assert.equal(res.status, 401);
  });

  it("should return the current user", async () => {
    const { accessToken } = await registerViaApi(h.api, "meperson", "me@example.com", "Password123!");
    const res = await h.api.get("/auth/me").set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.username, "meperson");
  });

  it("should refresh the access token", async () => {
    const { refreshToken } = await registerViaApi(h.api, "refreshperson", "refresh@example.com", "Password123!");
    const res = await h.api.post("/auth/refresh").send({ refreshToken });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.accessToken);
  });

  it("should reject a revoked refresh token after logout", async () => {
    const { refreshToken } = await registerViaApi(h.api, "logoutperson", "logout@example.com", "Password123!");

    const logout = await h.api.post("/auth/logout").send({ refreshToken });
    assert.equal(logout.status, 200);

    const refresh = await h.api.post("/auth/refresh").send({ refreshToken });
    assert.equal(refresh.status, 401);
  });

  it("should keep the access token valid after logout", async () => {
    const { accessToken, refreshToken } = await registerViaApi(h.api, "logoutkeep", "logoutkeep@example.com", "Password123!");
    await h.api.post("/auth/logout").send({ refreshToken });

    const me = await h.api.get("/auth/me").set("Authorization", `Bearer ${accessToken}`);
    assert.equal(me.status, 200);
  });

  it("should log out from all devices", async () => {
    const { refreshToken, accessToken } = await registerViaApi(h.api, "logoutall", "logoutall@example.com", "Password123!");
    const res = await h.api.post("/auth/logout-all").set("Authorization", `Bearer ${accessToken}`).send({});
    assert.equal(res.status, 200);

    const refresh = await h.api.post("/auth/refresh").send({ refreshToken });
    assert.equal(refresh.status, 401);
  });

  it("should change the password and revoke sessions", async () => {
    const { accessToken, refreshToken } = await registerViaApi(h.api, "pwuser", "pw@example.com", "Password123!");

    const change = await h.api
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: "Password123!", newPassword: "NewPassword456!" });
    assert.equal(change.status, 200);

    // Old refresh token must be revoked.
    const refresh = await h.api.post("/auth/refresh").send({ refreshToken });
    assert.equal(refresh.status, 401);

    // New password works.
    const login = await loginViaApi(h.api, "pwuser", "NewPassword456!");
    assert.ok(login.accessToken);
  });

  it("should manage API keys", async () => {
    const { accessToken } = await registerViaApi(h.api, "apikeyowner", "apikey@example.com", "Password123!");

    const created = await h.api
      .post("/auth/api-keys")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "ci key" });
    assert.equal(created.status, 201);
    assert.ok(created.body.data.key.startsWith("sk_live_"));

    const listed = await h.api.get("/auth/api-keys").set("Authorization", `Bearer ${accessToken}`);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.data.keys.length >= 1);
    assert.ok(!("key" in listed.body.data.keys[0]));

    const revoked = await h.api
      .delete(`/auth/api-keys/${created.body.data.keyId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(revoked.status, 200);
  });

  it("should delete the account", async () => {
    const { accessToken } = await registerViaApi(h.api, "delme", "delme@example.com", "Password123!");
    const res = await h.api.delete("/auth/me").set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.deleted, true);

    const login = await h.api.post("/auth/login").send({ username: "delme", password: "Password123!" });
    assert.equal(login.status, 401);
  });
});
