import config, { isGVisorAvailable } from "../../config/index.ts";

/**
 * Centralized Docker sandbox argument builder.
 *
 * Single source of truth for container security constraints.
 * Used by all runners (Python, C compile, C binary) to ensure consistent sandboxing.
 */

/**
 * Generate a unique container ID for tracking and cleanup.
 * @returns {string}
 */
export interface SandboxArgsOptions {
  containerId?: string;
  image: string;
  interactive?: boolean;
  tmpfsSize?: string;
  readOnly?: boolean;
  user?: string;
  memory?: string;
  cpus?: string;
  pidsLimit?: string;
  hostDir: string;
  cmd: string[];
}

export interface CompileArgsOptions {
  hostDir: string;
  image: string;
  cmd: string[];
}

export function generateContainerId(): string {
  return `runner-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Build the base docker run arguments with all security constraints.
 *
 * @param {Object} options
 * @param {string}  options.containerId  - Unique container name
 * @param {string}  options.image        - Docker image to use
 * @param {boolean} [options.interactive] - Whether to pass -i (for stdin)
 * @param {string}  [options.tmpfsSize]  - Override tmpfs size (default from config)
 * @param {boolean} [options.readOnly]   - Mount root filesystem read-only (default true)
 * @param {string}  [options.user]       - Container user (default "runner")
 * @param {string}  [options.memory]     - Override memory limit (default from config)
 * @param {string}  [options.cpus]       - Override CPU limit (default from config)
 * @param {string}  [options.pidsLimit]  - Override process limit (default from config)
 * @param {string}  options.hostDir      - Host directory to mount at /app
 * @param {string[]} options.cmd         - Command and arguments to execute
 * @returns {string[]} Array of docker arguments
 */
export function buildSandboxArgs(options: SandboxArgsOptions): string[] {
  const {
    containerId,
    image,
    interactive = false,
    tmpfsSize,
    readOnly = true,
    user,
    memory,
    cpus,
    pidsLimit,
    hostDir,
    cmd,
  } = options;

  const sb = config.sandbox;
  const args = ["run", "--rm"];

  if (interactive) {
    args.push("-i");
  }

  if (containerId) {
    args.push("--name", containerId);
  }

  // gVisor runtime (if available and not disabled)
  if (isGVisorAvailable()) {
    args.push("--runtime=runsc");
  }

  // Resource constraints
  args.push(
    `--memory=${memory || sb.memoryLimit}`,
    `--cpus=${cpus || sb.cpuLimit}`,
    `--pids-limit=${pidsLimit || sb.pidsLimit}`,
    `--network=${sb.network}`,
  );

  // Security hardening
  for (const cap of sb.capDrop) {
    args.push(`--cap-drop=${cap}`);
  }
  for (const opt of sb.securityOpts) {
    args.push(`--security-opt=${opt}`);
  }

  // Filesystem
  if (readOnly) {
    args.push("--read-only");
  }

  args.push(
    "--tmpfs",
    `/tmp:rw,nosuid,noexec,size=${tmpfsSize || sb.tmpfsSize}`,
  );

  // User isolation
  args.push(`--user=${user || sb.user}`);

  // Mount working directory
  args.push("-v", `${hostDir}:/app:rw`);
  args.push("-w", "/app");

  // Image and command
  args.push(image, ...cmd);

  return args;
}

/**
 * Build docker arguments for compilation steps.
 * Slightly relaxed constraints (larger tmpfs, no read-only for build artifacts).
 *
 * @param {Object} options
 * @param {string} options.hostDir - Host directory to mount
 * @param {string} options.image   - Compiler image
 * @param {string[]} options.cmd   - Compile command
 * @returns {string[]}
 */
export function buildCompileArgs(options: CompileArgsOptions): string[] {
  const { hostDir, image, cmd } = options;
  const sb = config.sandbox;

  const args = ["run", "--rm"];

  // gVisor runtime
  if (isGVisorAvailable()) {
    args.push("--runtime=runsc");
  }

  args.push(`--network=${sb.network}`);

  // Security
  for (const cap of sb.capDrop) {
    args.push(`--cap-drop=${cap}`);
  }
  for (const opt of sb.securityOpts) {
    args.push(`--security-opt=${opt}`);
  }

  // Larger tmpfs for compilation
  args.push("--tmpfs", `/tmp:rw,nosuid,noexec,size=${sb.compileTmpfsSize}`);

  // Mount
  args.push("-v", `${hostDir}:/app:rw`);
  args.push("-w", "/app");

  // Image and command
  args.push(image, ...cmd);

  return args;
}
