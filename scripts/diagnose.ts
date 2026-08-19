#!/usr/bin/env node

import { execSync } from "child_process";
import http from "http";

console.log("🔍 Diagnosing Code Executor Environment...\n");

interface CheckResult {
  name: string;
  status: "✓" | "✗" | "⚠";
  message: string;
}

const checks: CheckResult[] = [];

// Check 1: Node.js version
try {
  const version = process.version;
  checks.push({
    name: "Node.ts",
    status: "✓",
    message: version,
  });
} catch (err) {
  checks.push({
    name: "Node.ts",
    status: "✗",
    message: err.message,
  });
}

// Check 2: Docker
try {
  const docker = execSync("docker --version", { encoding: "utf-8" }).trim();
  checks.push({
    name: "Docker",
    status: "✓",
    message: docker,
  });
} catch {
  checks.push({
    name: "Docker",
    status: "✗",
    message: "Not installed or not accessible",
  });
}

// Check 3: gVisor (runsc)
try {
  const runsc = execSync("runsc --version", { encoding: "utf-8" }).trim();
  checks.push({
    name: "gVisor (runsc)",
    status: "✓",
    message: runsc.split("\n")[0],
  });
} catch {
  checks.push({
    name: "gVisor (runsc)",
    status: "⚠",
    message: "Not installed - tests will use default runtime",
  });
}

// Check 4: Docker images
const images = ["runner-c", "runner-py", "runner-java", "runner-runtime"];
for (const image of images) {
  try {
    execSync(`docker inspect ${image} > /dev/null 2>&1`, { stdio: "pipe" });
    checks.push({
      name: `Docker image: ${image}`,
      status: "✓",
      message: "Found",
    });
  } catch {
    checks.push({
      name: `Docker image: ${image}`,
      status: "✗",
      message: "Not found - run: docker build -f deployment/docker/runner-<lang>.Dockerfile -t runner-<lang> .",
    });
  }
}

// Check 5: Redis
try {
  const redis = execSync(
    "redis-cli ping 2>/dev/null || echo 'Not available'",
    { encoding: "utf-8" },
  ).trim();
  checks.push({
    name: "Redis",
    status: redis === "PONG" ? "✓" : "⚠",
    message: redis === "PONG" ? "Running" : "Not available or not responding",
  });
} catch {
  checks.push({
    name: "Redis",
    status: "✗",
    message: "Connection failed",
  });
}

// Check 6: Server
function checkServer(): Promise<CheckResult> {
  return new Promise((resolve) => {
    const req = http.get("http://localhost:4000/health", (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data) as { status?: string };
          if (res.statusCode === 200 && json.status) {
            resolve({
              name: "Server (localhost:4000)",
              status: "✓",
              message: `HTTP ${res.statusCode} - ${json.status}`,
            });
          } else {
            resolve({
              name: "Server (localhost:4000)",
              status: "⚠",
              message: `HTTP ${res.statusCode}`,
            });
          }
        } catch {
          resolve({
            name: "Server (localhost:4000)",
            status: "⚠",
            message: "Running but health check failed",
          });
        }
      });
    });

    req.on("error", (_err) => {
      resolve({
        name: "Server (localhost:4000)",
        status: "✗",
        message: "Not running - start with: npm run dev",
      });
    });

    req.setTimeout(2000, () => {
      req.destroy();
      resolve({
        name: "Server (localhost:4000)",
        status: "✗",
        message: "Connection timeout",
      });
    });
  });
}

// Run async server check
checkServer().then((serverCheck) => {
  checks.push(serverCheck);

  // Print results
  console.log("Environment Checks:");
  console.log("─".repeat(70));

  for (const check of checks) {
    const status = check.status === "✓" ? "✅" : check.status === "✗" ? "❌" : "⚠️";
    console.log(`${status} ${check.name.padEnd(35)} ${check.message}`);
  }

  console.log("─".repeat(70));

  // Recommendations
  const hasIssues = checks.some((c) => c.status === "✗");
  const hasWarnings = checks.some((c) => c.status === "⚠");

  if (hasIssues || hasWarnings) {
    console.log("\n🔧 Recommendations:\n");

    if (checks.find((c) => c.name.includes("Docker image"))?.status === "✗") {
      console.log("1. Build Docker images:");
      console.log("   docker build -f deployment/docker/runner-c.Dockerfile -t runner-c .");
      console.log("   docker build -f deployment/docker/runner-py.Dockerfile -t runner-py .");
      console.log("   docker build -f deployment/docker/runner-java.Dockerfile -t runner-java .");
      console.log("   docker build -f deployment/docker/runner-runtime.Dockerfile -t runner-runtime .\n");
    }

    if (checks.find((c) => c.name === "gVisor (runsc)")?.status === "⚠") {
      console.log("2. Install gVisor (optional but recommended):");
      console.log("   curl -fsSL https://gvisor.dev/archive/latest/runsc > /usr/local/bin/runsc");
      console.log("   chmod +x /usr/local/bin/runsc");
      console.log("   Or disable for testing: export DISABLE_GVISOR=true\n");
    }

    if (checks.find((c) => c.name === "Redis")?.status !== "✓") {
      console.log("3. Start Redis:");
      console.log("   redis-server\n");
    }

    if (checks.find((c) => c.name.includes("localhost:4000"))?.status !== "✓") {
      console.log("4. Start the server:");
      console.log("   npm run dev\n");
    }
  }

  if (!hasIssues) {
    console.log("✅ All critical checks passed!\n");
  }

  if (hasWarnings) {
    console.log("⚠️  Note: Some optional features may not be available.\n");
  }
});
