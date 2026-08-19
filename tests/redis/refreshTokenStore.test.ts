import "../helpers/env.ts";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  storeRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
} from "../../src/core/auth/refreshTokenStore.ts";
import { createUser } from "../../src/core/auth/userStore.ts";
import { flushTestDb, closeRedis } from "../helpers/redis.ts";

describe("refreshTokenStore", () => {
  let userId: string;

  before(async () => {
    await flushTestDb();
    const user = await createUser({
      username: "rtuser",
      email: "rtuser@example.com",
      password: "Password123!",
    });
    userId = user.id;
  });

  after(async () => {
    await flushTestDb();
    await closeRedis();
  });

  it("should store and validate a refresh token", async () => {
    await storeRefreshToken("token-a", userId, "device-1");
    const data = await validateRefreshToken("token-a");
    assert.equal(data?.userId, userId);
    assert.equal(data?.deviceInfo, "device-1");
  });

  it("should return null for unknown tokens", async () => {
    assert.equal(await validateRefreshToken("unknown-token"), null);
  });

  it("should revoke a single token", async () => {
    await storeRefreshToken("token-b", userId, "device-2");
    assert.ok(await validateRefreshToken("token-b"));

    await revokeRefreshToken("token-b");
    assert.equal(await validateRefreshToken("token-b"), null);
  });

  it("should revoke all tokens for a user", async () => {
    await storeRefreshToken("token-c1", userId, "device-1");
    await storeRefreshToken("token-c2", userId, "device-2");

    await revokeAllUserRefreshTokens(userId);

    assert.equal(await validateRefreshToken("token-c1"), null);
    assert.equal(await validateRefreshToken("token-c2"), null);
  });
});
