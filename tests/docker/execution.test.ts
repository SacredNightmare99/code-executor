import "../helpers/env.ts";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import {
  createTestHarness,
  waitForJob,
  createUserInStore,
  loginViaApi,
  type TestHarness,
} from "../helpers/api.ts";
import { flushTestDb, closeRedis } from "../helpers/redis.ts";

function hasDockerImage(image: string): boolean {
  try {
    execFileSync("docker", ["image", "inspect", image], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const IMAGES = ["runner-py", "runner-c", "runner-java", "runner-runtime"];
// Gated: only runs when RUN_DOCKER_TESTS=1 AND the runner images exist.
const IMAGES_AVAILABLE = process.env.RUN_DOCKER_TESTS === "1" && IMAGES.every(hasDockerImage);

describe("Docker sandbox e2e", { skip: !IMAGES_AVAILABLE }, () => {
  let h: TestHarness;
  let token: string;

  before(async () => {
    await flushTestDb();
    h = createTestHarness();
    await createUserInStore({
      username: "dockuser",
      email: "dockuser@example.com",
      password: "Password123!",
      tier: "enterprise",
    });
    token = (await loginViaApi(h.api, "dockuser", "Password123!")).accessToken;
  });

  after(async () => {
    h.stop();
    await flushTestDb();
    await closeRedis();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it("should run Python and capture stdout", async () => {
    const submit = await h.api
      .post("/submit")
      .set(auth())
      .send({ language: "python", code: "print('hello docker')" });
    assert.equal(submit.status, 201);

    const result = await waitForJob(h.api, token, submit.body.data.job_id, { timeoutMs: 20000 });
    assert.equal(result.status, "ACCEPTED");
    assert.match(result.results[0].stdout, /hello docker/);
  });

  it("should compile and run C", async () => {
    const code = "#include <stdio.h>\nint main() { printf(\"hello c\"); return 0; }";
    const submit = await h.api.post("/submit").set(auth()).send({ language: "c", code });
    assert.equal(submit.status, 201);

    const result = await waitForJob(h.api, token, submit.body.data.job_id, { timeoutMs: 30000 });
    assert.equal(result.status, "ACCEPTED");
    assert.match(result.results[0].stdout, /hello c/);
  });

  it("should compile and run Java 21", async () => {
    const code = "public class Main { public static void main(String[] a) { System.out.println(\"hello java\"); } }";
    const submit = await h.api.post("/submit").set(auth()).send({ language: "java", code });
    assert.equal(submit.status, 201);

    const result = await waitForJob(h.api, token, submit.body.data.job_id, { timeoutMs: 40000 });
    assert.equal(result.status, "ACCEPTED");
    assert.match(result.results[0].stdout, /hello java/);
  });

  it("should detect C compile errors", async () => {
    const submit = await h.api
      .post("/submit")
      .set(auth())
      .send({ language: "c", code: "int main( { return 0; }" });
    const result = await waitForJob(h.api, token, submit.body.data.job_id, { timeoutMs: 30000 });
    assert.equal(result.status, "COMPILE_ERROR");
  });

  it("should detect Python runtime errors", async () => {
    const submit = await h.api.post("/submit").set(auth()).send({ language: "python", code: "print(1 / 0)" });
    const result = await waitForJob(h.api, token, submit.body.data.job_id, { timeoutMs: 20000 });
    assert.equal(result.status, "RUNTIME_ERROR");
    assert.match(result.results[0].stderr, /ZeroDivisionError/);
  });

  it("should pass stdin to Python", async () => {
    const submit = await h.api
      .post("/submit")
      .set(auth())
      .send({ language: "python", code: "import sys; print(sys.stdin.read())", stdin: "world" });
    const result = await waitForJob(h.api, token, submit.body.data.job_id, { timeoutMs: 20000 });
    assert.equal(result.status, "ACCEPTED");
    assert.match(result.results[0].stdout, /world/);
  });

  it("should enforce the execution timeout", async () => {
    const submit = await h.api
      .post("/submit")
      .set(auth())
      .send({ language: "python", code: "import time; time.sleep(10)" });
    const result = await waitForJob(h.api, token, submit.body.data.job_id, { timeoutMs: 20000 });
    assert.equal(result.status, "TIME_LIMIT_EXCEEDED");
  });
});
