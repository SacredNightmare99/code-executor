import "../helpers/env.ts";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createWebhook,
  getWebhook,
  getUserWebhooks,
  deleteWebhook,
  updateWebhookStatus,
  incrementFailedAttempts,
  resetFailedAttempts,
  recordWebhookDelivery,
  getWebhookDeliveries,
  WEBHOOK_STATUS,
} from "../../src/core/webhooks/webhookStore.ts";
import { flushTestDb, closeRedis } from "../helpers/redis.ts";

const USER_ID = "webhook-user-1";

describe("webhookStore", () => {
  before(async () => {
    await flushTestDb();
  });

  after(async () => {
    await flushTestDb();
    await closeRedis();
  });

  it("should create a webhook with a public URL", async () => {
    const webhook = await createWebhook(USER_ID, "https://example.com/hook", { events: ["job.completed"] });
    assert.equal(webhook.userId, USER_ID);
    assert.equal(webhook.url, "https://example.com/hook");
    assert.equal(webhook.status, WEBHOOK_STATUS.ACTIVE);
    assert.deepEqual(webhook.events, ["job.completed"]);
  });

  it("should reject malformed URLs", async () => {
    await assert.rejects(createWebhook(USER_ID, "not-a-url"), /Invalid webhook URL/);
  });

  it("should reject non-http(s) schemes (SSRF)", async () => {
    await assert.rejects(createWebhook(USER_ID, "file:///etc/passwd"), /Invalid webhook URL/);
    await assert.rejects(createWebhook(USER_ID, "ftp://example.com/x"), /Invalid webhook URL/);
  });

  it("should reject localhost and private URLs (SSRF)", async () => {
    await assert.rejects(createWebhook(USER_ID, "http://localhost:4000/cb"), /Invalid webhook URL/);
    await assert.rejects(createWebhook(USER_ID, "http://127.0.0.1:4000/cb"), /Invalid webhook URL/);
    await assert.rejects(createWebhook(USER_ID, "http://10.0.0.1/cb"), /Invalid webhook URL/);
    await assert.rejects(createWebhook(USER_ID, "http://192.168.1.1/cb"), /Invalid webhook URL/);
    await assert.rejects(createWebhook(USER_ID, "http://169.254.169.254/latest/meta-data/"), /Invalid webhook URL/);
  });

  it("should retrieve a webhook by id", async () => {
    const webhook = await createWebhook(USER_ID, "https://example.com/get");
    const found = await getWebhook(webhook.id);
    assert.equal(found?.id, webhook.id);
  });

  it("should list a user's webhooks", async () => {
    await createWebhook(USER_ID, "https://example.com/list1");
    await createWebhook(USER_ID, "https://example.com/list2");
    const webhooks = await getUserWebhooks(USER_ID);
    assert.ok(webhooks.length >= 2);
  });

  it("should prevent deleting another user's webhook", async () => {
    const webhook = await createWebhook("someone-else", "https://example.com/x");
    await assert.rejects(deleteWebhook(USER_ID, webhook.id), /Unauthorized/);
  });

  it("should delete a webhook", async () => {
    const webhook = await createWebhook(USER_ID, "https://example.com/delete");
    assert.equal(await deleteWebhook(USER_ID, webhook.id), true);
    assert.equal(await getWebhook(webhook.id), null);
  });

  it("should update webhook status", async () => {
    const webhook = await createWebhook(USER_ID, "https://example.com/status");
    await updateWebhookStatus(webhook.id, WEBHOOK_STATUS.INACTIVE);
    const updated = await getWebhook(webhook.id);
    assert.equal(updated?.status, WEBHOOK_STATUS.INACTIVE);
  });

  it("should auto-disable a webhook after 10 failed attempts", async () => {
    const webhook = await createWebhook(USER_ID, "https://example.com/fails");
    for (let i = 0; i < 10; i++) {
      await incrementFailedAttempts(webhook.id);
    }
    const updated = await getWebhook(webhook.id);
    assert.equal(updated?.status, WEBHOOK_STATUS.FAILED);
    assert.equal(updated?.failed_attempts, 10);
  });

  it("should reset failed attempts on success", async () => {
    const webhook = await createWebhook(USER_ID, "https://example.com/reset");
    await incrementFailedAttempts(webhook.id);
    await resetFailedAttempts(webhook.id);
    const updated = await getWebhook(webhook.id);
    assert.equal(updated?.failed_attempts, 0);
    assert.equal(updated?.status, WEBHOOK_STATUS.ACTIVE);
  });

  it("should record and list deliveries", async () => {
    const webhook = await createWebhook(USER_ID, "https://example.com/deliveries");
    await recordWebhookDelivery(webhook.id, { success: true, status: 200, attempts: 1 });
    await recordWebhookDelivery(webhook.id, { success: false, attempts: 3, error: "boom" });

    const deliveries = await getWebhookDeliveries(webhook.id, 10);
    assert.equal(deliveries.length, 2);
    assert.ok(deliveries.some((d) => d.success));
    assert.ok(deliveries.some((d) => !d.success));
  });
});
