import config from "../../config/index.ts";

/**
 * Concurrency limiter for code execution.
 * Limits the number of simultaneous Docker containers running.
 */
export class ExecutionLimiter {
  max: number;
  running: number;
  queue: Array<(value?: unknown) => void>;
  maxQueue: number;

  constructor(maxConcurrent: number, maxQueue = 1000) {
    this.max = maxConcurrent;
    this.running = 0;
    this.queue = [];
    this.maxQueue = maxQueue;
  }

  async run<T>(task: () => Promise<T> | T): Promise<T> {
    if (this.running >= this.max) {
      if (this.queue.length >= this.maxQueue) {
        throw new Error("Queue full");
      }
      await new Promise((resolve) => this.queue.push(resolve));
    }

    this.running++;

    try {
      return await task();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        this.queue.shift()?.();
      }
    }
  }
}

export const executionLimiter = new ExecutionLimiter(
  config.maxConcurrent,
  config.maxQueue,
);
