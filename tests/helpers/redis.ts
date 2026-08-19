import { redis, redisBlocking } from "../../src/infrastructure/redis/redisClient.ts";

/**
 * Flush the test database. Safe because tests run against a dedicated DB index.
 */
export async function flushTestDb(): Promise<void> {
  await redis.flushdb();
}

/**
 * Close both Redis connections so the test runner can exit cleanly.
 */
export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    // ignore
  }
  try {
    await redisBlocking.quit();
  } catch {
    // ignore
  }
}

export { redis, redisBlocking };
