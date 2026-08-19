import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MetricsCollector } from "../../src/infrastructure/metrics/metricsCollector.ts";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe("recordSubmission", () => {
    it("should increment submitted count", () => {
      collector.recordSubmission("python");
      assert.equal(collector.jobs.submitted, 1);
    });

    it("should track submissions by language", () => {
      collector.recordSubmission("python");
      collector.recordSubmission("python");
      collector.recordSubmission("c");
      assert.equal(collector.jobs.by_language.python.submitted, 2);
      assert.equal(collector.jobs.by_language.c.submitted, 1);
    });

    it("should increment total_requests", () => {
      collector.recordSubmission("python");
      assert.equal(collector.system.total_requests, 1);
    });
  });

  describe("recordCompletion", () => {
    it("should increment completed count", () => {
      collector.recordSubmission("python");
      collector.recordCompletion("ACCEPTED", "python", 100, 5);
      assert.equal(collector.jobs.completed, 1);
    });

    it("should track accepted jobs", () => {
      collector.recordSubmission("python");
      collector.recordCompletion("ACCEPTED", "python", 100, 5);
      assert.equal(collector.jobs.accepted, 1);
    });

    it("should track failed jobs", () => {
      collector.recordSubmission("python");
      collector.recordCompletion("RUNTIME_ERROR", "python", 100, 5);
      assert.equal(collector.jobs.failed, 1);
    });

    it("should track timeout jobs", () => {
      collector.recordSubmission("python");
      collector.recordCompletion("TIME_LIMIT_EXCEEDED", "python", 2000, 5);
      assert.equal(collector.jobs.timeout, 1);
    });

    it("should track compile errors", () => {
      collector.recordSubmission("c");
      collector.recordCompletion("COMPILE_ERROR", "c", 50, 5);
      assert.equal(collector.jobs.compile_error, 1);
    });

    it("should track execution time min/max", () => {
      collector.recordSubmission("python");
      collector.recordCompletion("ACCEPTED", "python", 100, 5);
      collector.recordSubmission("python");
      collector.recordCompletion("ACCEPTED", "python", 200, 5);
      assert.equal(collector.execution.min_time, 100);
      assert.equal(collector.execution.max_time, 200);
    });

    it("should track execution time by language", () => {
      collector.recordSubmission("python");
      collector.recordCompletion("ACCEPTED", "python", 150, 5);
      assert.equal(collector.execution.by_language.python.count, 1);
      assert.equal(collector.execution.by_language.python.total, 150);
    });

    it("should track queue wait times", () => {
      collector.recordSubmission("python");
      collector.recordCompletion("ACCEPTED", "python", 100, 25);
      assert.equal(collector.queue.queue_wait_times.length, 1);
      assert.equal(collector.queue.queue_wait_times[0], 25);
    });
  });

  describe("recordWorkerError", () => {
    it("should increment error count", () => {
      collector.recordWorkerError();
      assert.equal(collector.workers.error_count, 1);
    });

    it("should record last error timestamp", () => {
      collector.recordWorkerError();
      assert.ok(collector.workers.last_error);
    });

    it("should increment system error count", () => {
      collector.recordWorkerError();
      assert.equal(collector.system.error_requests, 1);
    });
  });

  describe("getSuccessRate", () => {
    it("should return 0 when no jobs completed", () => {
      assert.equal(collector.getSuccessRate(), 0);
    });

    it("should calculate correct success rate", () => {
      collector.recordSubmission("python");
      collector.recordCompletion("ACCEPTED", "python", 100, 5);
      collector.recordSubmission("python");
      collector.recordCompletion("RUNTIME_ERROR", "python", 100, 5);
      assert.equal(collector.getSuccessRate(), "50.00");
    });

    it("should return 100% when all accepted", () => {
      collector.recordSubmission("python");
      collector.recordCompletion("ACCEPTED", "python", 100, 5);
      assert.equal(collector.getSuccessRate(), "100.00");
    });
  });

  describe("getAverageExecutionTime", () => {
    it("should return 0 when no executions", () => {
      assert.equal(collector.getAverageExecutionTime(), 0);
    });

    it("should calculate correct average", () => {
      collector.recordSubmission("python");
      collector.recordCompletion("ACCEPTED", "python", 100, 5);
      collector.recordSubmission("python");
      collector.recordCompletion("ACCEPTED", "python", 200, 5);
      assert.equal(collector.getAverageExecutionTime(), 150);
    });
  });

  describe("getExecutionTimePercentile", () => {
    it("should return 0 when no data", () => {
      assert.equal(collector.getExecutionTimePercentile(50), 0);
    });

    it("should calculate percentiles correctly", () => {
      // Add 100 samples: 1, 2, 3, ..., 100
      for (let i = 1; i <= 100; i++) {
        collector.recordSubmission("python");
        collector.recordCompletion("ACCEPTED", "python", i, 1);
      }
      const p50 = collector.getExecutionTimePercentile(50);
      const p95 = collector.getExecutionTimePercentile(95);
      const p99 = collector.getExecutionTimePercentile(99);

      assert.ok(p50 <= p95, "p50 should be <= p95");
      assert.ok(p95 <= p99, "p95 should be <= p99");
    });
  });

  describe("getPrometheusMetrics", () => {
    it("should return valid prometheus format", () => {
      collector.recordSubmission("python");
      collector.recordCompletion("ACCEPTED", "python", 100, 5);

      const output = collector.getPrometheusMetrics();
      assert.ok(output.includes("code_executor_jobs_submitted"));
      assert.ok(output.includes("code_executor_jobs_completed"));
      assert.ok(output.includes("# HELP"));
      assert.ok(output.includes("# TYPE"));
    });

    it("should include all required metrics", () => {
      const output = collector.getPrometheusMetrics();
      const requiredMetrics = [
        "code_executor_jobs_submitted",
        "code_executor_jobs_completed",
        "code_executor_execution_time_ms",
        "code_executor_queue_size",
        "code_executor_redis_connected",
        "code_executor_success_rate",
        "code_executor_uptime_seconds",
        "code_executor_memory_mb",
      ];

      for (const metric of requiredMetrics) {
        assert.ok(
          output.includes(metric),
          `Missing required metric: ${metric}`,
        );
      }
    });
  });

  describe("getMetricsSummary", () => {
    it("should return structured summary object", () => {
      collector.updateSystemMetrics();
      const summary = collector.getMetricsSummary();

      assert.ok(summary.timestamp);
      assert.ok(summary.uptime);
      assert.ok(summary.jobs);
      assert.ok(summary.execution);
      assert.ok(summary.queue);
      assert.ok(summary.workers);
      assert.ok(summary.system);
    });
  });

  describe("formatUptime", () => {
    it("should format seconds correctly", () => {
      assert.equal(collector.formatUptime(30), "30s");
    });

    it("should format minutes and seconds", () => {
      assert.equal(collector.formatUptime(90), "1m 30s");
    });

    it("should format hours", () => {
      assert.equal(collector.formatUptime(3661), "1h 1m 1s");
    });

    it("should format days", () => {
      assert.equal(collector.formatUptime(86401), "1d 1s");
    });
  });

  describe("reset", () => {
    it("should reset all counters", () => {
      collector.recordSubmission("python");
      collector.recordCompletion("ACCEPTED", "python", 100, 5);
      collector.recordWorkerError();

      collector.reset();

      assert.equal(collector.jobs.submitted, 0);
      assert.equal(collector.jobs.completed, 0);
      assert.equal(collector.workers.error_count, 0);
      assert.equal(collector.execution.count, 0);
    });
  });
});
