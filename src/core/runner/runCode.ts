import fs from "fs";
import path from "path";
import { JobStatus, type ExecutionMetrics, type ExecutionResult, type JobRecord, type JobStatusValue } from "../jobs/jobTypes.ts";

import config from "../../config/index.ts";
import { compileC } from "./compileC.ts";
import { runBinary } from "./runBinary.ts";
import { runPython } from "./runPython.ts";
import { runJava } from "./runJava.ts";

export interface MultiInputRunResult {
  status: JobStatusValue;
  results: ExecutionResult[];
  stdout: "";
  stderr: "";
  exit_code: null;
  metrics: ExecutionMetrics;
}

export type RunCodeResult = (ExecutionResult & { metrics: ExecutionMetrics }) | MultiInputRunResult;

interface CompileFailure {
  stderr?: string;
  message?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function compileFailureMessage(err: unknown): string {
  const failure = err as CompileFailure;
  return failure.stderr || failure.message || "Compilation failed";
}

function getOverallStatus(results: ExecutionResult[]): JobStatusValue {
  return results.every((r) => r.status === JobStatus.ACCEPTED)
    ? JobStatus.ACCEPTED
    : results.find((r) => r.status !== JobStatus.ACCEPTED)?.status ?? JobStatus.SYSTEM_ERROR;
}

function withInput(input: string | number | null | undefined, result: ExecutionResult): ExecutionResult {
  return {
    stdin: input == null ? "" : String(input),
    ...result,
  };
}

/**
 * Deterministic runner used in tests (RUNNER_MODE=mock). Never spawns Docker.
 * Result is driven by sentinel strings in the submitted code so tests can
 * exercise every status path:
 *   - "compile-error"  -> COMPILE_ERROR
 *   - "timeout"        -> TIME_LIMIT_EXCEEDED
 *   - "runtime-error"  -> RUNTIME_ERROR
 *   - anything else    -> ACCEPTED
 */
function mockRun(job: JobRecord): RunCodeResult {
  const hasMultipleInputs = Array.isArray(job.inputs) && job.inputs.length > 0;
  const inputs: Array<string | number | null | undefined> = hasMultipleInputs
    ? job.inputs!
    : [job.stdin];

  const results: ExecutionResult[] = inputs.map((input) => {
    const stdin = input == null ? "" : String(input);
    const code = job.code;

    if (code.includes("compile-error")) {
      return { stdin, status: JobStatus.COMPILE_ERROR, stdout: "", stderr: "Mock compile error", exit_code: 1 };
    }
    if (code.includes("timeout")) {
      return { stdin, status: JobStatus.TIME_LIMIT_EXCEEDED, stdout: "", stderr: "Mock timeout", exit_code: null };
    }
    if (code.includes("runtime-error")) {
      return { stdin, status: JobStatus.RUNTIME_ERROR, stdout: "", stderr: "Mock runtime error", exit_code: 1 };
    }
    return {
      stdin,
      status: JobStatus.ACCEPTED,
      stdout: `mock output (${stdin})`,
      stderr: "",
      exit_code: 0,
    };
  });

  const overallStatus = getOverallStatus(results);

  if (hasMultipleInputs) {
    return {
      status: overallStatus,
      results,
      stdout: "",
      stderr: "",
      exit_code: null as number | null,
      metrics: { compile_time_ms: 0, exec_time_ms: results.length },
    };
  }

  return {
    ...results[0]!,
    metrics: { compile_time_ms: 0, exec_time_ms: 1 },
  };
}

export default async function runCode(job: JobRecord): Promise<RunCodeResult> {
  if (config.runnerMode === "mock") {
    return mockRun(job);
  }

  const dir = fs.mkdtempSync(path.join(config.runnerWorkspace, "run-"));
  fs.chmodSync(dir, 0o777);
  const hasMultipleInputs = Array.isArray(job.inputs) && job.inputs.length > 0;
  const inputs: Array<string | number | null | undefined> = hasMultipleInputs ? job.inputs! : [job.stdin];

  try {
    if (job.language === "c") {
      const cPath = path.join(dir, "main.c");
      fs.writeFileSync(cPath, job.code);
      fs.chmodSync(cPath, 0o644);

      const compileStart = Date.now();
      try {
        await compileC(dir);
      } catch (err) {
        const compileTime = Date.now() - compileStart;
        return {
          status: JobStatus.COMPILE_ERROR,
          stdout: "",
          stderr: compileFailureMessage(err),
          exit_code: null as number | null,
          metrics: {
            compile_time_ms: compileTime,
            exec_time_ms: 0,
          },
        };
      }

      const compileTime = Date.now() - compileStart;
      const results: ExecutionResult[] = [];
      let execTimeTotal = 0;

      for (const input of inputs) {
        const execStart = Date.now();
        const execResult = await runBinary(dir, input);
        const execTime = Date.now() - execStart;
        execTimeTotal += execTime;
        results.push(withInput(input, execResult));
      }

      const overallStatus = getOverallStatus(results);

      const response = hasMultipleInputs
        ? {
          status: overallStatus,
          results,
          stdout: "",
          stderr: "",
          exit_code: null as number | null,
        }
        : {
          ...results[0]!,
        };

      return {
        ...response,
        metrics: {
          compile_time_ms: compileTime,
          exec_time_ms: execTimeTotal,
        },
      };
    }

    if (job.language === "python") {
      const pyPath = path.join(dir, "main.py");
      fs.writeFileSync(pyPath, job.code);
      fs.chmodSync(pyPath, 0o644);
      const results: ExecutionResult[] = [];
      let execTimeTotal = 0;

      for (const input of inputs) {
        const execStart = Date.now();
        const execResult = await runPython(dir, input);
        const execTime = Date.now() - execStart;
        execTimeTotal += execTime;
        results.push(withInput(input, execResult));
      }

      const overallStatus = getOverallStatus(results);

      const response = hasMultipleInputs
        ? {
          status: overallStatus,
          results,
          stdout: "",
          stderr: "",
          exit_code: null as number | null,
        }
        : {
          ...results[0]!,
        };

      return {
        ...response,
        metrics: {
          compile_time_ms: 0,
          exec_time_ms: execTimeTotal,
        },
      };
    }

    if (job.language === "java") {
      const javaPath = path.join(dir, "Main.java");
      fs.writeFileSync(javaPath, job.code);
      fs.chmodSync(javaPath, 0o644);
      const results: ExecutionResult[] = [];
      let execTimeTotal = 0;

      for (const input of inputs) {
        const execStart = Date.now();
        const execResult = await runJava(dir, input);
        const execTime = Date.now() - execStart;
        execTimeTotal += execTime;
        results.push(withInput(input, execResult));
      }

      const overallStatus = getOverallStatus(results);

      const response = hasMultipleInputs
        ? {
          status: overallStatus,
          results,
          stdout: "",
          stderr: "",
          exit_code: null as number | null,
        }
        : {
          ...results[0]!,
        };

      return {
        ...response,
        metrics: {
          compile_time_ms: 0,
          exec_time_ms: execTimeTotal,
        },
      };
    }

    return {
      status: JobStatus.SYSTEM_ERROR,
      stdout: "",
      stderr: "Unsupported language",
      exit_code: null,
      metrics: {
        compile_time_ms: 0,
        exec_time_ms: 0,
      },
    };
  } catch (err) {
    return {
      status: JobStatus.SYSTEM_ERROR,
      stdout: "",
      stderr: errorMessage(err) || "Internal error",
      exit_code: null,
      metrics: {
        compile_time_ms: 0,
        exec_time_ms: 0,
      },
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
