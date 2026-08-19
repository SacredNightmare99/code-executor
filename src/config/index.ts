import { execFileSync } from "child_process";
import os from "os";

/**
 * Centralized Configuration Module
 *
 * Single source of truth for all environment-driven configuration.
 * `createConfig(env)` is exported so tests can exercise config resolution
 * with arbitrary environments; the module default is built from process.env.
 */

// ─── Types ─────────────────────────────────────────────────────

export interface GVisorStatus {
  available: boolean;
  reason: string;
}

export type RunnerMode = "docker" | "mock";

export interface SandboxConfig {
  memoryLimit: string;
  cpuLimit: string;
  pidsLimit: string;
  network: string;
  tmpfsSize: string;
  compileTmpfsSize: string;
  readOnly: boolean;
  user: string;
  securityOpts: string[];
  capDrop: string[];
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  workerCount: number;
  redisUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshTokenExpiresIn: string;
  execTimeoutMs: number;
  maxConcurrent: number;
  maxQueue: number;
  jobTtlSeconds: number;
  runnerMode: RunnerMode;
  runnerWorkspace: string;
  authRegisterLimit: number;
  authLoginLimit: number;
  sandbox: SandboxConfig;
}

// ─── Helpers ──────────────────────────────────────────────────

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function optionalEnv(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  return value !== undefined && value !== "" ? value : fallback;
}

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = optionalEnv(env, key, String(fallback));
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be a number, got: ${raw}`);
  }
  return parsed;
}

function boolEnv(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = optionalEnv(env, key, String(fallback));
  return raw === "true" || raw === "1";
}

const DEFAULT_JWT_SECRET = "change-this-secret-in-production";

/**
 * Resolve the JWT secret, refusing to run with the default in production.
 * An attacker who knows the default secret can forge tokens for any user.
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv): string {
  const value = optionalEnv(env, "JWT_SECRET", "");
  const isProd = optionalEnv(env, "NODE_ENV", "development") === "production";
  if (isProd && (value === "" || value === DEFAULT_JWT_SECRET)) {
    throw new Error(
      "JWT_SECRET must be set to a strong, random value in production",
    );
  }
  return value || DEFAULT_JWT_SECRET;
}

/**
 * Parse time string (e.g., "15m", "7d") to seconds.
 * Supports s(econds), m(inutes), h(ours), d(ays).
 */
export function parseTimeToSeconds(timeStr: string): number {
  const match = String(timeStr).match(/^(\d+)([smhd])$/);
  if (!match) return 604800; // default 7 days

  const value = parseInt(match[1], 10);
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  const unit = match[2] as keyof typeof multipliers;
  return value * (multipliers[unit] || 86400);
}

// ─── Configuration Builder ─────────────────────────────────────

export function createConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = optionalEnv(env, "NODE_ENV", "development");
  const runnerModeRaw = optionalEnv(env, "RUNNER_MODE", "docker");

  return Object.freeze({
    // Server
    port: intEnv(env, "PORT", 4000),
    nodeEnv,
    isProduction: nodeEnv === "production",

    // Workers
    workerCount: intEnv(env, "WORKERS", 1),

    // Redis
    redisUrl: optionalEnv(env, "REDIS_URL", "redis://localhost:6379"),

  // JWT
  jwtSecret: resolveJwtSecret(env),
  jwtExpiresIn: optionalEnv(env, "JWT_EXPIRES_IN", "15m"),
  refreshTokenExpiresIn: optionalEnv(env, "REFRESH_TOKEN_EXPIRES_IN", "7d"),

  // Auth rate limits (per IP, per minute)
  authRegisterLimit: intEnv(env, "AUTH_REGISTER_LIMIT", 10),
  authLoginLimit: intEnv(env, "AUTH_LOGIN_LIMIT", 20),

    // Execution
    execTimeoutMs: intEnv(env, "EXEC_TIMEOUT_MS", 2000),
    maxConcurrent: intEnv(env, "MAX_CONCURRENT", 2),
    maxQueue: intEnv(env, "MAX_QUEUE", 200),

    // Job storage
    jobTtlSeconds: intEnv(env, "JOB_TTL_SECONDS", 86400),

    // Runner mode: "docker" (real sandbox) or "mock" (tests, no containers)
    runnerMode: runnerModeRaw === "mock" ? "mock" : "docker",

    // Directory where job source files are created. In containerized
    // deployments this must be a path that is identical on the host so the
    // Docker daemon can bind-mount it into runner containers.
    runnerWorkspace: optionalEnv(env, "RUNNER_WORKSPACE", os.tmpdir()),

    // Sandbox
    sandbox: Object.freeze({
      memoryLimit: optionalEnv(env, "SANDBOX_MEMORY", "128m"),
      cpuLimit: "0.5",
      pidsLimit: "32",
      network: "none",
      tmpfsSize: "16m",
      compileTmpfsSize: "64m",
      readOnly: true,
      user: "runner",
      securityOpts: ["no-new-privileges"],
      capDrop: ["ALL"],
    }),
  });
}

// ─── Singleton (from process.env) ──────────────────────────────

const config: AppConfig = createConfig(process.env);

// ─── gVisor Detection ──────────────────────────────────────────

/**
 * Detect gVisor availability.
 * Returns { available: boolean, reason: string }
 */
function detectGVisor(): GVisorStatus {
  if (boolEnv(process.env, "DISABLE_GVISOR", false)) {
    return { available: false, reason: "DISABLE_GVISOR is set to true in environment" };
  }

  // Mock mode never spawns containers, so skip the docker probe.
  if (config.runnerMode === "mock") {
    return { available: false, reason: "RUNNER_MODE=mock (sandbox disabled for tests)" };
  }

  try {
    const output = execFileSync(
      "docker",
      ["info", "--format", "{{json .Runtimes}}"],
      { timeout: 5000, stdio: "pipe", encoding: "utf-8" },
    );

    if (output.includes("runsc")) {
      return { available: true, reason: "runsc runtime found in Docker" };
    }

    return { available: false, reason: "runsc runtime not registered in Docker (see: gVisor install docs)" };
  } catch (err) {
    return { available: false, reason: `Docker check failed: ${getErrorMessage(err)}` };
  }
}

// ─── gVisor: detect lazily (so tests can skip/override) ────────

let _gvisorResult: GVisorStatus | null = null;

export function isGVisorAvailable(): boolean {
  if (_gvisorResult === null) {
    _gvisorResult = detectGVisor();
  }
  return _gvisorResult.available;
}

/**
 * Get full gVisor detection status (for startup logging).
 * @returns {{ available: boolean, reason: string }}
 */
export function getGVisorStatus(): GVisorStatus {
  if (_gvisorResult === null) {
    _gvisorResult = detectGVisor();
  }
  return _gvisorResult;
}

/**
 * Override gVisor detection result (for testing).
 */
export function setGVisorOverride(value: boolean | null): void {
  if (value === null) {
    _gvisorResult = null;
  } else {
    _gvisorResult = { available: value, reason: "overridden by test" };
  }
}

export default config;
