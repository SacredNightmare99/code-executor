import "../helpers/envMock.ts";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness, type TestHarness } from "../helpers/api.ts";
import { flushTestDb, closeRedis } from "../helpers/redis.ts";

describe("API: monitoring", () => {
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

  it("should report healthy when Redis is reachable", async () => {
    const res = await h.api.get("/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "healthy");
    assert.ok(res.body.uptime >= 0);
    assert.ok(res.body.timestamp);
  });

  it("should expose a status summary", async () => {
    const res = await h.api.get("/status");
    assert.equal(res.status, 200);
    assert.ok(res.body.jobs);
    assert.ok(res.body.execution);
    assert.ok(res.body.queue);
    assert.ok(res.body.workers);
    assert.ok(res.body.system);
    assert.equal(res.body.system.redis_connected, true);
  });

  it("should expose Prometheus-format metrics", async () => {
    const res = await h.api.get("/metrics");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"] as string, /text\/plain/);

    const text = res.text;
    for (const metric of [
      "code_executor_jobs_submitted",
      "code_executor_jobs_completed",
      "code_executor_execution_time_ms",
      "code_executor_queue_size",
      "code_executor_redis_connected",
      "code_executor_uptime_seconds",
      "code_executor_memory_mb",
    ]) {
      assert.ok(text.includes(metric), `missing metric ${metric}`);
    }
  });
});
