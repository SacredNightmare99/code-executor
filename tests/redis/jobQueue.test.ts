import "../helpers/env.ts";
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  enqueueJob,
  dequeueJob,
  completeJobProcessing,
  requeueProcessingJobs,
  getQueueSize,
  getProcessingSize,
} from "../../src/core/jobs/jobQueue.ts";
import { flushTestDb, closeRedis } from "../helpers/redis.ts";

describe("jobQueue", () => {
  beforeEach(async () => {
    await flushTestDb();
  });

  after(async () => {
    await flushTestDb();
    await closeRedis();
  });

  it("should enqueue and dequeue a job id", async () => {
    await enqueueJob("job-1");
    assert.equal(await getQueueSize(), 1);

    const jobId = await dequeueJob();
    assert.equal(jobId, "job-1");
    assert.equal(await getQueueSize(), 0);
  });

  it("should move jobs to the processing list on dequeue", async () => {
    await enqueueJob("job-2");
    const jobId = await dequeueJob();
    assert.equal(jobId, "job-2");
    assert.equal(await getProcessingSize(), 1);
    assert.equal(await getQueueSize(), 0);
  });

  it("should remove jobs from processing on completion", async () => {
    await enqueueJob("job-3");
    await dequeueJob();
    await completeJobProcessing("job-3");
    assert.equal(await getProcessingSize(), 0);
  });

  it("should return null when the queue is empty (timeout)", async () => {
    const jobId = await dequeueJob(1);
    assert.equal(jobId, null);
  });

  it("should dequeue jobs in FIFO order", async () => {
    await enqueueJob("job-a");
    await enqueueJob("job-b");
    await enqueueJob("job-c");

    assert.equal(await dequeueJob(), "job-a");
    assert.equal(await dequeueJob(), "job-b");
    assert.equal(await dequeueJob(), "job-c");
    assert.equal(await getQueueSize(), 0);
  });

  it("should requeue processing jobs back to the queue", async () => {
    await enqueueJob("job-4");
    await enqueueJob("job-5");
    await dequeueJob();
    await dequeueJob();

    assert.equal(await getProcessingSize(), 2);

    const requeued = await requeueProcessingJobs();
    assert.equal(requeued.length, 2);
    assert.equal(await getProcessingSize(), 0);
    assert.equal(await getQueueSize(), 2);
  });

  it("should preserve FIFO order when requeueing processing jobs", async () => {
    await enqueueJob("job-a");
    await enqueueJob("job-b");
    await enqueueJob("job-c");

    await dequeueJob(); // job-a
    await dequeueJob(); // job-b

    const requeued = await requeueProcessingJobs();
    assert.equal(requeued.length, 2);

    // Requeued jobs keep their original order relative to pending entries.
    assert.equal(await dequeueJob(), "job-a");
    assert.equal(await dequeueJob(), "job-b");
    assert.equal(await dequeueJob(), "job-c");
  });
});
