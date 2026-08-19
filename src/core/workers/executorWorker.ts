import { dequeueJob, completeJobProcessing, getQueueSize } from "../jobs/jobQueue.ts";
import { getJob, updateJob } from "../jobs/jobStore.ts";
import { JobStatus } from "../jobs/jobTypes.ts";
import runCode from "../runner/runCode.ts";
import { executionLimiter } from "../limits/executionLimiter.ts";
import { metrics } from "../../infrastructure/metrics/metricsCollector.ts";
import { onJobCompleted } from "../webhooks/webhookDispatcher.ts";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Sleep that resolves early if the provided signal aborts. */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function startWorker(id: number, signal?: AbortSignal): Promise<void> {
  console.log(`[WORKER ${id}] started`);

  let consecutiveErrors = 0;

  while (!signal?.aborted) {
    let jobId: string | null = null;
    try {
      jobId = await dequeueJob();
      if (!jobId) continue;

      // Keep the in-memory queue metrics in sync with Redis.
      try {
        metrics.updateQueueSize(await getQueueSize());
        metrics.recordQueueDequeue();
      } catch {
        // best-effort metrics update
      }

      const job = await getJob(jobId);
      if (!job) {
        console.warn(`[WORKER ${id}] job ${jobId} not found, skipping`);
        await completeJobProcessing(jobId);
        consecutiveErrors = 0;
        continue;
      }

      const createdAt = job.created_at ?? job.createdAt ?? Date.now();
      const queueWaitTime = Date.now() - createdAt;

      await updateJob(jobId, {
        status: JobStatus.RUNNING,
        started_at: Date.now(),
      });

      // Execution is isolated in its own try/catch: a failure here (e.g. the
      // execution limiter queue is full, or the sandbox throws) must fail the
      // job and move on — NOT retry forever leaving the job stuck RUNNING.
      try {
        const executionStart = Date.now();
        const result = await executionLimiter.run(() => runCode(job));
        const executionTime = Date.now() - executionStart;
        const finishedAt = Date.now();

        const compileTime = result.metrics?.compile_time_ms ?? 0;
        const execTime = result.metrics?.exec_time_ms ?? 0;
        const totalTime = finishedAt - createdAt;

        await updateJob(jobId, {
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
          exit_code: result.exit_code,
          results: "results" in result ? result.results : undefined,
          finished_at: finishedAt,
          metrics: {
            queue_wait_ms: queueWaitTime,
            compile_time_ms: compileTime,
            exec_time_ms: execTime,
            total_time_ms: totalTime,
          },
        });

        metrics.recordCompletion(result.status, job.language, executionTime, queueWaitTime);
      } catch (runErr) {
        console.error(`[WORKER ${id}] execution failed for job ${jobId}:`, errorMessage(runErr));
        await updateJob(jobId, {
          status: JobStatus.SYSTEM_ERROR,
          stderr: errorMessage(runErr),
          finished_at: Date.now(),
        });
      }

      await completeJobProcessing(jobId);

      // Trigger webhooks for job completion
      if (job.userId) {
        const updatedJob = await getJob(jobId);
        try {
          if (updatedJob) await onJobCompleted(job.userId, updatedJob);
        } catch (err) {
          console.error(`[WORKER ${id}] webhook error for job ${jobId}:`, errorMessage(err));
          // Don't fail the job if webhook fails
        }
      }

      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      metrics.recordWorkerError();
      if (jobId) {
        try {
          await completeJobProcessing(jobId);
        } catch {
          // best-effort cleanup
        }
      }
      const backoff = Math.min(100 * Math.pow(2, consecutiveErrors - 1), 5000);
      console.error(`[WORKER ${id}] error (attempt ${consecutiveErrors}):`, errorMessage(err));

      // Reset errors on successful retry after backoff
      await sleepAbortable(backoff, signal);
    }
  }

  console.log(`[WORKER ${id}] stopped`);
}
