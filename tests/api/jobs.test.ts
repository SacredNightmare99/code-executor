import "../helpers/envMock.ts";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createTestHarness,
  waitForJob,
  createUserInStore,
  loginViaApi,
  type TestHarness,
} from "../helpers/api.ts";
import { flushTestDb, closeRedis } from "../helpers/redis.ts";

describe("API: jobs", () => {
  let h: TestHarness;
  let tokenA: string;
  let tokenB: string;

  before(async () => {
    await flushTestDb();
    h = createTestHarness();

    // Enterprise tier users so the per-user rate limiter doesn't interfere.
    await createUserInStore({
      username: "jobsa",
      email: "jobsa@example.com",
      password: "Password123!",
      tier: "enterprise",
    });
    await createUserInStore({
      username: "jobsb",
      email: "jobsb@example.com",
      password: "Password123!",
      tier: "enterprise",
    });
    tokenA = (await loginViaApi(h.api, "jobsa", "Password123!")).accessToken;
    tokenB = (await loginViaApi(h.api, "jobsb", "Password123!")).accessToken;
  });

  after(async () => {
    h.stop();
    await flushTestDb();
    await closeRedis();
  });

  const authA = () => ({ Authorization: `Bearer ${tokenA}` });
  const authB = () => ({ Authorization: `Bearer ${tokenB}` });

  it("should require authentication to submit", async () => {
    const res = await h.api.post("/submit").send({ language: "python", code: "print(1)" });
    assert.equal(res.status, 401);
  });

  it("should reject unsupported languages with 400", async () => {
    const res = await h.api.post("/submit").set(authA()).send({ language: "rust", code: "fn main() {}" });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "UNSUPPORTED_LANGUAGE");
  });

  it("should reject missing language or code", async () => {
    assert.equal((await h.api.post("/submit").set(authA()).send({ language: "python" })).status, 400);
    assert.equal((await h.api.post("/submit").set(authA()).send({ code: "x" })).status, 400);
  });

  it("should reject oversized code", async () => {
    const res = await h.api
      .post("/submit")
      .set(authA())
      .send({ language: "python", code: "x".repeat(100_001) });
    assert.equal(res.status, 413);
  });

  it("should reject stdin + inputs together", async () => {
    const res = await h.api
      .post("/submit")
      .set(authA())
      .send({ language: "python", code: "print(1)", stdin: "a", inputs: ["b"] });
    assert.equal(res.status, 400);
  });

  it("should reject too many inputs", async () => {
    const res = await h.api
      .post("/submit")
      .set(authA())
      .send({ language: "python", code: "print(1)", inputs: new Array(51).fill("x") });
    assert.equal(res.status, 400);
  });

  it("should execute a python job end-to-end (mock runner)", async () => {
    const submit = await h.api.post("/submit").set(authA()).send({ language: "python", code: "print('hello')" });
    assert.equal(submit.status, 201);
    const jobId = submit.body.data.job_id;
    assert.ok(jobId);

    const result = await waitForJob(h.api, tokenA, jobId);
    assert.equal(result.status, "ACCEPTED");
    assert.equal(result.results[0].stdout, "mock output ()");
  });

  it("should report COMPILE_ERROR from the mock runner", async () => {
    const submit = await h.api.post("/submit").set(authA()).send({ language: "c", code: "compile-error sentinel" });
    const result = await waitForJob(h.api, tokenA, submit.body.data.job_id);
    assert.equal(result.status, "COMPILE_ERROR");
  });

  it("should report TIME_LIMIT_EXCEEDED from the mock runner", async () => {
    const submit = await h.api.post("/submit").set(authA()).send({ language: "python", code: "timeout sentinel" });
    const result = await waitForJob(h.api, tokenA, submit.body.data.job_id);
    assert.equal(result.status, "TIME_LIMIT_EXCEEDED");
  });

  it("should report RUNTIME_ERROR from the mock runner", async () => {
    const submit = await h.api.post("/submit").set(authA()).send({ language: "python", code: "runtime-error sentinel" });
    const result = await waitForJob(h.api, tokenA, submit.body.data.job_id);
    assert.equal(result.status, "RUNTIME_ERROR");
  });

  it("should return per-input results for multi-input submissions", async () => {
    const submit = await h.api
      .post("/submit")
      .set(authA())
      .send({ language: "python", code: "print(1)", inputs: ["a", "b", "c"] });
    assert.equal(submit.status, 201);

    const result = await waitForJob(h.api, tokenA, submit.body.data.job_id);
    assert.equal(result.status, "ACCEPTED");
    assert.equal(result.results.length, 3);
    assert.equal(result.results[1].stdin, "b");
  });

  it("should prevent users from viewing each other's jobs", async () => {
    const submit = await h.api.post("/submit").set(authA()).send({ language: "python", code: "print(1)" });
    const jobId = submit.body.data.job_id;

    const res = await h.api.get(`/result/${jobId}`).set(authB());
    assert.equal(res.status, 403);
  });

  it("should return 404 for unknown jobs", async () => {
    const res = await h.api.get("/result/nonexistent-id").set(authA());
    assert.equal(res.status, 404);
  });

  it("should retrieve code for an own job and forbid others", async () => {
    const code = "print('retrievable')";
    const submit = await h.api.post("/submit").set(authA()).send({ language: "python", code });
    const jobId = submit.body.data.job_id;

    const own = await h.api.get(`/jobs/${jobId}/code`).set(authA());
    assert.equal(own.status, 200);
    assert.equal(own.body.data.code, code);

    const other = await h.api.get(`/jobs/${jobId}/code`).set(authB());
    assert.equal(other.status, 403);
  });

  it("should list and filter a user's jobs", async () => {
    await h.api.post("/submit").set(authA()).send({ language: "python", code: "print(1)" });
    await h.api.post("/submit").set(authA()).send({ language: "c", code: "compile-error sentinel" });

    const res = await h.api.get("/jobs").set(authA());
    assert.equal(res.status, 200);
    assert.ok(res.body.data.jobs.length >= 2);

    const filtered = await h.api.get("/jobs?language=python").set(authA());
    assert.ok(filtered.body.data.jobs.every((j: { language: string }) => j.language === "python"));
  });

  it("should expose languages publicly", async () => {
    const all = await h.api.get("/languages");
    assert.equal(all.status, 200);
    const ids = all.body.data.languages.map((l: { id: string }) => l.id);
    assert.ok(ids.includes("python"));
    assert.ok(ids.includes("c"));
    assert.ok(ids.includes("java"));

    const python = await h.api.get("/languages/python");
    assert.equal(python.status, 200);
    assert.equal(python.body.data.version, "3.12");

    const missing = await h.api.get("/languages/rust");
    assert.equal(missing.status, 404);
  });
});
