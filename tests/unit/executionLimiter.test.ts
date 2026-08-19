import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ExecutionLimiter } from "../../src/core/limits/executionLimiter.ts";

describe("ExecutionLimiter", () => {
  describe("constructor", () => {
    it("should set max concurrent", () => {
      const limiter = new ExecutionLimiter(5);
      assert.equal(limiter.max, 5);
    });

    it("should set max queue with default", () => {
      const limiter = new ExecutionLimiter(5);
      assert.equal(limiter.maxQueue, 1000);
    });

    it("should set custom max queue", () => {
      const limiter = new ExecutionLimiter(5, 50);
      assert.equal(limiter.maxQueue, 50);
    });
  });

  describe("run", () => {
    it("should execute task immediately when under limit", async () => {
      const limiter = new ExecutionLimiter(2);
      const result = await limiter.run(() => 42);
      assert.equal(result, 42);
    });

    it("should return task result", async () => {
      const limiter = new ExecutionLimiter(2);
      const result = await limiter.run(async () => "hello");
      assert.equal(result, "hello");
    });

    it("should track running count", async () => {
      const limiter = new ExecutionLimiter(2);
      let observed = 0;
      await limiter.run(() => {
        observed = limiter.running;
      });
      assert.equal(observed, 1);
      assert.equal(limiter.running, 0); // should decrement after
    });

    it("should queue tasks when at max concurrent", async () => {
      const limiter = new ExecutionLimiter(1);
      const order: string[] = [];

      const p1 = limiter.run(async () => {
        order.push("first-start");
        await new Promise((r) => setTimeout(r, 50));
        order.push("first-end");
        return 1;
      });

      const p2 = limiter.run(async () => {
        order.push("second-start");
        return 2;
      });

      const [r1, r2] = await Promise.all([p1, p2]);

      assert.equal(r1, 1);
      assert.equal(r2, 2);
      assert.equal(order[0], "first-start");
      assert.equal(order[1], "first-end");
      assert.equal(order[2], "second-start");
    });

    it("should reject when queue is full", async () => {
      const limiter = new ExecutionLimiter(1, 1);

      // Fill the concurrency slot
      const blocker = limiter.run(() => new Promise((r) => setTimeout(r, 200)));

      // Fill the queue
      const queued = limiter.run(() => "queued");

      // This should fail — queue is full
      await assert.rejects(() => limiter.run(() => "rejected"), {
        message: "Queue full",
      });

      await Promise.all([blocker, queued]);
    });

    it("should handle task errors without breaking the limiter", async () => {
      const limiter = new ExecutionLimiter(2);

      await assert.rejects(
        () =>
          limiter.run(() => {
            throw new Error("task failed");
          }),
        { message: "task failed" },
      );

      // Limiter should still work
      assert.equal(limiter.running, 0);
      const result = await limiter.run(() => "ok");
      assert.equal(result, "ok");
    });

    it("should preserve FIFO ordering when multiple tasks queue", async () => {
      const limiter = new ExecutionLimiter(1, 10);
      const order: number[] = [];

      const blocker = limiter.run(async () => {
        await new Promise((r) => setTimeout(r, 30));
        return 0;
      });

      const tasks = [1, 2, 3].map((n) =>
        limiter.run(async () => {
          order.push(n);
          return n;
        }),
      );

      await Promise.all([blocker, ...tasks]);
      assert.deepEqual(order, [1, 2, 3]);
    });
  });
});
