import { spawn, spawnSync } from "child_process";
import { JobStatus, type ExecutionResult } from "../jobs/jobTypes.ts";
import { truncateOutput, MAX_OUTPUT_SIZE } from "../../utils/outputHandler.ts";
import { buildSandboxArgs, generateContainerId } from "./sandbox.ts";

/**
 * Build the docker arguments for a Java compile+run container.
 *
 * Exported separately so the exact sandbox constraints (memory override,
 * gVisor, dropped capabilities, read-only, tmpfs, container name) are unit
 * testable without spawning anything.
 *
 * @param {string} dir         - Host directory containing Main.java
 * @param {string} containerId - Container name (must match for timeout cleanup)
 * @returns {string[]} Array of docker arguments
 */
export function buildJavaArgs(dir: string, containerId: string): string[] {
  const runCmd = "javac /app/Main.java && java -cp /app Main";

  return buildSandboxArgs({
    containerId,
    image: "runner-java",
    interactive: true,
    hostDir: dir,
    memory: "128m",
    cpus: "1",
    pidsLimit: "100",
    tmpfsSize: "64m",
    cmd: ["/bin/sh", "-c", runCmd],
  });
}

/**
 * Compile and run Java code inside a single Docker container.
 *
 * Uses the shared sandbox argument builder so Java gets the same security
 * posture as Python/C (gVisor runtime, dropped capabilities, read-only root
 * fs, tmpfs, non-root user) while allowing higher resource limits.
 *
 * @param {string} dir - Host directory containing Main.java
 * @param {string|null} input - stdin data to pipe to the program
 * @returns {Promise<{status: string, stdout: string, stderr: string, exit_code: number|null}>}
 */
export function runJava(dir: string, input: string | number | null | undefined): Promise<ExecutionResult> {
  const containerId = generateContainerId();
  const dockerArgs = buildJavaArgs(dir, containerId);

  return new Promise((resolve) => {
    const child = spawn("docker", dockerArgs, {
      stdio: ["pipe", "pipe", "pipe"],
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
        return;
      }
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrTruncated) return;
      if (stderr.length + chunk.length > MAX_OUTPUT_SIZE) {
        stderrTruncated = true;
        stderr = truncateOutput(stderr);
        return;
      }
      stderr += chunk;
    });

    const inputData = input == null ? "" : String(input);
    child.stdin.end(inputData);

    // Timeout enforcement
    // Java needs more time for JVM startup + compilation + execution
    const javaTimeout = 8000; // 8 seconds for Java (vs 2s for Python/C)
    const killTimer = setTimeout(() => {
      // Kill the container by its unique name (ensures cleanup even if the
      // docker client hangs). `--rm` alone won't clean up when the client is
      // killed, so an explicit kill is required.
      try {
        spawnSync("docker", ["kill", containerId], { timeout: 2000 });
      } catch {
        // ignore — container may already be dead
      }

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
    }, javaTimeout);

    child.on("close", (code) => {
      // Determine if it's a compile error or runtime error
      const isCompileError =
        stderr?.includes("error:") &&
        (stderr?.includes("cannot find symbol") ||
          stderr?.includes("';' expected") ||
          stderr?.includes("class declaration expected"));

      done({
        status: code === 0 ? JobStatus.ACCEPTED : isCompileError ? JobStatus.COMPILE_ERROR : JobStatus.RUNTIME_ERROR,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        exit_code: code,
      });
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      resolve({
        status: JobStatus.RUNTIME_ERROR,
        stdout: "",
        stderr: err.message,
        exit_code: null,
      });
    });
  });
}
