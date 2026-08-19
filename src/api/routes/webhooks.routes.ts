import express from "express";
import { authenticateJWT } from "../../middleware/authMiddleware.ts";
import { rateLimitByUser, checkRateLimit } from "../../middleware/rateLimiter.ts";
import { ApiResponse } from "../../utils/apiResponse.ts";
import {
  createWebhook,
  getWebhook,
  deleteWebhook,
  getUserWebhooks,
  getWebhookDeliveries,
} from "../../core/webhooks/webhookStore.ts";

const router = express.Router();

/**
 * Register a Webhook
 * POST /webhooks
 * Requires JWT authentication
 * Body: { url, events?, secret? }
 */
router.post("/webhooks", authenticateJWT, rateLimitByUser(), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { url, events, secret } = req.body;

    if (!url) {
      return res.status(400).json(
        ApiResponse.error("Webhook URL required", "MISSING_URL"),
      );
    }

    const webhook = await createWebhook(userId, url, { events, secret });

    return res.status(201).json({
      success: true,
      data: webhook,
    });
  } catch (err) {
    if (err.message.includes("Invalid webhook")) {
      return res.status(400).json(
        ApiResponse.error(err.message, "INVALID_WEBHOOK_URL"),
      );
    }
    next(err);
  }
});

/**
 * Get All User Webhooks
 * GET /webhooks
 * Requires JWT authentication
 */
router.get("/webhooks", authenticateJWT, checkRateLimit(), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const webhooks = await getUserWebhooks(userId);

    return res.json({
      success: true,
      data: webhooks,
      count: webhooks.length,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get Webhook Details
 * GET /webhooks/:id
 * Requires JWT authentication
 */
router.get("/webhooks/:id", authenticateJWT, checkRateLimit(), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const webhookId = req.params.id;
    const webhook = await getWebhook(webhookId);

    if (!webhook) {
      return res.status(404).json(
        ApiResponse.error("Webhook not found", "WEBHOOK_NOT_FOUND"),
      );
    }

    if (webhook.userId !== userId) {
      return res.status(403).json(
        ApiResponse.error("Forbidden", "FORBIDDEN"),
      );
    }

    return res.json({
      success: true,
      data: webhook,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get Webhook Delivery History
 * GET /webhooks/:id/deliveries
 * Requires JWT authentication
 */
router.get("/webhooks/:id/deliveries", authenticateJWT, checkRateLimit(), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const webhookId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit ?? "50", 10) || 50, 100);

    const webhook = await getWebhook(webhookId);

    if (!webhook) {
      return res.status(404).json(
        ApiResponse.error("Webhook not found", "WEBHOOK_NOT_FOUND"),
      );
    }

    if (webhook.userId !== userId) {
      return res.status(403).json(
        ApiResponse.error("Forbidden", "FORBIDDEN"),
      );
    }

    const deliveries = await getWebhookDeliveries(webhookId, limit);

    return res.json({
      success: true,
      data: deliveries,
      count: deliveries.length,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Delete a Webhook
 * DELETE /webhooks/:id
 * Requires JWT authentication
 */
router.delete("/webhooks/:id", authenticateJWT, rateLimitByUser(), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const webhookId = req.params.id;

    const deleted = await deleteWebhook(userId, webhookId);

    if (!deleted) {
      return res.status(404).json(
        ApiResponse.error("Webhook not found", "WEBHOOK_NOT_FOUND"),
      );
    }

    return res.json({
      success: true,
      message: "Webhook deleted successfully",
    });
  } catch (err) {
    if (err.message.includes("Unauthorized")) {
      return res.status(403).json(
        ApiResponse.error("Forbidden", "FORBIDDEN"),
      );
    }
    next(err);
  }
});

export default router;
