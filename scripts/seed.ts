#!/usr/bin/env node

/**
 * Database Seeding Script
 * Creates test users with different tiers and roles
 * 
 * Usage: node scripts/seed.js
 */

import { createUser, getUserByUsername, type CreateUserInput, type UserTier } from "../src/core/auth/userStore.ts";
import { redis } from "../src/infrastructure/redis/redisClient.ts";

type Color = "green" | "blue" | "yellow" | "red" | "reset" | "";
type SeedUser = CreateUserInput & { tier: UserTier; role: "admin" | "user"; description: string };

const testUsers: SeedUser[] = [
  {
    username: "admin",
    email: "admin@localhost",
    password: "AdminPass123!",
    tier: "enterprise",
    role: "admin",
    description: "Admin user with enterprise tier",
  },
  {
    username: "alice",
    email: "alice@localhost",
    password: "AlicePass123!",
    tier: "free",
    role: "user",
    description: "Free tier user",
  },
  {
    username: "bob",
    email: "bob@localhost",
    password: "BobPass123!",
    tier: "starter",
    role: "user",
    description: "Starter tier user (50 req/min)",
  },
  {
    username: "charlie",
    email: "charlie@localhost",
    password: "CharliePass123!",
    tier: "professional",
    role: "user",
    description: "Professional tier user (100 req/min)",
  },
  {
    username: "diana",
    email: "diana@localhost",
    password: "DianaPass123!",
    tier: "enterprise",
    role: "user",
    description: "Enterprise tier user (500 req/min)",
  },
];

const colors = {
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
};

function log(msg: string, color: Color = "reset"): void {
  console.log(`${color ? colors[color] : ""}${msg}${colors.reset}`);
}

async function seed(): Promise<void> {
  try {
    log("\n🌱 Database Seeding Started\n", "blue");

    // Check Redis connection
    try {
      await redis.ping();
      log("✓ Redis connected", "green");
    } catch {
      log(
        "✗ Redis not available. Make sure Redis is running on localhost:6379",
        "red",
      );
      process.exit(1);
    }

    log("\nCreating test users...\n", "yellow");

    let created = 0;
    let skipped = 0;

    for (const userData of testUsers) {
      try {
        // Check if user already exists
        const existing = await getUserByUsername(userData.username);
        if (existing) {
          log(
            `⊘ Skipped ${userData.username} (already exists)`,
            "yellow",
          );
          skipped++;
          continue;
        }

        // Create user
        await createUser(userData);
        log(
          `✓ Created ${userData.username.padEnd(10)} - ${userData.tier.padEnd(12)} tier - ${userData.description}`,
          "green",
        );
        created++;
      } catch (err) {
        log(
          `✗ Failed to create ${userData.username}: ${err.message}`,
          "red",
        );
      }
    }

    log("\n📊 Summary:", "blue");
    log(`  Created: ${created}`, "green");
    log(`  Skipped: ${skipped}`, "yellow");
    log(`  Total:   ${created + skipped}`, "blue");

    log("\n🎯 Test Users Created:", "blue");
    log("\nLogin with any of these credentials:", "yellow");
    testUsers.forEach((user) => {
      if (!user.role || user.role === "user") {
        const limits: Record<UserTier, string> = {
          free: "10",
          starter: "50",
          professional: "100",
          enterprise: "500",
        };
        log(
          `  ${user.username.padEnd(10)} / ${user.password.padEnd(20)} (${limits[user.tier]} req/min)`,
          "green",
        );
      }
    });

    log("\nAdmin User:", "yellow");
    log("  admin / AdminPass123! (enterprise tier)", "green");

    log("\n💡 Quick Test Commands:\n", "blue");
    log("1. Get token:", "yellow");
    log(
      "   TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \\",
      "",
    );
    log(
      '     -H "Content-Type: application/json" \\',
      "",
    );
    log(
      '     -d \'{"username":"alice","password":"AlicePass123!"}\' \\',
      "",
    );
    log('     | jq ".data.accessToken" -r)', "");

    log("\n2. Use token:", "yellow");
    log(
      "   curl -X POST http://localhost:4000/submit \\",
      "",
    );
    log('     -H "Authorization: Bearer $TOKEN" \\', "");
    log(
      '     -H "Content-Type: application/json" \\',
      "",
    );
    log(
      '     -d \'{"language":"python","code":"print(1+1)"}\' | jq .',
      "",
    );

    log("\n3. Upgrade user tier (admin only):", "yellow");
    log(
      "   curl -X POST http://localhost:4000/admin/users/USER_ID/upgrade \\",
      "",
    );
    log('     -H "Authorization: Bearer $ADMIN_TOKEN" \\', "");
    log(
      '     -H "Content-Type: application/json" \\',
      "",
    );
    log('     -d \'{"newTier":"professional"}\' | jq .', "");

    log("\n✅ Seeding Complete!\n", "green");
  } catch (err) {
    log(`\n❌ Seeding failed: ${err.message}\n`, "red");
    console.error(err);
    process.exit(1);
  }
}

seed().finally(() => {
  redis.disconnect();
});
