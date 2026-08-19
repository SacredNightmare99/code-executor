import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createConfig, parseTimeToSeconds, resolveJwtSecret } from "../../src/config/index.ts";

describe("Config utilities", () => {
  describe("parseTimeToSeconds", () => {
    it("should parse seconds", () => {
      assert.equal(parseTimeToSeconds("30s"), 30);
    });

    it("should parse minutes", () => {
      assert.equal(parseTimeToSeconds("15m"), 900);
    });

    it("should parse hours", () => {
      assert.equal(parseTimeToSeconds("2h"), 7200);
    });

    it("should parse days", () => {
      assert.equal(parseTimeToSeconds("7d"), 604800);
    });

    it("should return default (7 days) for invalid format", () => {
      assert.equal(parseTimeToSeconds("invalid"), 604800);
      assert.equal(parseTimeToSeconds(""), 604800);
      assert.equal(parseTimeToSeconds("15x"), 604800);
    });

    it("should handle single-digit values", () => {
      assert.equal(parseTimeToSeconds("1s"), 1);
      assert.equal(parseTimeToSeconds("1m"), 60);
      assert.equal(parseTimeToSeconds("1h"), 3600);
      assert.equal(parseTimeToSeconds("1d"), 86400);
    });
  });

  describe("resolveJwtSecret", () => {
    it("should allow a provided secret", () => {
      assert.equal(resolveJwtSecret({ JWT_SECRET: "abc123" }), "abc123");
    });

    it("should fall back to the default in development", () => {
      const secret = resolveJwtSecret({});
      assert.equal(secret, "change-this-secret-in-production");
    });

    it("should throw in production without a secret", () => {
      assert.throws(() => resolveJwtSecret({ NODE_ENV: "production" }), /JWT_SECRET/);
    });

    it("should throw in production with the default secret", () => {
      assert.throws(
        () => resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: "change-this-secret-in-production" }),
        /JWT_SECRET/,
      );
    });

    it("should allow a strong secret in production", () => {
      assert.equal(resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: "super-secure-1" }), "super-secure-1");
    });
  });

  describe("createConfig", () => {
    it("should apply defaults", () => {
      const config = createConfig({});
      assert.equal(config.port, 4000);
      assert.equal(config.workerCount, 1);
      assert.equal(config.maxConcurrent, 2);
      assert.equal(config.maxQueue, 200);
      assert.equal(config.sandbox.memoryLimit, "128m");
      assert.equal(config.runnerMode, "docker");
      assert.equal(config.authRegisterLimit, 10);
      assert.equal(config.authLoginLimit, 20);
      assert.equal(config.isProduction, false);
    });

    it("should read values from env", () => {
      const config = createConfig({
        PORT: "8080",
        WORKERS: "3",
        MAX_CONCURRENT: "5",
        MAX_QUEUE: "50",
        SANDBOX_MEMORY: "256m",
        NODE_ENV: "production",
        JWT_SECRET: "strong-secret",
      });
      assert.equal(config.port, 8080);
      assert.equal(config.workerCount, 3);
      assert.equal(config.maxConcurrent, 5);
      assert.equal(config.maxQueue, 50);
      assert.equal(config.sandbox.memoryLimit, "256m");
      assert.equal(config.isProduction, true);
    });

    it("should parse runner mode", () => {
      assert.equal(createConfig({ RUNNER_MODE: "mock" }).runnerMode, "mock");
      assert.equal(createConfig({ RUNNER_MODE: "anything" }).runnerMode, "docker");
      assert.equal(createConfig({}).runnerMode, "docker");
    });

    it("should read auth rate limits", () => {
      const config = createConfig({ AUTH_REGISTER_LIMIT: "100", AUTH_LOGIN_LIMIT: "200" });
      assert.equal(config.authRegisterLimit, 100);
      assert.equal(config.authLoginLimit, 200);
    });

    it("should throw for invalid numeric env values", () => {
      assert.throws(() => createConfig({ PORT: "not-a-number" }), /PORT/);
    });
  });
});
