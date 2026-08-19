import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Exercise the PRODUCTION error-handling path (no internal message leaks).
// Imported first so its env is set before any src module loads.
import "../helpers/envProd.ts";

import express from "express";
import type { Express } from "express";
import request from "supertest";
import { errorHandler } from "../../src/middleware/errorHandler.ts";
import { ApiError } from "../../src/utils/apiError.ts";

function buildApp(): Express {
  const app = express();
  app.get("/boom", (_req, _res) => {
    throw new Error("secret internal detail");
  });
  app.get("/api-error", (_req, _res) => {
    throw new ApiError(400, "Bad request", "BAD_REQUEST");
  });
  app.get("/server-error-coded", (_req, _res) => {
    throw new ApiError(500, "Upstream exploded", "UPSTREAM_ERROR");
  });
  app.use(errorHandler);
  return app;
}

describe("errorHandler", () => {
  it("should return 500 with INTERNAL_ERROR for unexpected errors", async () => {
    const res = await request(buildApp() as never).get("/boom");
    assert.equal(res.status, 500);
    assert.equal(res.body.success, false);
    // Internal detail must NOT leak in production.
    assert.equal(res.body.error, "Internal server error");
    assert.equal(res.body.code, "INTERNAL_ERROR");
  });

  it("should preserve ApiError status and code", async () => {
    const res = await request(buildApp() as never).get("/api-error");
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, "BAD_REQUEST");
    assert.equal(res.body.error, "Bad request");
  });

  it("should preserve coded 500 ApiErrors", async () => {
    const res = await request(buildApp() as never).get("/server-error-coded");
    assert.equal(res.status, 500);
    assert.equal(res.body.code, "UPSTREAM_ERROR");
    assert.equal(res.body.error, "Upstream exploded");
  });
});
