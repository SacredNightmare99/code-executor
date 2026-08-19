import { redis, redisBlocking } from "../../infrastructure/redis/redisClient.ts";

const QUEUE_KEY = "jobs:queue";
const PROCESSING_KEY = "jobs:processing";

/**
 * Reliable queue implementation.
 *
 * `dequeueJob` atomically moves a job id from the queue to a "processing"
 * list. If a worker crashes (or pm2 restarts) between dequeue and completion,
 * the job id remains in the processing list and is recovered on the next
 * startup via `requeueProcessingJobs`, so jobs are never silently lost.
 */
export async function enqueueJob(jobId: string): Promise<void> {
  await redis.rpush(QUEUE_KEY, jobId);
}

/**
 * Atomically move from queue -> processing (blocking with a finite timeout).
 *
 * Uses `brpoplpush` (Redis >= 2.2) for wide compatibility. A finite timeout
 * (rather than 0 = block forever) lets workers poll for an abort signal and
 * shut down cleanly during tests / graceful restarts.
 */
export async function dequeueJob(timeoutSeconds = 1): Promise<string | null> {
  const result = await redisBlocking.brpoplpush(QUEUE_KEY, PROCESSING_KEY, timeoutSeconds);
  return result;
}

export async function completeJobProcessing(jobId: string): Promise<void> {
  await redis.lrem(PROCESSING_KEY, 1, jobId);
}

export async function requeueProcessingJobs(): Promise<number> {
  let requeued = 0;
  // Move all entries currently being processed back to the queue.
  // Called once at startup when no workers are consuming yet.
  while (true) {
    const jobId = await redis.rpoplpush(PROCESSING_KEY, QUEUE_KEY);
    if (!jobId) break;
    requeued++;
  }
  return requeued;
}

export async function getQueueSize(): Promise<number> {
  return redis.llen(QUEUE_KEY);
}

export async function getProcessingSize(): Promise<number> {
  return redis.llen(PROCESSING_KEY);
}
