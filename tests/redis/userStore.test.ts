import "../helpers/env.ts";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createUser,
  getUserById,
  getUserByUsername,
  getUserByEmail,
  updateUser,
  deleteUser,
  validatePassword,
  hashPassword,
} from "../../src/core/auth/userStore.ts";
import { flushTestDb, closeRedis } from "../helpers/redis.ts";

describe("userStore", () => {
  before(async () => {
    await flushTestDb();
  });

  after(async () => {
    await flushTestDb();
    await closeRedis();
  });

  it("should create a user and return a sanitized record", async () => {
    const user = await createUser({
      username: "alice",
      email: "alice@example.com",
      password: "Password123!",
    });

    assert.ok(user.id);
    assert.equal(user.username, "alice");
    assert.equal(user.email, "alice@example.com");
    assert.equal(user.tier, "free");
    assert.equal(user.role, "user");
    assert.equal(user.rateLimit, 10);
    assert.ok(!("passwordHash" in user), "passwordHash must not leak");
  });

  it("should reject duplicate usernames", async () => {
    await assert.rejects(
      createUser({ username: "alice", email: "alice2@example.com", password: "Password123!" }),
      /already exists/,
    );
  });

  it("should reject duplicate emails", async () => {
    await assert.rejects(
      createUser({ username: "bob", email: "alice@example.com", password: "Password123!" }),
      /already exists/,
    );
  });

  it("should look up users by id, username, and email", async () => {
    const created = await createUser({
      username: "carol",
      email: "carol@example.com",
      password: "Password123!",
    });

    const byId = await getUserById(created.id);
    assert.equal(byId?.username, "carol");

    const byUsername = await getUserByUsername("carol");
    assert.equal(byUsername?.id, created.id);

    const byEmail = await getUserByEmail("carol@example.com");
    assert.equal(byEmail?.id, created.id);
  });

  it("should return null for unknown users", async () => {
    assert.equal(await getUserById("user_missing"), null);
    assert.equal(await getUserByUsername("nobody"), null);
    assert.equal(await getUserByEmail("nobody@example.com"), null);
  });

  it("should validate passwords", async () => {
    const created = await createUser({
      username: "dave",
      email: "dave@example.com",
      password: "CorrectHorse",
    });
    const user = await getUserById(created.id);
    assert.ok(user, "user should exist");
    assert.equal(await validatePassword(user, "CorrectHorse"), true);
    assert.equal(await validatePassword(user, "wrong"), false);
  });

  it("should update username and maintain indexes", async () => {
    const user = await createUser({
      username: "erin",
      email: "erin@example.com",
      password: "Password123!",
    });

    const updated = await updateUser(user.id, { username: "erin2" });
    assert.equal(updated.username, "erin2");
    assert.equal(await getUserByUsername("erin"), null);
    assert.equal((await getUserByUsername("erin2"))?.id, user.id);
  });

  it("should reject username collisions on update", async () => {
    const a = await createUser({ username: "frank", email: "frank@example.com", password: "Password123!" });
    await createUser({ username: "george", email: "george@example.com", password: "Password123!" });

    await assert.rejects(updateUser(a.id, { username: "george" }), /already exists/);
  });

  it("should update tier and rate limit", async () => {
    const user = await createUser({
      username: "heidi",
      email: "heidi@example.com",
      password: "Password123!",
    });
    const updated = await updateUser(user.id, { tier: "enterprise", rateLimit: 500 });
    assert.equal(updated.tier, "enterprise");
    assert.equal(updated.rateLimit, 500);
  });

  it("should hash passwords with bcrypt", async () => {
    const hash = await hashPassword("Secret123");
    assert.notEqual(hash, "Secret123");
    assert.ok(hash.startsWith("$2"));
  });

  it("should delete a user and their indexes", async () => {
    const user = await createUser({
      username: "ivan",
      email: "ivan@example.com",
      password: "Password123!",
    });

    assert.equal(await deleteUser(user.id), true);
    assert.equal(await getUserById(user.id), null);
    assert.equal(await getUserByUsername("ivan"), null);
    assert.equal(await getUserByEmail("ivan@example.com"), null);
  });
});
