import { execFile } from "child_process";
import { promisify } from "util";
import { JobStatus } from "../jobs/jobTypes.ts";
import { buildCompileArgs, generateContainerId } from "./sandbox.ts";

const execFileAsync = promisify(execFile);

/**
 * Compile C++ source code inside a sandboxed Docker container.
 *
 * @param {string} dir - Host directory containing main.cpp
 * @throws {{ status: string, stderr: string }} on compilation failure
 */
interface ExecFileError extends Error {
  stderr?: string;
}

export interface CompileError {
  status: typeof JobStatus.COMPILE_ERROR;
  stderr: string;
}

export const COMPILE_TIMEOUT_MS = 10000;

export async function compileCpp(dir: string): Promise<void> {
  const containerId = generateContainerId();
  const compileCmd =
    "g++ /app/main.cpp -O2 -std=c++17 -pipe -o /app/a.out && chmod 755 /app/a.out";

  const dockerArgs = buildCompileArgs({
    containerId,
    hostDir: dir,
    image: "runner-cpp",
    cmd: ["/bin/sh", "-c", compileCmd],
  });

  try {
    await execFileAsync("docker", dockerArgs, { timeout: COMPILE_TIMEOUT_MS });
  } catch (err) {
    const execError = err as ExecFileError & { killed?: boolean; signal?: string };
    const isTimeout = execError.killed || execError.signal === "SIGTERM";

    if (isTimeout) {
      execFile("docker", ["kill", containerId], { timeout: 2000 }, () => {
        // ignore errors
      });
    }

    throw {
      status: JobStatus.COMPILE_ERROR,
      stderr: isTimeout
        ? "Compilation timed out (exceeded 10s limit)"
        : (execError.stderr || execError.message),
    } satisfies CompileError;
  }
}
