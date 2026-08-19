import type { ErrorRequestHandler } from "express";
import { error as logError } from "../infrastructure/logs/logger.ts";
import { ApiResponse } from "../utils/apiResponse.ts";
import config from "../config/index.ts";

/**
 * Global error handler middleware
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const apiError = err as { statusCode?: number; message?: string; code?: string; details?: unknown };
  const status = apiError.statusCode || 500;
  const message = apiError.message || "Internal error";

  logError(message, {
    reqId: req.requestId,
  });

  if (apiError.details) {
    logError(JSON.stringify(apiError.details), {
      reqId: req.requestId,
    });
  }

  // In production, never leak internal error messages for unexpected failures.
  const exposed =
    config.isProduction && status >= 500 && !apiError.code
      ? "Internal server error"
      : message;

  return res.status(status).json(
    ApiResponse.error(exposed, apiError.code || "INTERNAL_ERROR"),
  );
};
