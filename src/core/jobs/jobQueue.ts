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
 *
 * FIFO semantics: enqueue pushes to the LEFT, dequeue pops the oldest entry
 * from the RIGHT (the tail), and requeued jobs are pushed back to the RIGHT
 * so they keep their relative order against pending queue entries.
 */
export async function enqueueJob(jobId: string): Promise<void> {
  await redis.lpush(QUEUE_KEY, jobId);
}

/**
 * Atomically move from queue -> processing (blocking with a finite timeout).
 *
 * Uses `blmove` popping from the RIGHT (oldest) and pushing to the LEFT of
 * the processing list. A finite timeout (rather than 0 = block forever) lets
 * workers poll for an abort signal and shut down cleanly during tests /
 * graceful restarts.
 */
export async function dequeueJob(timeoutSeconds = 1): Promise<string | null> {
  const result = await redisBlocking.blmove(QUEUE_KEY, PROCESSING_KEY, "RIGHT", "LEFT", timeoutSeconds);
  return result;
}

export async function completeJobProcessing(jobId: string): Promise<void> {
  await redis.lrem(PROCESSING_KEY, 1, jobId);
}

/**
 * Move all entries currently being processed back to the queue.
 * Called once at startup when no workers are consuming yet.
 *
 * Returns the ids of the requeued jobs so callers can avoid re-enqueueing
 * them again (e.g. when a job is both in the processing list and marked
 * RUNNING in the job store).
 */
export async function requeueProcessingJobs(): Promise<string[]> {
  const requeued: string[] = [];
  // Pop the most recently dequeued first (LEFT of processing) and push to the
  // tail (RIGHT) of the queue, preserving FIFO order on re-dequeue.
  while (true) {
    const jobId = await redis.lmove(PROCESSING_KEY, QUEUE_KEY, "LEFT", "RIGHT");
    if (!jobId) break;
    requeued.push(jobId);
  }
  return requeued;
}

export async function getQueueSize(): Promise<number> {
  return redis.llen(QUEUE_KEY);
}

export async function getProcessingSize(): Promise<number> {
  return redis.llen(PROCESSING_KEY);
}
