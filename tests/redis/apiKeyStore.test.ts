import "../helpers/env.ts";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  generateApiKey,
  validateApiKey,
  listApiKeys,
  revokeApiKey,
} from "../../src/core/auth/apiKeyStore.ts";
import { createUser } from "../../src/core/auth/userStore.ts";
import { flushTestDb, closeRedis } from "../helpers/redis.ts";

describe("apiKeyStore", () => {
  let userId: string;

  before(async () => {
    await flushTestDb();
    const user = await createUser({
      username: "keyuser",
      email: "keyuser@example.com",
      password: "Password123!",
    });
    userId = user.id;
  });

  after(async () => {
    await flushTestDb();
    await closeRedis();
  });

  it("should generate a key with the sk_live_ prefix", async () => {
    const { key, keyId, name } = await generateApiKey(userId, "CI key");
    assert.ok(key.startsWith("sk_live_"));
    assert.ok(key.length > 30);
    assert.ok(keyId.startsWith("apikey_"));
    assert.equal(name, "CI key");
  });

  it("should validate a valid key and return the user", async () => {
    const { key } = await generateApiKey(userId, "valid");
    const user = await validateApiKey(key);
    assert.equal(user?.id, userId);
  });

  it("should reject invalid or unknown keys", async () => {
    assert.equal(await validateApiKey("sk_live_doesnotexist"), null);
    assert.equal(await validateApiKey("totally-wrong"), null);
    assert.equal(await validateApiKey(""), null);
  });

  it("should list keys without exposing the raw key", async () => {
    await generateApiKey(userId, "listable");
    const keys = await listApiKeys(userId);
    assert.ok(keys.length >= 1);
    for (const k of keys) {
      assert.ok(!("hashedKey" in k), "hashed key must not leak");
      assert.ok(!("key" in k), "raw key must not leak");
      assert.ok(k.name);
      assert.ok(k.keyId);
    }
  });

  it("should revoke a key and invalidate it", async () => {
    const { key, keyId } = await generateApiKey(userId, "revoke-me");
    assert.ok(await validateApiKey(key), "key valid before revoke");

    const revoked = await revokeApiKey(userId, keyId);
    assert.equal(revoked, true);
    assert.equal(await validateApiKey(key), null);
  });

  it("should not allow revoking another user's key", async () => {
    const other = await createUser({
      username: "otherkey",
      email: "otherkey@example.com",
      password: "Password123!",
    });
    const { keyId } = await generateApiKey(other.id, "someone-elses");

    await assert.rejects(revokeApiKey(userId, keyId), /Unauthorized/);
  });
});
