#!/usr/bin/env node

/**
 * Admin Seeding Script
 * Creates the initial admin account based on environment variables.
 * Required if starting with a fresh database.
 * 
 * Usage: node scripts/seed-admin.js
 */

import "dotenv/config";
import { createUser, getUserByUsername } from "../src/core/auth/userStore.ts";
import { redis } from "../src/infrastructure/redis/redisClient.ts";

const colors = {
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
};

type Color = keyof typeof colors;

function log(msg: string, color: Color = "reset"): void {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

async function seedAdmin(): Promise<void> {
  try {
    log("\n🛡️  Admin Account Seeding Started\n", "blue");

    // Check Redis connection
    try {
      await redis.ping();
      log("✓ Redis connected", "green");
    } catch {
      log(
        "✗ Redis not available. Make sure Redis is running.",
        "red",
      );
      process.exit(1);
    }

    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "AdminPass123!";

    log(`Checking for existing admin user: ${username}...`, "yellow");

    const existing = await getUserByUsername(username);
    if (existing) {
      log(
        `⊘ Skipped: Admin user '${username}' already exists.`,
        "yellow",
      );
      
      // If the user exists but isn't an admin, we shouldn't automatically upgrade them here
      // without warning, but for simplicity we'll just skip.
      if (existing.role !== "admin") {
        log(`⚠ Note: User '${username}' exists but does not have the 'admin' role.`, "red");
      }
    } else {
      log(`Creating admin user: ${username}...`, "yellow");
      await createUser({
        username,
        email: `${username}@localhost`,
        password,
        tier: "enterprise",
        role: "admin",
        description: "Primary admin account",
      });
      log(`✓ Successfully created admin user: ${username}`, "green");
      log(`  Password: ${password}`, "yellow");
    }

    log("\n✅ Admin seeding complete!\n", "green");
  } catch (err) {
    log(`\n❌ Seeding failed: ${err.message}\n`, "red");
    console.error(err);
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

seedAdmin();
