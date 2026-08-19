import { redis } from "../../infrastructure/redis/redisClient.ts";
import crypto from "crypto";
import { getUserById, type SafeUser } from "./userStore.ts";

/**
 * API Key Store - Redis-backed API key management
 * 
 * API keys are hashed before storage (using SHA256)
 * Format: sk_live_<random_32_bytes_hex>
 */

/**
 * Generate a new API key for a user
 * @param {string} userId - User ID
 * @param {string} name - Friendly name for the key
 * @returns {Promise<{key: string, keyId: string, name: string, createdAt: number}>}
 */
export interface ApiKeyData {
  keyId: string;
  userId: string;
  name: string;
  hashedKey: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface ApiKeyPreview {
  keyId: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export async function generateApiKey(userId: string, name = "Default API Key"): Promise<{
  key: string;
  keyId: string;
  name: string;
  createdAt: number;
}> {
  const user = await getUserById(userId);
  if (!user) {
    throw new Error("User not found");
  }

  // Generate raw API key (this is shown ONCE to the user)
  const rawKey = `sk_live_${crypto.randomBytes(32).toString("hex")}`;
  
  // Hash the key for storage (like passwords, we never store raw keys)
  const hashedKey = hashApiKey(rawKey);
  
  // Generate unique key ID
  const keyId = `apikey_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
  
  const apiKeyData: ApiKeyData = {
    keyId,
    userId,
    name,
    hashedKey,
    createdAt: Date.now(),
    lastUsedAt: null,
  };

  // Store the hashed key with mapping to user
  await redis.set(`apikey:${hashedKey}`, JSON.stringify(apiKeyData));
  
  // Add to user's key set for easy listing
  await redis.sadd(`user:${userId}:apikeys`, keyId);
  
  // Store key ID mapping for revocation/lookup
  await redis.set(`apikeyid:${keyId}`, hashedKey);

  return {
    key: rawKey, // Return raw key ONCE (cannot be retrieved again)
    keyId,
    name,
    createdAt: apiKeyData.createdAt,
  };
}

/**
 * Validate an API key and return associated user
 * @param {string} rawKey - The raw API key from request
 * @returns {Promise<Object|null>} User object or null
 */
export async function validateApiKey(rawKey: string): Promise<SafeUser | null> {
  if (!rawKey || !rawKey.startsWith("sk_live_")) {
    return null;
  }

  const hashedKey = hashApiKey(rawKey);
  const apiKeyData = await redis.get(`apikey:${hashedKey}`);
  
  if (!apiKeyData) {
    return null;
  }

  const keyInfo = JSON.parse(apiKeyData) as ApiKeyData;
  
  // Update last used timestamp (async, don't wait)
  redis.set(
    `apikey:${hashedKey}`,
    JSON.stringify({ ...keyInfo, lastUsedAt: Date.now() }),
  ).catch(() => {}); // Ignore errors updating lastUsedAt

  // Get and return user
  const user = await getUserById(keyInfo.userId);
  if (!user) return null;
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

/**
 * List all API keys for a user (without raw keys)
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of API key info
 */
export async function listApiKeys(userId: string): Promise<ApiKeyPreview[]> {
  const keyIds = await redis.smembers(`user:${userId}:apikeys`);
  
  if (!keyIds || keyIds.length === 0) {
    return [];
  }

  const keys: ApiKeyPreview[] = [];
  for (const keyId of keyIds) {
    const hashedKey = await redis.get(`apikeyid:${keyId}`);
    if (hashedKey) {
      const apiKeyData = await redis.get(`apikey:${hashedKey}`);
      if (apiKeyData) {
        const keyInfo = JSON.parse(apiKeyData) as ApiKeyData;
        keys.push({
          keyId: keyInfo.keyId,
          name: keyInfo.name,
          createdAt: keyInfo.createdAt,
          lastUsedAt: keyInfo.lastUsedAt,
          // Never return hashedKey or raw key
        });
      }
    }
  }

  return keys;
}

/**
 * Revoke (delete) an API key
 * @param {string} userId - User ID (for authorization)
 * @param {string} keyId - Key ID to revoke
 * @returns {Promise<boolean>} True if revoked
 */
export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  // Get hashed key from key ID
  const hashedKey = await redis.get(`apikeyid:${keyId}`);
  if (!hashedKey) {
    return false;
  }

  // Verify key belongs to user
  const apiKeyData = await redis.get(`apikey:${hashedKey}`);
  if (!apiKeyData) {
    return false;
  }

  const keyInfo = JSON.parse(apiKeyData) as ApiKeyData;
  if (keyInfo.userId !== userId) {
    throw new Error("Unauthorized: Key does not belong to user");
  }

  // Delete all related keys
  await redis.del(`apikey:${hashedKey}`);
  await redis.del(`apikeyid:${keyId}`);
  await redis.srem(`user:${userId}:apikeys`, keyId);

  return true;
}

/**
 * Hash an API key using SHA256
 * @param {string} rawKey - Raw API key
 * @returns {string} Hashed key
 */
function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}
