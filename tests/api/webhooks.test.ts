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

describe("API: webhooks", () => {
  let h: TestHarness;
  let token: string;

  before(async () => {
    await flushTestDb();
    h = createTestHarness();
    await createUserInStore({
      username: "hookowner",
      email: "hookowner@example.com",
      password: "Password123!",
      tier: "enterprise",
    });
    token = (await loginViaApi(h.api, "hookowner", "Password123!")).accessToken;
  });

  after(async () => {
    h.stop();
    await flushTestDb();
    await closeRedis();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it("should require authentication", async () => {
    const res = await h.api.post("/webhooks").send({ url: "https://example.com/hook" });
    assert.equal(res.status, 401);
  });

  it("should register a webhook", async () => {
    const res = await h.api
      .post("/webhooks")
      .set(auth())
      .send({ url: "https://example.com/hook", events: ["job.completed"], secret: "s3cret" });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.url, "https://example.com/hook");
    assert.equal(res.body.data.secret, "s3cret");
    assert.equal(res.body.data.status, "active");
  });

  it("should reject SSRF webhook URLs with 400", async () => {
    for (const url of [
      "http://localhost:4000/cb",
      "http://127.0.0.1/cb",
      "http://10.0.0.1/cb",
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "ftp://example.com/x",
    ]) {
      const res = await h.api.post("/webhooks").set(auth()).send({ url });
      assert.equal(res.status, 400, `expected 400 for ${url}`);
      assert.equal(res.body.code, "INVALID_WEBHOOK_URL", `expected INVALID_WEBHOOK_URL for ${url}`);
    }
  });

  it("should require a URL", async () => {
    const res = await h.api.post("/webhooks").set(auth()).send({});
    assert.equal(res.status, 400);
  });

  it("should list webhooks", async () => {
    await h.api.post("/webhooks").set(auth()).send({ url: "https://example.com/list" });
    const res = await h.api.get("/webhooks").set(auth());
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);
  });

  it("should get webhook details and forbid others", async () => {
    const created = await h.api.post("/webhooks").set(auth()).send({ url: "https://example.com/detail" });
    const webhookId = created.body.data.id;

    const own = await h.api.get(`/webhooks/${webhookId}`).set(auth());
    assert.equal(own.status, 200);
    assert.equal(own.body.data.id, webhookId);

    await createUserInStore({
      username: "hookstranger",
      email: "hookstranger@example.com",
      password: "Password123!",
    });
    const strangerToken = (await loginViaApi(h.api, "hookstranger", "Password123!")).accessToken;
    const forbidden = await h.api
      .get(`/webhooks/${webhookId}`)
      .set({ Authorization: `Bearer ${strangerToken}` });
    assert.equal(forbidden.status, 403);
  });

  it("should delete a webhook", async () => {
    const created = await h.api.post("/webhooks").set(auth()).send({ url: "https://example.com/delete" });
    const webhookId = created.body.data.id;

    const res = await h.api.delete(`/webhooks/${webhookId}`).set(auth());
    assert.equal(res.status, 200);

    const missing = await h.api.get(`/webhooks/${webhookId}`).set(auth());
    assert.equal(missing.status, 404);
  });

  it("should return delivery history", async () => {
    const created = await h.api.post("/webhooks").set(auth()).send({ url: "https://example.com/deliveries" });
    const res = await h.api.get(`/webhooks/${created.body.data.id}/deliveries`).set(auth());
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
  });
});
