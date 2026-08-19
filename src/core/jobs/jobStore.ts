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

const UPDATE_JOB_LUA = `
local data = redis.call('GET', KEYS[1])
if not data then return nil end
local current = cjson.decode(data)
local updates = cjson.decode(ARGV[1])
for k, v in pairs(updates) do
  current[k] = v
end
redis.call('SET', KEYS[1], cjson.encode(current), 'KEEPTTL')
return 1
`;

export async function updateJob(id: string, updates: Partial<JobRecord>): Promise<void> {
  const serialized = JSON.stringify(updates);
  await redis.eval(UPDATE_JOB_LUA, 1, `job:${id}`, serialized);
}

export async function addJobToUserIndex(userId: string, jobId: string): Promise<void> {
  const key = `user:${userId}:jobs`;
  await redis.lpush(key, jobId);
  await redis.expire(key, JOB_TTL_SECONDS);
}

export async function getUserJobIds(userId: string, offset = 0, limit = 50): Promise<string[]> {
  const key = `user:${userId}:jobs`;
  const safeOffset = Math.max(0, offset);
  if (limit < 0) {
    return redis.lrange(key, safeOffset, -1);
  }
  return redis.lrange(key, safeOffset, safeOffset + limit - 1);
}

export async function getUserJobCount(userId: string): Promise<number> {
  return redis.llen(`user:${userId}:jobs`);
}
