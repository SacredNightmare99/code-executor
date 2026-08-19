/**
 * Comprehensive Metrics Collection System
 * Tracks job execution, performance, and system health
 */

interface LanguageJobMetrics {
  submitted: number;
  completed: number;
}

interface LanguageExecutionMetrics {
  total: number;
  count: number;
  min: number;
  max: number;
}

interface MetricsJobs {
  submitted: number;
  completed: number;
  accepted: number;
  failed: number;
  timeout: number;
  compile_error: number;
  by_language: Record<string, LanguageJobMetrics>;
}

interface MetricsExecution {
  total_time: number;
  min_time: number;
  max_time: number;
  count: number;
  by_language: Record<string, LanguageExecutionMetrics>;
}

interface MetricsQueue {
  current_size: number;
  max_size: number;
  total_dequeued: number;
  avg_queue_wait_time: number;
  queue_wait_times: number[];
}

interface MetricsWorkers {
  active: number;
  total_processed: number;
  error_count: number;
  last_error: string | null;
}

interface MetricsSystem {
  redis_connected: boolean;
  last_redis_check: number;
  uptime_start: number;
  memory_usage: NodeJS.MemoryUsage;
  total_requests: number;
  error_requests: number;
}

interface MetricsPerformance {
  execution_times: number[];
  queue_wait_times: number[];
}

export class MetricsCollector {
  jobs: MetricsJobs;
  execution: MetricsExecution;
  queue: MetricsQueue;
  workers: MetricsWorkers;
  system: MetricsSystem;
  performance: MetricsPerformance;

  constructor() {
    // Job metrics
    this.jobs = {
      submitted: 0,
      completed: 0,
      accepted: 0,
      failed: 0,
      timeout: 0,
      compile_error: 0,
      by_language: {},
    };

    // Execution metrics (in milliseconds)
    this.execution = {
      total_time: 0,
      min_time: Infinity,
      max_time: 0,
      count: 0,
      by_language: {},
    };

    // Queue metrics
    this.queue = {
      current_size: 0,
      max_size: 0,
      total_dequeued: 0,
      avg_queue_wait_time: 0,
      queue_wait_times: [],
    };

    // Worker metrics
    this.workers = {
      active: 0,
      total_processed: 0,
      error_count: 0,
      last_error: null,
    };

    // System metrics
    this.system = {
      redis_connected: true,
      last_redis_check: Date.now(),
      uptime_start: Date.now(),
      memory_usage: process.memoryUsage(),
      total_requests: 0,
      error_requests: 0,
    };

    // Performance histogram (for percentiles)
    this.performance = {
      execution_times: [],
      queue_wait_times: [],
    };
  }

  // ==================== JOB METRICS ====================

  recordSubmission(language: string): void {
    this.jobs.submitted++;
    if (!this.jobs.by_language[language]) {
      this.jobs.by_language[language] = { submitted: 0, completed: 0 };
    }
    this.jobs.by_language[language].submitted++;
    this.system.total_requests++;
  }

  recordCompletion(status: string, language: string, executionTime: number, queueWaitTime: number): void {
    this.jobs.completed++;
    
    // Record by status
    switch (status) {
      case "ACCEPTED":
        this.jobs.accepted++;
        break;
      case "RUNTIME_ERROR":
        this.jobs.failed++;
        break;
      case "TIME_LIMIT_EXCEEDED":
        this.jobs.timeout++;
        break;
      case "COMPILE_ERROR":
        this.jobs.compile_error++;
        break;
    }

    // Record by language
    if (language && this.jobs.by_language[language]) {
      this.jobs.by_language[language].completed++;
    }

    // Record execution time
    if (executionTime) {
      this.execution.total_time += executionTime;
      this.execution.count++;
      this.execution.min_time = Math.min(this.execution.min_time, executionTime);
      this.execution.max_time = Math.max(this.execution.max_time, executionTime);
      this.performance.execution_times.push(executionTime);
      if (this.performance.execution_times.length > 10000) {
        this.performance.execution_times.shift();
      }

      // Track by language
      if (language) {
        if (!this.execution.by_language[language]) {
          this.execution.by_language[language] = { total: 0, count: 0, min: Infinity, max: 0 };
        }
        this.execution.by_language[language].total += executionTime;
        this.execution.by_language[language].count++;
        this.execution.by_language[language].min = Math.min(
          this.execution.by_language[language].min,
          executionTime,
        );
        this.execution.by_language[language].max = Math.max(
          this.execution.by_language[language].max,
          executionTime,
        );
      }
    }

    // Record queue wait time
    if (queueWaitTime) {
      this.queue.queue_wait_times.push(queueWaitTime);
      this.performance.queue_wait_times.push(queueWaitTime);
      if (this.performance.queue_wait_times.length > 10000) {
        this.performance.queue_wait_times.shift();
      }
      this.updateAverageQueueWaitTime();
    }
  }

  recordWorkerError(): void {
    this.workers.error_count++;
    this.workers.last_error = new Date().toISOString();
    this.system.error_requests++;
  }

  recordRedisCheck(connected: boolean): void {
    this.system.redis_connected = connected;
    this.system.last_redis_check = Date.now();
  }

  // ==================== QUEUE METRICS ====================

  updateQueueSize(size: number): void {
    this.queue.current_size = size;
    this.queue.max_size = Math.max(this.queue.max_size, size);
  }

  recordQueueDequeue(): void {
    this.queue.total_dequeued++;
  }

  updateAverageQueueWaitTime(): void {
    if (this.queue.queue_wait_times.length === 0) return;
    const sum = this.queue.queue_wait_times.reduce((a, b) => a + b, 0);
    this.queue.avg_queue_wait_time = Math.round(sum / this.queue.queue_wait_times.length);

    // Keep only last 1000 samples
    if (this.queue.queue_wait_times.length > 1000) {
      this.queue.queue_wait_times.shift();
    }
  }

  // ==================== SYSTEM METRICS ====================

  updateSystemMetrics(): void {
    this.system.memory_usage = process.memoryUsage();
  }

  // ==================== GETTERS ====================

  getSuccessRate(): string | 0 {
    if (this.jobs.completed === 0) return 0;
    return ((this.jobs.accepted / this.jobs.completed) * 100).toFixed(2);
  }

  getAverageExecutionTime(): number {
    if (this.execution.count === 0) return 0;
    return Math.round(this.execution.total_time / this.execution.count);
  }

  getExecutionTimePercentile(percentile: number): number {
    if (this.performance.execution_times.length === 0) return 0;
    const sorted = [...this.performance.execution_times].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    return sorted[index] || 0;
  }

  getQueueWaitTimePercentile(percentile: number): number {
    if (this.performance.queue_wait_times.length === 0) return 0;
    const sorted = [...this.performance.queue_wait_times].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    return sorted[index] || 0;
  }

  getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.system.uptime_start) / 1000);
  }

  getJobsPerSecond(): string | 0 {
    const uptime = this.getUptimeSeconds();
    if (uptime === 0) return 0;
    return (this.jobs.completed / uptime).toFixed(2);
  }

  getErrorRate(): string | 0 {
    if (this.system.total_requests === 0) return 0;
    return ((this.system.error_requests / this.system.total_requests) * 100).toFixed(2);
  }

  // ==================== SUMMARY ====================

  getMetricsSummary(): Record<string, unknown> {
    return {
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: this.getUptimeSeconds(),
        human: this.formatUptime(this.getUptimeSeconds()),
      },
      jobs: {
        submitted: this.jobs.submitted,
        completed: this.jobs.completed,
        accepted: this.jobs.accepted,
        failed: this.jobs.failed,
        timeout: this.jobs.timeout,
        compile_error: this.jobs.compile_error,
        success_rate: `${this.getSuccessRate()}%`,
        jobs_per_second: this.getJobsPerSecond(),
        by_language: this.jobs.by_language,
      },
      execution: {
        total_time_ms: this.execution.total_time,
        count: this.execution.count,
        average_ms: this.getAverageExecutionTime(),
        min_ms: this.execution.min_time === Infinity ? 0 : this.execution.min_time,
        max_ms: this.execution.max_time,
        p50_ms: this.getExecutionTimePercentile(50),
        p95_ms: this.getExecutionTimePercentile(95),
        p99_ms: this.getExecutionTimePercentile(99),
        by_language: Object.keys(this.execution.by_language).reduce<Record<string, {
          total_ms: number;
          count: number;
          average_ms: number;
          min_ms: number;
          max_ms: number;
        }>>((acc, lang) => {
          const stats = this.execution.by_language[lang];
          acc[lang] = {
            total_ms: stats.total,
            count: stats.count,
            average_ms: Math.round(stats.total / stats.count),
            min_ms: stats.min,
            max_ms: stats.max,
          };
          return acc;
        }, {}),
      },
      queue: {
        current_size: this.queue.current_size,
        max_size: this.queue.max_size,
        total_dequeued: this.queue.total_dequeued,
        average_wait_time_ms: this.queue.avg_queue_wait_time,
        p50_wait_ms: this.getQueueWaitTimePercentile(50),
        p95_wait_ms: this.getQueueWaitTimePercentile(95),
        p99_wait_ms: this.getQueueWaitTimePercentile(99),
      },
      workers: {
        error_count: this.workers.error_count,
        last_error: this.workers.last_error,
      },
      system: {
        redis_connected: this.system.redis_connected,
        memory_mb: Math.round(this.system.memory_usage.heapUsed / 1024 / 1024),
        error_rate: `${this.getErrorRate()}%`,
        total_requests: this.system.total_requests,
      },
    };
  }

  // ==================== PROMETHEUS FORMAT ====================

  getPrometheusMetrics(): string {
    const lines: string[] = [];
    const ts = Date.now();

    // Job metrics
    lines.push("# HELP code_executor_jobs_submitted Total jobs submitted");
    lines.push("# TYPE code_executor_jobs_submitted counter");
    lines.push(`code_executor_jobs_submitted ${this.jobs.submitted} ${ts}`);

    lines.push("# HELP code_executor_jobs_completed Total jobs completed");
    lines.push("# TYPE code_executor_jobs_completed counter");
    lines.push(`code_executor_jobs_completed ${this.jobs.completed} ${ts}`);

    lines.push("# HELP code_executor_jobs_accepted Total jobs accepted");
    lines.push("# TYPE code_executor_jobs_accepted counter");
    lines.push(`code_executor_jobs_accepted ${this.jobs.accepted} ${ts}`);

    lines.push("# HELP code_executor_jobs_failed Total jobs failed");
    lines.push("# TYPE code_executor_jobs_failed counter");
    lines.push(`code_executor_jobs_failed ${this.jobs.failed} ${ts}`);

    lines.push("# HELP code_executor_jobs_timeout Total jobs timed out");
    lines.push("# TYPE code_executor_jobs_timeout counter");
    lines.push(`code_executor_jobs_timeout ${this.jobs.timeout} ${ts}`);

    lines.push("# HELP code_executor_jobs_compile_error Total compilation errors");
    lines.push("# TYPE code_executor_jobs_compile_error counter");
    lines.push(`code_executor_jobs_compile_error ${this.jobs.compile_error} ${ts}`);

    // Execution time metrics
    lines.push("# HELP code_executor_execution_time_ms Execution time in milliseconds");
    lines.push("# TYPE code_executor_execution_time_ms gauge");
    lines.push(`code_executor_execution_time_ms{quantile="avg"} ${this.getAverageExecutionTime()} ${ts}`);
    lines.push(`code_executor_execution_time_ms{quantile="min"} ${this.execution.min_time === Infinity ? 0 : this.execution.min_time} ${ts}`);
    lines.push(`code_executor_execution_time_ms{quantile="max"} ${this.execution.max_time} ${ts}`);
    lines.push(`code_executor_execution_time_ms{quantile="p50"} ${this.getExecutionTimePercentile(50)} ${ts}`);
    lines.push(`code_executor_execution_time_ms{quantile="p95"} ${this.getExecutionTimePercentile(95)} ${ts}`);
    lines.push(`code_executor_execution_time_ms{quantile="p99"} ${this.getExecutionTimePercentile(99)} ${ts}`);

    // Queue metrics
    lines.push("# HELP code_executor_queue_size Current queue size");
    lines.push("# TYPE code_executor_queue_size gauge");
    lines.push(`code_executor_queue_size ${this.queue.current_size} ${ts}`);

    lines.push("# HELP code_executor_queue_max_size Maximum queue size");
    lines.push("# TYPE code_executor_queue_max_size gauge");
    lines.push(`code_executor_queue_max_size ${this.queue.max_size} ${ts}`);

    lines.push("# HELP code_executor_queue_wait_time_ms Queue wait time in milliseconds");
    lines.push("# TYPE code_executor_queue_wait_time_ms gauge");
    lines.push(`code_executor_queue_wait_time_ms{quantile="avg"} ${this.queue.avg_queue_wait_time} ${ts}`);
    lines.push(`code_executor_queue_wait_time_ms{quantile="p50"} ${this.getQueueWaitTimePercentile(50)} ${ts}`);
    lines.push(`code_executor_queue_wait_time_ms{quantile="p95"} ${this.getQueueWaitTimePercentile(95)} ${ts}`);
    lines.push(`code_executor_queue_wait_time_ms{quantile="p99"} ${this.getQueueWaitTimePercentile(99)} ${ts}`);

    // System metrics
    lines.push("# HELP code_executor_uptime_seconds Server uptime in seconds");
    lines.push("# TYPE code_executor_uptime_seconds gauge");
    lines.push(`code_executor_uptime_seconds ${this.getUptimeSeconds()} ${ts}`);

    lines.push("# HELP code_executor_success_rate Job success rate percentage");
    lines.push("# TYPE code_executor_success_rate gauge");
    lines.push(`code_executor_success_rate ${this.getSuccessRate()} ${ts}`);

    lines.push("# HELP code_executor_jobs_per_second Jobs processed per second");
    lines.push("# TYPE code_executor_jobs_per_second gauge");
    lines.push(`code_executor_jobs_per_second ${this.getJobsPerSecond()} ${ts}`);

    lines.push("# HELP code_executor_memory_mb Memory usage in megabytes");
    lines.push("# TYPE code_executor_memory_mb gauge");
    lines.push(`code_executor_memory_mb ${Math.round(this.system.memory_usage.heapUsed / 1024 / 1024)} ${ts}`);

    lines.push("# HELP code_executor_redis_connected Redis connection status (1=connected, 0=disconnected)");
    lines.push("# TYPE code_executor_redis_connected gauge");
    lines.push(`code_executor_redis_connected ${this.system.redis_connected ? 1 : 0} ${ts}`);

    lines.push("# HELP code_executor_error_count Total errors");
    lines.push("# TYPE code_executor_error_count counter");
    lines.push(`code_executor_error_count ${this.workers.error_count} ${ts}`);

    return lines.join("\n");
  }

  // ==================== UTILS ====================

  formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    if (secs > 0) parts.push(`${secs}s`);

    return parts.join(" ");
  }

  reset(): void {
    this.jobs = {
      submitted: 0,
      completed: 0,
      accepted: 0,
      failed: 0,
      timeout: 0,
      compile_error: 0,
      by_language: {},
    };
    this.execution = {
      total_time: 0,
      min_time: Infinity,
      max_time: 0,
      count: 0,
      by_language: {},
    };
    this.queue = {
      current_size: 0,
      max_size: 0,
      total_dequeued: 0,
      avg_queue_wait_time: 0,
      queue_wait_times: [],
    };
    this.workers = {
      active: 0,
      total_processed: 0,
      error_count: 0,
      last_error: null,
    };
    this.system.uptime_start = Date.now();
  }
}

// Export singleton instance
export const metrics = new MetricsCollector();
