import "dotenv/config";

import config, { getGVisorStatus } from "./src/config/index.ts";
import { createApp } from "./src/app.ts";
import { info, warn } from "./src/infrastructure/logs/logger.ts";
import { startWorker } from "./src/core/workers/executorWorker.ts";
import { recoverInFlightJobs, startJobSweeper } from "./src/core/workers/jobRecovery.ts";
import { redis, redisBlocking } from "./src/infrastructure/redis/redisClient.ts";

const app = createApp();

// Tracks running workers so they can be stopped during graceful shutdown.
const workerSignals: AbortController[] = [];

// Start Server
const server = app.listen(config.port, "0.0.0.0", async () => {
  info(`server started on port ${config.port}`);

  // Log gVisor status
  const gvisor = getGVisorStatus();
  if (gvisor.available) {
    info(`gVisor (runsc) runtime detected — sandbox hardening ENABLED (${gvisor.reason})`);
  } else {
    warn(`gVisor (runsc) not available — ${gvisor.reason}`);
  }

  // Recover jobs left in-flight by a previous process (crash/restart)
  try {
    const recovered = await recoverInFlightJobs();
    if (recovered > 0) info(`recovered ${recovered} in-flight job(s) from previous run`);
  } catch (err) {
    warn(`job recovery failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Start periodic sweeper for stuck (RUNNING) jobs
  startJobSweeper();

  // Start workers
  for (let i = 1; i <= config.workerCount; i++) {
    const controller = new AbortController();
    workerSignals.push(controller);
    startWorker(i, controller.signal);
  }
});

// Graceful shutdown
const gracefulShutdown = async (signal: NodeJS.Signals): Promise<void> => {
  info(`${signal} received, shutting down gracefully`);

  // Stop workers from claiming new jobs.
  for (const controller of workerSignals) {
    controller.abort();
  }

  server.close(async () => {
    info("HTTP server closed");

    // Disconnect Redis clients
    try {
      await redis.quit();
      await redisBlocking.quit();
      info("Redis connections closed");
    } catch {
      // Ignore Redis disconnect errors during shutdown
    }

    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    warn("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
