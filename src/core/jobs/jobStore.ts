import { redis } from "../../infrastructure/redis/redisClient.ts";
import config from "../../config/index.ts";
import type { JobRecord } from "./jobTypes.ts";

const JOB_TTL_SECONDS = config.jobTtlSeconds;

// Store job JSON to preserve types and schema
export async function createJob(job: JobRecord): Promise<void> {
  await redis.set(`job:${job.id}`, JSON.stringify(job), "EX", JOB_TTL_SECONDS);
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const data = await redis.get(`job:${id}`);
  if (!data) return null;
  try {
    return JSON.parse(data) as JobRecord;
  } catch {
    return null;
  }
}

export async function updateJob(id: string, updates: Partial<JobRecord>): Promise<void> {
  const current = await getJob(id);
  if (!current) {
    // Job was deleted, don't update
    return;
  }
  const merged = Object.assign(
    {},
    typeof current === "object" ? current : {},
    updates,
  );
  await redis.set(`job:${id}`, JSON.stringify(merged), "KEEPTTL");
}

export async function addJobToUserIndex(userId: string, jobId: string): Promise<void> {
  const key = `user:${userId}:jobs`;
  await redis.lpush(key, jobId);
  await redis.expire(key, JOB_TTL_SECONDS);
}

export async function getUserJobIds(userId: string, offset = 0, limit = 50): Promise<string[]> {
  const key = `user:${userId}:jobs`;
  // LRANGE is 0-indexed, newest first since we lpush
  return redis.lrange(key, offset, offset + limit - 1);
}

export async function getUserJobCount(userId: string): Promise<number> {
  return redis.llen(`user:${userId}:jobs`);
}
