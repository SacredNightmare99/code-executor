import https from "https";
import http from "http";
import crypto from "crypto";
import { info, warn, error } from "../../infrastructure/logs/logger.ts";
import { isBlockedUrl } from "../../utils/urlSafety.ts";
import {
  recordWebhookDelivery,
  incrementFailedAttempts,
  resetFailedAttempts,
  getUserWebhooks,
  type WebhookDelivery,
} from "./webhookStore.ts";
import type { JobRecord } from "../jobs/jobTypes.ts";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // ms

/**
 * Create HMAC signature for webhook payload
 * @param {string} payload - JSON payload
 * @param {string} secret - Secret key
 * @returns {string} - HMAC signature
 */
type WebhookPayload = Record<string, unknown>;

function createSignature(payload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

/**
 * Deliver webhook payload
 * @param {string} url - Webhook URL
 * @param {Object} payload - Payload to send
 * @param {string} secret - Optional secret for HMAC
 * @returns {Promise<Object>} - Delivery result
 */
function deliverWebhook(url: string, payload: WebhookPayload, secret?: string | null): Promise<WebhookDelivery> {
  return new Promise((resolve) => {
    const payloadStr = JSON.stringify(payload);
    const signature = secret ? createSignature(payloadStr, secret) : null;

    let attemptCount = 0;

    const tryDeliver = async (): Promise<void> => {
      attemptCount++;
      const isLastAttempt = attemptCount === MAX_RETRIES;

      // SSRF defense-in-depth: re-check the URL at delivery time so webhooks
      // registered before URL validation existed are still protected.
      const blockReason = await isBlockedUrl(url).catch(() => null);
      if (blockReason) {
        resolve({
          success: false,
          attempts: attemptCount,
          error: `Blocked URL: ${blockReason}`,
        });
        return;
      }

      try {
        const urlObj = new URL(url);
        const client = urlObj.protocol === "https:" ? https : http;
        const timeout = 10000; // 10 seconds

        const options = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(Buffer.byteLength(payloadStr)),
            "User-Agent": "code-executor/1.0",
            "X-Webhook-Delivery": crypto.randomUUID(),
          } as Record<string, string>,
          timeout,
        };

        if (signature) {
          options.headers["X-Webhook-Signature"] = `sha256=${signature}`;
        }

        const req = client.request(urlObj, options, (res) => {
          let body = "";

          res.on("data", (chunk: Buffer) => {
            body += chunk;
          });

          res.on("end", () => {
            const statusCode = res.statusCode ?? 0;
            const success = statusCode >= 200 && statusCode < 300;

            if (success) {
              resolve({
                success: true,
                status: statusCode,
                attempts: attemptCount,
                response_body: body.substring(0, 500), // Truncate
              });
            } else if (isLastAttempt) {
              resolve({
                success: false,
                status: statusCode,
                attempts: attemptCount,
                error: `HTTP ${statusCode}`,
              });
            } else {
              // Retry
              setTimeout(tryDeliver, RETRY_DELAYS[attemptCount - 1]);
            }
          });
        });

        req.on("error", (err) => {
          if (isLastAttempt) {
            resolve({
              success: false,
              attempts: attemptCount,
              error: err.message,
            });
          } else {
            // Retry
            setTimeout(tryDeliver, RETRY_DELAYS[attemptCount - 1]);
          }
        });

        req.on("timeout", () => {
          req.destroy();
          if (isLastAttempt) {
            resolve({
              success: false,
              attempts: attemptCount,
              error: "Request timeout",
            });
          } else {
            setTimeout(tryDeliver, RETRY_DELAYS[attemptCount - 1]);
          }
        });

        req.write(payloadStr);
        req.end();
      } catch (err) {
        resolve({
          success: false,
          attempts: attemptCount,
          error: err.message,
        });
      }
    };

    tryDeliver();
  });
}

/**
 * Trigger webhooks for a job event
 * @param {string} userId - User ID
 * @param {string} eventType - Event type (e.g., "job.completed")
 * @param {Object} jobData - Job data to send in payload
 */
export async function triggerWebhooks(userId: string, eventType: string, jobData: WebhookPayload): Promise<void> {
  try {
    const webhooks = await getUserWebhooks(userId);

    for (const webhook of webhooks) {
      // Check if webhook is subscribed to this event
      if (!webhook.events.includes(eventType)) {
        continue;
      }

      // Don't retry failed webhooks
      if (webhook.status === "failed") {
        continue;
      }

      // Build payload
      const payload = {
        event: eventType,
        timestamp: Date.now(),
        data: jobData,
      };

      // Send webhook asynchronously (fire and forget)
      deliverWebhook(webhook.url, payload, webhook.secret)
        .then(async (result) => {
          await recordWebhookDelivery(webhook.id, result);

          if (result.success) {
            // Reset failed attempts on success
            await resetFailedAttempts(webhook.id);
            info(`Webhook delivered: ${webhook.id}`, {
              webhook_id: webhook.id,
              event: eventType,
              attempts: result.attempts,
            });
          } else {
            await incrementFailedAttempts(webhook.id);
            warn(`Webhook delivery failed: ${webhook.id}`, {
              webhook_id: webhook.id,
              event: eventType,
              attempts: result.attempts,
              error: result.error,
            });
          }
        })
        .catch((err) => {
          error(`Webhook trigger error: ${webhook.id}`, {
            webhook_id: webhook.id,
            error: err.message,
          });
        });
    }
  } catch (err) {
    error("Error triggering webhooks", {
      user_id: userId,
      event: eventType,
      error: err.message,
    });
  }
}

/**
 * Trigger webhook for job completion
 * @param {string} userId - User ID
 * @param {Object} job - Job object
 */
export async function onJobCompleted(userId: string, job: JobRecord): Promise<void> {
  const jobData = {
    id: job.id,
    language: job.language,
    status: job.status,
    created_at: job.created_at,
    completed_at: job.finished_at || Date.now(),
    stdout: job.stdout ?? "",
    stderr: job.stderr ?? "",
    exit_code: job.exit_code ?? null,
    results: job.results || null,
    metrics: job.metrics,
  };

  await triggerWebhooks(userId, "job.completed", jobData);

  // If a per-job one-off callback_url was specified, deliver to it as well
  if (job.callback_url) {
    const payload = {
      event: "job.completed",
      timestamp: Date.now(),
      data: jobData,
    };
    deliverWebhook(job.callback_url, payload, null).catch((err) => {
      error(`Callback URL delivery error for job ${job.id}:`, {
        job_id: job.id,
        url: job.callback_url,
        error: err.message,
      });
    });
  }
}
