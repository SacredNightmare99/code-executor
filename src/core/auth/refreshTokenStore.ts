import { redis } from "../../infrastructure/redis/redisClient.ts";
import crypto from "crypto";
import { hashToken } from "../../utils/crypto.ts";
import { parseTimeToSeconds } from "../../config/index.ts";
import type { Request } from "express";

/**
 * Refresh Token Store - Manage refresh tokens in Redis
 * Tokens are stored hashed and tied to user/device
 */

/**
 * Store a refresh token
 * @param {string} token - The refresh token
 * @param {string} userId - User ID
 * @param {string} deviceInfo - Optional device identifier (e.g., user agent hash)
 */
export interface RefreshTokenData {
  userId: string;
  deviceInfo: string;
  createdAt: number;
}

export async function storeRefreshToken(token: string, userId: string, deviceInfo = "default"): Promise<void> {
  const tokenHash = hashToken(token);
  const ttl = parseTimeToSeconds(process.env.REFRESH_TOKEN_EXPIRES_IN || "7d");

  const tokenData = {
    userId,
    deviceInfo,
    createdAt: Date.now(),
  };

  // Store token data with TTL
  await redis.set(
    `refresh_token:${tokenHash}`,
    JSON.stringify(tokenData),
    "EX",
    ttl,
  );

  // Also add to user's token set for "logout all" functionality
  await redis.sadd(`user:${userId}:refresh_tokens`, tokenHash);
  await redis.expire(`user:${userId}:refresh_tokens`, ttl);
}

/**
 * Validate a refresh token exists and is active
 * @param {string} token - The refresh token to validate
 * @returns {Promise<object|null>} Token data or null if invalid
 */
export async function validateRefreshToken(token: string): Promise<RefreshTokenData | null> {
  const tokenHash = hashToken(token);
  const data = await redis.get(`refresh_token:${tokenHash}`);

  if (!data) return null;

  try {
    return JSON.parse(data) as RefreshTokenData;
  } catch {
    return null;
  }
}

/**
 * Revoke a specific refresh token (single device logout)
 * @param {string} token - The refresh token to revoke
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);

  // Get token data to find user ID
  const data = await redis.get(`refresh_token:${tokenHash}`);
  if (data) {
    const tokenData = JSON.parse(data) as RefreshTokenData;
    // Remove from user's token set
    await redis.srem(`user:${tokenData.userId}:refresh_tokens`, tokenHash);
  }

  // Delete the token
  await redis.del(`refresh_token:${tokenHash}`);
}

/**
 * Revoke all refresh tokens for a user (all devices logout)
 * @param {string} userId - User ID whose tokens to revoke
 */
export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  // Get all token hashes for this user
  const tokenHashes = await redis.smembers(`user:${userId}:refresh_tokens`);

  if (tokenHashes.length === 0) return;

  // Delete all tokens
  const deletePromises = tokenHashes.map((hash: string) =>
    redis.del(`refresh_token:${hash}`),
  );
  await Promise.all(deletePromises);

  // Clear the user's token set
  await redis.del(`user:${userId}:refresh_tokens`);
}

/**
 * Get device info from request (simple hash of user agent)
 * @param {object} req - Express request object
 * @returns {string} Device identifier
 */
export function getDeviceInfo(req: Request): string {
  const userAgent = req.headers["user-agent"] || "unknown";
  return crypto
    .createHash("md5")
    .update(Array.isArray(userAgent) ? userAgent.join(" ") : userAgent)
    .digest("hex")
    .substring(0, 16);
}
