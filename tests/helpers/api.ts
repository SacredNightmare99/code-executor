import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app.ts";
import { startWorker } from "../../src/core/workers/executorWorker.ts";
import { createUser, type CreateUserInput } from "../../src/core/auth/userStore.ts";

export interface TestHarness {
  app: Express;
  api: ReturnType<typeof request>;
  stop: () => void;
}

/**
 * Build an in-process app + one real worker (processing jobs from Redis) so
 * tests exercise the full submit -> queue -> worker -> store -> poll pipeline.
 * Call harness.stop() (or use withHarness) to shut the worker down.
 */
export function createTestHarness(): TestHarness {
  const app = createApp();
  const controller = new AbortController();
  startWorker(1, controller.signal);
  return {
    app,
    // The hand-rolled express types aren't callable, so cast for supertest.
    api: request(app as unknown as Parameters<typeof request>[0]),
    stop: () => controller.abort(),
  };
}

/** Create a user directly in the store (bypasses the API/rate limits). */
export async function createUserInStore(input: CreateUserInput) {
  return createUser(input);
}

export interface RegisteredUser {
  user: Record<string, unknown>;
  accessToken: string;
  refreshToken: string;
}

export async function registerViaApi(
  api: ReturnType<typeof request>,
  username: string,
  email: string,
  password: string,
): Promise<RegisteredUser> {
  const res = await api.post("/auth/register").send({ username, email, password });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as RegisteredUser;
}

export async function loginViaApi(
  api: ReturnType<typeof request>,
  username: string,
  password: string,
): Promise<RegisteredUser> {
  const res = await api.post("/auth/login").send({ username, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as RegisteredUser;
}

export const TERMINAL_STATUSES = ["ACCEPTED", "COMPILE_ERROR", "RUNTIME_ERROR", "TIME_LIMIT_EXCEEDED", "MEMORY_LIMIT_EXCEEDED", "SYSTEM_ERROR"];

/**
 * Poll /result/:id until the job reaches a terminal status.
 * Returns the `data` object ({ job_id, status, results?, metrics? }).
 */
export async function waitForJob(
  api: ReturnType<typeof request>,
  token: string,
  jobId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<any> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const intervalMs = opts.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await api.get(`/result/${jobId}`).set("Authorization", `Bearer ${token}`);
    if (res.status === 200 && TERMINAL_STATUSES.includes(res.body?.data?.status)) {
      return res.body.data;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`job ${jobId} did not reach a terminal state within ${timeoutMs}ms`);
}
