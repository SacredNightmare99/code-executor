import type { RequestHandler } from "express";
import { ApiError } from "../utils/apiError.ts";
import { warn } from "../infrastructure/logs/logger.ts";

/**
 * Admin authorization middleware
 * Requires both authentication and admin role
 * 
 * Usage: router.post('/admin/endpoint', authenticateJWT, requireAdmin, handler)
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
export const requireAdmin: RequestHandler = (req, res, next) => {
  try {
    // Must be authenticated first (authenticateJWT should be before this)
    if (!req.user || !req.user.id) {
      throw new ApiError(401, "Authentication required");
    }

    // Check if user has admin role
    if (req.user.role !== "admin") {
      warn("unauthorized admin access attempt", {
        userId: req.user.id,
        username: req.user.username,
        attemptedPath: req.path,
      });

      throw new ApiError(
        403,
        "Admin access required",
        "FORBIDDEN_ADMIN_ONLY",
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};
