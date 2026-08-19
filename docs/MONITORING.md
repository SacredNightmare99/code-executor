# Monitoring & Metrics Guide

## Overview

The Code Executor includes comprehensive metrics and monitoring capabilities:

- **Real-time Status Endpoint** (`/status`) - JSON formatted metrics
- **Prometheus Metrics** (`/metrics`) - Standard Prometheus format for scraping
- **Performance Tracking** - Execution times, queue wait times, percentiles
- **Job Metrics** - Submissions, completions, success rates by language
- **System Health** - Redis connectivity, memory usage, error rates

## Endpoints

### GET /status
Real-time metrics in JSON format with human-readable summary.

**Response:**
```json
{
  "timestamp": "2026-01-31T08:30:45.123Z",
  "uptime": {
    "seconds": 3600,
    "human": "1h"
  },
  "jobs": {
    "submitted": 150,
    "completed": 145,
    "accepted": 140,
    "failed": 3,
    "timeout": 2,
    "compile_error": 0,
    "success_rate": "96.55%",
    "jobs_per_second": "0.04",
    "by_language": {
      "python": {"submitted": 100, "completed": 97},
      "c": {"submitted": 50, "completed": 48}
    }
  },
  "execution": {
    "total_time_ms": 45000,
    "count": 145,
    "average_ms": 310,
    "min_ms": 50,
    "max_ms": 1800,
    "p50_ms": 250,
    "p95_ms": 800,
    "p99_ms": 1500,
    "by_language": {
      "python": {
        "total_ms": 32000,
        "count": 97,
        "average_ms": 330,
        "min_ms": 60,
        "max_ms": 1800
      },
      "c": {
        "total_ms": 13000,
        "count": 48,
        "average_ms": 270,
        "min_ms": 50,
        "max_ms": 900
      }
    }
  },
  "queue": {
    "current_size": 2,
    "max_size": 15,
    "total_dequeued": 145,
    "average_wait_time_ms": 120,
    "p50_wait_ms": 100,
    "p95_wait_ms": 300,
    "p99_wait_ms": 500
  },
  "workers": {
    "error_count": 2,
    "last_error": "2026-01-31T08:25:15.000Z"
  },
  "system": {
    "redis_connected": true,
    "memory_mb": 125,
    "error_rate": "1.33%",
    "total_requests": 150
  }
}
```

### GET /metrics
Prometheus-format metrics for scraping with Prometheus, Grafana, etc.

**Example output:**
```
# HELP code_executor_jobs_submitted Total jobs submitted
# TYPE code_executor_jobs_submitted counter
code_executor_jobs_submitted 150 1675255445123

# HELP code_executor_jobs_completed Total jobs completed
# TYPE code_executor_jobs_completed counter
code_executor_jobs_completed 145 1675255445123

# HELP code_executor_execution_time_ms Execution time in milliseconds
# TYPE code_executor_execution_time_ms gauge
code_executor_execution_time_ms{quantile="avg"} 310 1675255445123
code_executor_execution_time_ms{quantile="p95"} 800 1675255445123
code_executor_execution_time_ms{quantile="p99"} 1500 1675255445123

# ... many more metrics
```

## Monitoring Stack

### Quick Start with Docker Compose

A ready-to-run stack is provided at `deployment/docker-compose.monitoring.yml`
(code-executor, Redis, Prometheus, Grafana):

```bash
docker compose -f deployment/docker-compose.monitoring.yml up -d

# Access services (bound to localhost on the host):
# Code Executor: http://localhost:4000
# Prometheus: http://localhost:9090
# Grafana: http://localhost:3000 (user: admin, pass: from GF_ADMIN_PASSWORD or "admin")
```

Notes:
- The `code-executor` service mounts the host Docker socket
  (`/var/run/docker.sock`) so the sandbox can spawn runner containers.
- Prometheus scrapes `code-executor:4000` (the compose service name).

**prometheus.yml** (`config/prometheus.yml`):

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'code-executor'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['code-executor:4000']
    scrape_interval: 5s
```

> The scrape target is the container name `code-executor`, not `localhost` —
> Prometheus runs in its own container.

## Key Metrics to Monitor

### Job Execution
- **Success Rate**: `code_executor_success_rate` - Target: >99%
- **Jobs/Second**: `code_executor_jobs_per_second` - Throughput indicator
- **Timeout Rate**: Count of `TIME_LIMIT_EXCEEDED` - Should be <1%

### Performance
- **Execution Time P95**: `code_executor_execution_time_ms{quantile="p95"}` - Target: <500ms
- **Execution Time P99**: `code_executor_execution_time_ms{quantile="p99"}` - Target: <1000ms
- **Queue Wait P95**: `code_executor_queue_wait_time_ms{quantile="p95"}` - Target: <200ms

### System Health
- **Redis Connection**: `code_executor_redis_connected` - Should be 1
- **Memory Usage**: `code_executor_memory_mb` - Monitor for leaks
- **Error Rate**: `code_executor_error_count` - Should be 0 or very low

### Capacity
- **Queue Size**: `code_executor_queue_size` - Monitor peaks
- **Max Queue Size**: `code_executor_queue_max_size` - Capacity planning

## Grafana Dashboard Setup

### Import Pre-built Dashboard
1. Go to Grafana: http://localhost:3000
2. Dashboard → Import
3. ID: Use custom dashboard JSON (see below)

### Sample Grafana Queries

**Panel 1: Success Rate Over Time**
```promql
code_executor_success_rate
```

**Panel 2: Jobs Per Second**
```promql
rate(code_executor_jobs_completed[1m])
```

**Panel 3: Execution Time Distribution**
```promql
{
  avg: code_executor_execution_time_ms{quantile="avg"},
  p95: code_executor_execution_time_ms{quantile="p95"},
  p99: code_executor_execution_time_ms{quantile="p99"}
}
```

**Panel 4: Queue Depth Over Time**
```promql
code_executor_queue_size
```

**Panel 5: Error Count**
```promql
rate(code_executor_error_count[5m])
```

**Panel 6: Performance by Language**
```promql
code_executor_execution_time_ms{quantile="avg"} by (language)
```

## Alerting Rules

**prometheus-alerts.yml** (example — create this file and load it via the
Prometheus `rule_files` config if you want alerting):
```yaml
groups:
  - name: code-executor
    rules:
      - alert: HighErrorRate
        expr: code_executor_error_count > 10
        for: 5m
        annotations:
          summary: "High error rate detected ({{ $value }} errors)"

      - alert: HighQueueDepth
        expr: code_executor_queue_size > 100
        for: 10m
        annotations:
          summary: "Queue depth too high ({{ $value }} jobs waiting)"

      - alert: SlowExecution
        expr: code_executor_execution_time_ms{quantile="p95"} > 1000
        for: 5m
        annotations:
          summary: "P95 execution time exceeds 1s ({{ $value }}ms)"

      - alert: RedisDown
        expr: code_executor_redis_connected == 0
        for: 1m
        annotations:
          summary: "Redis connection lost"

      - alert: HighMemoryUsage
        expr: code_executor_memory_mb > 500
        for: 5m
        annotations:
          summary: "Memory usage high ({{ $value }}MB)"
```

## Metrics Collected

### Job Metrics (Counters)
- `code_executor_jobs_submitted` - Total jobs submitted
- `code_executor_jobs_completed` - Total jobs completed
- `code_executor_jobs_accepted` - Jobs with successful exit
- `code_executor_jobs_failed` - Jobs with runtime errors
- `code_executor_jobs_timeout` - Jobs that timed out
- `code_executor_jobs_compile_error` - Compilation failures

### Performance Metrics (Gauges)
- `code_executor_execution_time_ms` - Execution time with quantiles
  - `quantile="avg"` - Average
  - `quantile="min"` - Minimum
  - `quantile="max"` - Maximum
  - `quantile="p50"` - 50th percentile
  - `quantile="p95"` - 95th percentile
  - `quantile="p99"` - 99th percentile

### Queue Metrics (Gauges)
- `code_executor_queue_size` - Current queue depth
- `code_executor_queue_max_size` - Peak queue depth
- `code_executor_queue_wait_time_ms` - Queue wait time with quantiles

### System Metrics (Gauges)
- `code_executor_uptime_seconds` - Server uptime
- `code_executor_success_rate` - Percentage of successful jobs
- `code_executor_jobs_per_second` - Throughput
- `code_executor_memory_mb` - Heap memory usage
- `code_executor_redis_connected` - Redis connection status (1=connected, 0=down)
- `code_executor_error_count` - Total worker errors

## Monitoring Best Practices

1. **Set Baselines**: Run for 24+ hours, establish normal patterns
2. **Alert Thresholds**: Based on your baselines, typically:
   - Error rate > 1%
   - Queue depth > 50% of worker capacity
   - P95 execution > 2x baseline
3. **Regular Reviews**: Check dashboards daily, review trends weekly
4. **Retention Policy**: Keep Prometheus data for 30+ days
5. **Documentation**: Document alerting rules and their meanings

## Integration Examples

### DataDog
```bash
# Forward Prometheus metrics to DataDog
docker run -d \
  -e DATADOG_API_KEY=<your-key> \
  -e DD_DOCKER_LABELS_AS_TAGS='true' \
  -p 9090:9090 \
  datadog/agent:7
```

### New Relic
```javascript
// Use custom events API
import newrelic from 'newrelic';

// In metrics collection:
newrelic.recordCustomEvent('JobCompletion', {
  status: result.status,
  language: job.language,
  duration: executionTime
});
```

### CloudWatch
```javascript
import AWS from 'aws-sdk';
const cloudwatch = new AWS.CloudWatch();

// Push metrics periodically
cloudwatch.putMetricData({
  Namespace: 'CodeExecutor',
  MetricData: [
    {
      MetricName: 'SuccessRate',
      Value: metrics.getSuccessRate(),
      Unit: 'Percent'
    }
  ]
}).promise();
```

## Troubleshooting

### Metrics not appearing
1. Check `/metrics` endpoint returns data: `curl localhost:4000/metrics`
2. Check Prometheus is scraping: http://localhost:9090/targets
3. Verify scrape interval in prometheus.yml

### Gaps in metrics
1. Check if server was restarted (metrics reset)
2. Verify Prometheus storage isn't full
3. Check network connectivity between services

### High memory usage
1. In-process metric samples are capped at 10,000 entries per series
2. Check Redis `maxmemory` usage (`INFO memory`) — jobs/queues are stored there
3. Reduce `MAX_CONCURRENT`/`WORKERS` if the box is swapping

## Next Steps

1. **Set up Grafana dashboards** for your team
2. **Configure alerting rules** based on SLOs
3. **Export metrics** to external monitoring system if needed
4. **Create runbooks** for alert responses
5. **Monitor the monitors** - ensure Prometheus/Grafana stay healthy
