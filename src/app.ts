import express from "express";
import type { Express } from "express";
import cors from "cors";

import { requestLogger } from "./infrastructure/logs/requestLogger.ts";
import { errorHandler } from "./middleware/errorHandler.ts";
import { configureRoutes } from "./api/routes/index.ts";

/**
 * Build the Express application (middleware + routes + error handling).
 *
 * Kept separate from the server bootstrap so tests can exercise the full app
 * in-process (e.g. with supertest) without binding a port.
 */
export function createApp(): Express {
  const app = express();

  // CORS: Allow any origin for authenticated requests.
  // Security is via API Key / JWT authentication, not origin restriction.
  const corsOptions = {
    origin: true, // Reflect request origin (allows all)
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    credentials: true,
  };
  app.use(cors(corsOptions));
  app.use(requestLogger);
  // Limit must accommodate code (up to 100KB) + up to 50 inputs (each up to 100KB).
  app.use(express.json({ limit: "6mb" }));

  // Routes
  configureRoutes(app);

  // Error Handler
  app.use(errorHandler);

  return app;
}
