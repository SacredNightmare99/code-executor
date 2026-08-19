import { redis } from "../../infrastructure/redis/redisClient.ts";
import { isBlockedUrl } from "../../utils/urlSafety.ts";

export const WEBHOOK_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  FAILED: "failed",
} as const;

export type WebhookStatus = (typeof WEBHOOK_STATUS)[keyof typeof WEBHOOK_STATUS];

export interface WebhookOptions {
  events?: string[];
  secret?: string | null;
}

export interface WebhookRecord {
  id: string;
  userId: string;
  url: string;
  events: string[];
  status: WebhookStatus;
  secret: string | null;
  created_at: number;
  updated_at: number;
  failed_attempts: number;
}

export interface WebhookDelivery {
  success: boolean;
  status?: number;
  attempts: number;
  response_body?: string;
  error?: string;
  timestamp?: number;
}

/**
 * Scan for Redis keys matching a pattern.
 * Uses SCAN instead of KEYS to avoid blocking Redis.
 *
 * @param {string} pattern - Redis key pattern
 * @returns {Promise<string[]>} Matching keys
 */
async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [newCursor, foundKeys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      "100",
    );
    cursor = newCursor;
    keys.push(...foundKeys);
  } while (cursor !== "0");
  return keys;
}

/**
 * Register a webhook for a user
 * @param {string} userId - User ID
 * @param {string} url - Webhook URL
 * @param {Object} options - Events to subscribe to, secret for HMAC
 * @returns {Promise<Object>} - Created webhook
 */
export async function createWebhook(userId: string, url: string, options: WebhookOptions = {}): Promise<WebhookRecord> {
  if (!url || typeof url !== "string") {
    throw new Error("Invalid webhook URL");
  }

  try {
    new URL(url);
  } catch {
    throw new Error("Invalid webhook URL format");
  }

  // SSRF guard: reject non-http(s) schemes and private/loopback/metadata hosts.
  const blockReason = await isBlockedUrl(url);
  if (blockReason) {
    throw new Error(`Invalid webhook URL: ${blockReason}`);
  }

  const webhookId = `wh_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const webhook = {
    id: webhookId,
    userId,
    url,
    events: options.events || ["job.completed"],
    status: WEBHOOK_STATUS.ACTIVE,
    secret: options.secret || null,
    created_at: Date.now(),
    updated_at: Date.now(),
    failed_attempts: 0,
  };

  const key = `webhook:${webhookId}`;
  await redis.set(key, JSON.stringify(webhook), "EX", 7776000); // 90 days

  // Index for user's webhooks
  await redis.set(`user:${userId}:webhooks:${webhookId}`, "1", "EX", 7776000);

  return webhook;
}

/**
 * Get a webhook by ID
 * @param {string} webhookId - Webhook ID
 * @returns {Promise<Object|null>} - Webhook object or null
 */
export async function getWebhook(webhookId: string): Promise<WebhookRecord | null> {
  const data = await redis.get(`webhook:${webhookId}`);
  return data ? JSON.parse(data) as WebhookRecord : null;
}

/**
 * Delete a webhook
 * @param {string} userId - User ID (for authorization)
 * @param {string} webhookId - Webhook ID to delete
 * @returns {Promise<boolean>} - True if deleted
 */
export async function deleteWebhook(userId: string, webhookId: string): Promise<boolean> {
  const webhook = await getWebhook(webhookId);

  if (!webhook) {
    return false;
  }

  if (webhook.userId !== userId) {
    throw new Error("Unauthorized: webhook belongs to different user");
  }

  await redis.del(`webhook:${webhookId}`);
  await redis.del(`user:${userId}:webhooks:${webhookId}`);

  return true;
}

/**
 * Get all webhooks for a user
 * Uses SCAN instead of KEYS to avoid blocking Redis.
 *
 * @param {string} userId - User ID
 * @returns {Promise<Array>} - Array of webhooks
 */
export async function getUserWebhooks(userId: string): Promise<WebhookRecord[]> {
  const pattern = `user:${userId}:webhooks:*`;
  const keys = await scanKeys(pattern);

  if (keys.length === 0) {
    return [];
  }

  const webhooks: WebhookRecord[] = [];
  for (const key of keys) {
    const webhookId = key.split(":").pop();
    const webhook = webhookId ? await getWebhook(webhookId) : null;
    if (webhook) {
      webhooks.push(webhook);
    }
  }

  return webhooks;
}

/**
 * Record a webhook delivery attempt
 * @param {string} webhookId - Webhook ID
 * @param {Object} delivery - Delivery record
 */
export async function recordWebhookDelivery(webhookId: string, delivery: WebhookDelivery): Promise<void> {
  const key = `webhook:${webhookId}:deliveries`;
  const deliveryId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  await redis.set(
    `${key}:${deliveryId}`,
    JSON.stringify({
      ...delivery,
      timestamp: Date.now(),
    }),
    "EX",
    2592000, // 30 days
  );

  // Prune old deliveries (keep last 100) using SCAN
  const pattern = `${key}:*`;
  const deliveries = await scanKeys(pattern);
  if (deliveries.length > 100) {
    // Sort and delete oldest
    const oldest = deliveries.sort().slice(0, deliveries.length - 100);
    for (const oldKey of oldest) {
      await redis.del(oldKey);
    }
  }
}

/**
 * Get webhook delivery history
 * Uses SCAN instead of KEYS.
 *
 * @param {string} webhookId - Webhook ID
 * @param {number} limit - Max deliveries to return
 * @returns {Promise<Array>} - Delivery records
 */
export async function getWebhookDeliveries(webhookId: string, limit = 50): Promise<WebhookDelivery[]> {
  const pattern = `webhook:${webhookId}:deliveries:*`;
  const keys = await scanKeys(pattern);

  if (keys.length === 0) {
    return [];
  }

  const deliveries: WebhookDelivery[] = [];
  const sorted = keys.sort().reverse().slice(0, limit);

  for (const key of sorted) {
    const data = await redis.get(key);
    if (data) {
      deliveries.push(JSON.parse(data) as WebhookDelivery);
    }
  }

  return deliveries;
}

/**
 * Update webhook status
 * @param {string} webhookId - Webhook ID
 * @param {string} status - New status
 */
export async function updateWebhookStatus(webhookId: string, status: WebhookStatus): Promise<void> {
  const webhook = await getWebhook(webhookId);
  if (!webhook) return;

  webhook.status = status;
  webhook.updated_at = Date.now();

  const key = `webhook:${webhookId}`;
  await redis.set(key, JSON.stringify(webhook), "EX", 7776000);
}

/**
 * Increment failed attempts for a webhook
 * @param {string} webhookId - Webhook ID
 */
export async function incrementFailedAttempts(webhookId: string): Promise<void> {
  const webhook = await getWebhook(webhookId);
  if (!webhook) return;

  webhook.failed_attempts = (webhook.failed_attempts || 0) + 1;

  // Disable after 10 failed attempts
  if (webhook.failed_attempts >= 10) {
    webhook.status = WEBHOOK_STATUS.FAILED;
  }

  webhook.updated_at = Date.now();

  const key = `webhook:${webhookId}`;
  await redis.set(key, JSON.stringify(webhook), "EX", 7776000);
}

/**
 * Reset failed attempts for a webhook
 * @param {string} webhookId - Webhook ID
 */
export async function resetFailedAttempts(webhookId: string): Promise<void> {
  const webhook = await getWebhook(webhookId);
  if (!webhook) return;

  webhook.failed_attempts = 0;
  webhook.status = WEBHOOK_STATUS.ACTIVE;
  webhook.updated_at = Date.now();

  const key = `webhook:${webhookId}`;
  await redis.set(key, JSON.stringify(webhook), "EX", 7776000);
}
