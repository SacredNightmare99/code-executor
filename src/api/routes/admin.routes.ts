import express from "express";
import { authenticateJWT } from "../../middleware/authMiddleware.ts";
import { requireAdmin } from "../../middleware/adminMiddleware.ts";
import { getUserById, updateUser, getAllUsers, deleteUser, type UserTier } from "../../core/auth/userStore.ts";
import { ApiError } from "../../utils/apiError.ts";
import { info, warn } from "../../infrastructure/logs/logger.ts";

const router = express.Router();

/**
 * Admin Routes
 * All routes require authentication + admin role
 */

/**
 * Upgrade User Tier
 * POST /admin/users/:userId/upgrade
 */
router.post("/users/:userId/upgrade", authenticateJWT, requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { newTier } = req.body;
    const adminId = req.user.id;

    // Validate tier
    const validTiers = ["free", "starter", "professional", "enterprise"] as const;
    if (!newTier || !validTiers.includes(newTier)) {
      throw new ApiError(
        400,
        `Invalid tier. Must be one of: ${validTiers.join(", ")}`,
      );
    }
    const tier = newTier as UserTier;

    // Get user
    const user = await getUserById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    // Calculate new rate limit for tier
    const tierRateLimits: Record<UserTier, number> = {
      free: 10,
      starter: 50,
      professional: 100,
      enterprise: 500,
    };
    const newRateLimit = tierRateLimits[tier];

    // Update user tier and rate limit
    const oldTier = user.tier;
    const updated = await updateUser(userId, { 
      tier,
      rateLimit: newRateLimit, 
    });

    info("user tier upgraded", {
      adminId,
      userId,
      oldTier,
      newTier,
      newRateLimit,
    });

    return res.json({
      success: true,
      data: {
        user: updated,
        message: `Upgraded ${user.username} from ${oldTier} to ${newTier}`,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get User Details
 * GET /admin/users/:userId
 */
router.get("/users/:userId", authenticateJWT, requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await getUserById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    const { passwordHash: _passwordHash, ...safeUser } = user;

    return res.json({
      success: true,
      data: { user: safeUser },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Grant Admin Role
 * POST /admin/users/:userId/make-admin
 */
router.post("/users/:userId/make-admin", authenticateJWT, requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;

    // Don't allow an admin to make someone else admin unless they're the owner (skip for now)
    if (userId === adminId) {
      throw new ApiError(400, "Cannot change your own role");
    }

    const user = await getUserById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    if (user.role === "admin") {
      throw new ApiError(400, "User is already an admin");
    }

    const updated = await updateUser(userId, { role: "admin" });

    info("user made admin", {
      adminId,
      userId,
      username: user.username,
    });

    return res.json({
      success: true,
      data: {
        user: updated,
        message: `Made ${user.username} an admin`,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Revoke Admin Role
 * POST /admin/users/:userId/revoke-admin
 */
router.post("/users/:userId/revoke-admin", authenticateJWT, requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;

    if (userId === adminId) {
      throw new ApiError(400, "Cannot revoke your own admin role");
    }

    const user = await getUserById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    if (user.role !== "admin") {
      throw new ApiError(400, "User is not an admin");
    }

    const updated = await updateUser(userId, { role: "user" });

    info("admin role revoked", {
      adminId,
      userId,
      username: user.username,
    });

    return res.json({
      success: true,
      data: {
        user: updated,
        message: `Revoked admin role from ${user.username}`,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Delete User
 * DELETE /admin/users/:userId
 */
router.delete("/users/:userId", authenticateJWT, requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;

    if (userId === adminId) {
      throw new ApiError(400, "Cannot delete your own account");
    }

    const user = await getUserById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    await deleteUser(userId);

    warn("user deleted", {
      adminId,
      userId,
      username: user.username,
    });

    return res.json({
      success: true,
      data: {
        deleted: true,
        userId,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get Admin Stats
 * GET /admin/stats
 */
router.get("/stats", authenticateJWT, requireAdmin, async (req, res, next) => {
  try {
    // This is a placeholder - would connect to metrics system
    return res.json({
      success: true,
      data: {
        message: "Admin stats endpoint placeholder",
        features: ["user_count", "tier_distribution", "rate_limit_usage"],
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * List All Users
 * GET /admin/users
 */
router.get("/users", authenticateJWT, requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "50", 10) || 50, 100); // Max 100 per page
    const offset = parseInt(req.query.offset ?? "0", 10) || 0;
    const adminId = req.user.id;

    const result = await getAllUsers(limit, offset);

    info("admin listed users", {
      adminId,
      count: result.users.length,
      total: result.total,
      limit,
      offset,
    });

    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
