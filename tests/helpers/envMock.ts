/**
 * Test environment for API tests: base env + RUNNER_MODE=mock so jobs are
 * executed by the deterministic in-process mock runner (no Docker needed).
 * Import FIRST, before any src module.
 */
import "./env.ts";

process.env.RUNNER_MODE = "mock";

export {};
