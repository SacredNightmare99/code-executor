/**
 * Base test environment. IMPORTANT: this file must be the FIRST import in any
 * test that touches src modules, because the config singleton and the Redis
 * client read these values at module load time.
 *
 * Uses Redis database 15 so tests never touch real data, and raises the
 * per-IP auth rate limits (supertest requests all share one socket address).
 */
process.env.REDIS_URL = process.env.TEST_REDIS_URL || "redis://localhost:6379/15";
process.env.NODE_ENV = "test";
process.env.AUTH_REGISTER_LIMIT = process.env.AUTH_REGISTER_LIMIT || "1000";
process.env.AUTH_LOGIN_LIMIT = process.env.AUTH_LOGIN_LIMIT || "1000";
process.env.DISABLE_GVISOR = "true";

export {};
