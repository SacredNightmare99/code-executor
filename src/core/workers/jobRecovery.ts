import { redis } from "../../infrastructure/redis/redisClient.ts";
import config from "../../config/index.ts";
import { JobStatus, type JobRecord } from "../jobs/jobTypes.ts";
import { enqueueJob, requeueProcessingJobs } from "../jobs/jobQueue.ts";
import { updateJob } from "../jobs/jobStore.ts";

const SCAN_COUNT = 200;
const SWEEP_INTERVAL_MS = 30_000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseJob(data: string): JobRecord | null {
  try {
    const job = JSON.parse(data) as JobRecord;
    return job && typeof job.id === "string" && typeof job.status === "string" ? job : null;
  } catch {
    return null;
  }
}

async function scanJobs(): Promise<JobRecord[]> {
  const jobs: JobRecord[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      "job:*",
      "COUNT",
      String(SCAN_COUNT),
    );
    cursor = next;
    for (const key of keys) {
      // The pattern `job:*` also matches `jobs:queue` / `jobs:processing`.
      if (key.startsWith("jobs:")) continue;
      const data = await redis.get(key);
      if (data) {
        const job = parseJob(data);
        if (job) jobs.push(job);
      }
    }
  } while (cursor !== "0");
  return jobs;
}

/**
 * Recover jobs that were in-flight when the process (re)started.
 *
 * Two sources of loss are handled:
 *  1. Job ids still in the processing list (worker crashed after dequeue).
 *  2. Jobs whose status is RUNNING (worker crashed after marking RUNNING).
 * Both are returned to the queue so a fresh worker re-processes them.
 */
export async function recoverInFlightJobs(): Promise<number> {
  let recovered = 0;

  const requeuedIds = new Set(await requeueProcessingJobs());
  recovered += requeuedIds.size;

  const jobs = await scanJobs();
  for (const job of jobs) {
    if (job.status !== JobStatus.RUNNING) continue;
    // Skip jobs already requeued from the processing list to avoid
    // double-enqueueing (double execution / double webhook delivery).
    if (requeuedIds.has(job.id)) continue;
    await updateJob(job.id, { status: JobStatus.QUEUED });
    await enqueueJob(job.id);
    recovered++;
  }

  return recovered;
}

/**
 * Mark jobs that have been RUNNING for too long as SYSTEM_ERROR.
 *
 * Catches genuinely stuck executions (e.g. a hung Docker daemon) so clients
 * stop polling forever. Threshold is generous to avoid killing slow-but-alive
 * jobs (Java needs up to ~8s + JVM startup).
 */
export async function sweepStaleJobs(): Promise<number> {
  const thresholdMs = Math.max(config.execTimeoutMs * 3, 30_000);
  const cutoff = Date.now() - thresholdMs;

  const jobs = await scanJobs();
  let failed = 0;

  for (const job of jobs) {
    if (job.status !== JobStatus.RUNNING) continue;
    const startedAt = job.started_at ?? 0;
    if (!startedAt || startedAt >= cutoff) continue;

    await updateJob(job.id, {
      status: JobStatus.SYSTEM_ERROR,
      stderr: "Job execution timed out and was recovered by the system",
      finished_at: Date.now(),
    });
    failed++;
  }

  return failed;
}

/**
 * Start the periodic stale-job sweeper. Timer is unref'd so it does not keep
 * the process alive by itself.
 */
export function startJobSweeper(): NodeJS.Timeout {
  const timer = setInterval(() => {
    sweepStaleJobs().catch((err) => {
      console.error(`[SWEEPER] error: ${errorMessage(err)}`);
    });
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
