import "../helpers/env.ts";
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Express } from "express";
import request from "supertest";
import { rateLimitByUser, rateLimitByIp } from "../../src/middleware/rateLimiter.ts";
import { errorHandler } from "../../src/middleware/errorHandler.ts";
import { flushTestDb, closeRedis } from "../helpers/redis.ts";

function buildUserApp(rateLimit: number): Express {
  const app = express();
  app.get(
    "/",
    (req, _res, next) => {
      (req as { user?: unknown }).user = { id: "ratelimit-user", rateLimit, tier: "test" };
      next();
    },
    rateLimitByUser(),
    (_req, res) => res.json({ ok: true }),
  );
  app.use(errorHandler);
  return app;
}

function buildIpApp(limit: number): Express {
  const app = express();
  app.get("/", rateLimitByIp(limit, 60), (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe("rateLimiter", () => {
  beforeEach(async () => {
    await flushTestDb();
  });

  after(async () => {
    await flushTestDb();
    await closeRedis();
  });

  describe("rateLimitByUser", () => {
    it("should allow requests up to the limit", async () => {
      const api = request(buildUserApp(3) as never);
      for (let i = 0; i < 3; i++) {
        const res = await api.get("/");
        assert.equal(res.status, 200);
      }
    });

    it("should return 429 once the limit is exceeded", async () => {
      const api = request(buildUserApp(2) as never);
      await api.get("/");
      await api.get("/");
      const res = await api.get("/");
      assert.equal(res.status, 429);
      assert.equal(res.body.code, "RATE_LIMIT_EXCEEDED");
    });

    it("should return rate limit headers", async () => {
      const api = request(buildUserApp(5) as never);
      const res = await api.get("/");
      assert.equal(res.headers["x-ratelimit-limit"], "5");
      assert.equal(res.headers["x-ratelimit-remaining"], "4");
      assert.ok(res.headers["x-ratelimit-reset"]);
    });
  });

  describe("rateLimitByIp", () => {
    it("should allow requests up to the limit", async () => {
      const api = request(buildIpApp(2) as never);
      assert.equal((await api.get("/")).status, 200);
      assert.equal((await api.get("/")).status, 200);
    });

    it("should return 429 with Retry-After once exceeded", async () => {
      const api = request(buildIpApp(1) as never);
      await api.get("/");
      const res = await api.get("/");
      assert.equal(res.status, 429);
      assert.ok(res.headers["retry-after"]);
    });
  });
});
