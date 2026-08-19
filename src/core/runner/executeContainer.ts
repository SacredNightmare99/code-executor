import { spawn, execFile } from "child_process";
import { JobStatus, type ExecutionResult } from "../jobs/jobTypes.ts";
import { truncateOutput, MAX_OUTPUT_SIZE } from "../../utils/outputHandler.ts";
import config from "../../config/index.ts";

/**
 * Execute a command inside a Docker container with stdin support,
 * output truncation, and timeout enforcement.
 *
 * This is the shared execution core used by both Python and C binary runners.
 *
 * @param {string[]} dockerArgs - Full docker run arguments
 * @param {string|null} stdin   - stdin data to pipe into the container
 * @param {string} containerId  - Container name (for cleanup on timeout)
 * @returns {Promise<{status: string, stdout: string, stderr: string, exit_code: number|null}>}
 */
export function executeContainer(
  dockerArgs: string[],
  stdin: string | number | null | undefined,
  containerId: string,
): Promise<ExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", dockerArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Handle stdin errors (e.g. EPIPE if container exits early)
    child.stdin.on("error", () => {
      // Ignore write errors to closed stdin pipe
    });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;

    let finished = false;
    const done = (result: ExecutionResult): void => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutTruncated) return;
      if (stdout.length + chunk.length > MAX_OUTPUT_SIZE) {
        stdoutTruncated = true;
        stdout = truncateOutput(stdout);
        try {
          child.stdout.destroy();
        } catch {
          // ignore
        }
        return;
      }
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrTruncated) return;
      if (stderr.length + chunk.length > MAX_OUTPUT_SIZE) {
        stderrTruncated = true;
        stderr = truncateOutput(stderr);
        try {
          child.stderr.destroy();
        } catch {
          // ignore
        }
        return;
      }
      stderr += chunk;
    });

    // Pipe stdin
    const input = stdin == null ? "" : String(stdin);
    child.stdin.end(input);

    // Timeout enforcement
    const killTimer = setTimeout(() => {
      // Asynchronously kill the container first (ensures cleanup without blocking event loop)
      execFile("docker", ["kill", containerId], { timeout: 2000 }, () => {
        // ignore errors — container may already be dead
      });

      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }

      done({
        status: JobStatus.TIME_LIMIT_EXCEEDED,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        exit_code: null,
      });
    }, config.execTimeoutMs);

    child.on("close", (code) => {
      done({
        status: code === 0 ? JobStatus.ACCEPTED : JobStatus.RUNTIME_ERROR,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        exit_code: code,
      });
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      reject(err);
    });
  });
}
