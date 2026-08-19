import type { RequestHandler } from "express";
import { getRedis } from "../infrastructure/redis/redisClient.ts";
import { ApiError } from "../utils/apiError.ts";
import { info, warn } from "../infrastructure/logs/logger.ts";

const INCR_WITH_EXPIRE_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 or redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return current
`;

async function incrWithExpire(key: string, ttlSeconds: number): Promise<number> {
  const redis = getRedis();
  const res = await redis.eval(INCR_WITH_EXPIRE_LUA, 1, key, ttlSeconds);
  return typeof res === "number" ? res : Number(res);
}

/**
 * Rate limiter using atomic fixed-window counters in Redis
 * 
 * Limits based on user's rateLimit from JWT (requests per minute)
 * Key format: ratelimit:{userId}:{minute}
 * 
 * @returns {Function} Express middleware
 */
export function rateLimitByUser(): RequestHandler {
  return async (req, res, next) => {
    try {
      // Skip if no authenticated user (should not happen if used after authMiddleware)
      if (!req.user || !req.user.id) {
        return next();
      }

      const userId = req.user.id;
      const rateLimit = req.user.rateLimit || 10; // Default to 10 req/min
      const now = Date.now();
      const currentMinute = Math.floor(now / 60000); // Round down to minute
      
      const key = `ratelimit:${userId}:${currentMinute}`;
      
      // Atomically increment request count and set expiry
      const count = await incrWithExpire(key, 120);
      
      // Check if limit exceeded
      if (count > rateLimit) {
        const resetTime = (currentMinute + 1) * 60000; // Next minute
        const retryAfter = Math.ceil((resetTime - now) / 1000); // Seconds until reset
        
        warn("rate limit exceeded", { 
          userId, 
          count, 
          limit: rateLimit,
          tier: req.user.tier, 
        });
        
        // Set rate limit headers
        res.set({
          "X-RateLimit-Limit": rateLimit.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": resetTime.toString(),
          "Retry-After": retryAfter.toString(),
        });
        
        throw new ApiError(
          429,
          `Rate limit exceeded. Maximum ${rateLimit} requests per minute for ${req.user.tier} tier.`,
          "RATE_LIMIT_EXCEEDED",
        );
      }
      
      // Set rate limit headers for successful requests
      const remaining = Math.max(0, rateLimit - count);
      const resetTime = (currentMinute + 1) * 60000;
      
      res.set({
        "X-RateLimit-Limit": rateLimit.toString(),
        "X-RateLimit-Remaining": remaining.toString(),
        "X-RateLimit-Reset": resetTime.toString(),
      });
      
      info("rate limit check passed", { 
        userId, 
        count, 
        limit: rateLimit,
        remaining, 
      });
      
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * IP-based rate limiter (fixed window), for unauthenticated endpoints such as
 * /auth/login and /auth/register to prevent brute-force / account creation spam.
 *
 * @param {number} limit          - Max requests per window
 * @param {number} windowSeconds  - Window length in seconds
 * @returns {Function} Express middleware
 */
export function rateLimitByIp(limit = 20, windowSeconds = 60): RequestHandler {
  return async (req, res, next) => {
    try {
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      const now = Date.now();
      const windowKey = Math.floor(now / (windowSeconds * 1000));
      const key = `ratelimit:ip:${ip}:${windowKey}`;

      // Atomically increment IP request count and set expiry
      const count = await incrWithExpire(key, windowSeconds * 2);

      if (count > limit) {
        const resetTime = (windowKey + 1) * windowSeconds * 1000;
        const retryAfter = Math.ceil((resetTime - now) / 1000);

        warn("IP rate limit exceeded", {
          ip,
          count,
          limit,
        });

        res.set("Retry-After", retryAfter.toString());
        throw new ApiError(
          429,
          "Too many requests. Please try again later.",
          "RATE_LIMIT_EXCEEDED",
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Check rate limit without incrementing (useful for GET requests)
 * 
 * @returns {Function} Express middleware
 */
export function checkRateLimit(): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return next();
      }

      const userId = req.user.id;
      const rateLimit = req.user.rateLimit || 10;
      const now = Date.now();
      const currentMinute = Math.floor(now / 60000);
      
      const redis = getRedis();
      const key = `ratelimit:${userId}:${currentMinute}`;
      
      // Get current count without incrementing
      const countStr = await redis.get(key);
      const count = countStr ? parseInt(countStr, 10) : 0;
      
      const remaining = Math.max(0, rateLimit - count);
      const resetTime = (currentMinute + 1) * 60000;
      
      res.set({
        "X-RateLimit-Limit": rateLimit.toString(),
        "X-RateLimit-Remaining": remaining.toString(),
        "X-RateLimit-Reset": resetTime.toString(),
      });
      
      next();
    } catch (err) {
      next(err);
    }
  };
}
