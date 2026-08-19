import "../helpers/env.ts";
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createJob, updateJob, getJob } from "../../src/core/jobs/jobStore.ts";
import { enqueueJob, dequeueJob, getQueueSize } from "../../src/core/jobs/jobQueue.ts";
import { JobStatus, type JobRecord } from "../../src/core/jobs/jobTypes.ts";
import { recoverInFlightJobs, sweepStaleJobs } from "../../src/core/workers/jobRecovery.ts";
import { flushTestDb, closeRedis } from "../helpers/redis.ts";

function makeJob(id: string, overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id,
    userId: "user-1",
    language: "python",
    code: "print('hi')",
    status: JobStatus.QUEUED,
    created_at: Date.now(),
    ...overrides,
  };
}

describe("jobRecovery", () => {
  beforeEach(async () => {
    await flushTestDb();
  });

  after(async () => {
    await flushTestDb();
    await closeRedis();
  });

  it("should requeue jobs stuck in the processing list", async () => {
    await createJob(makeJob("proc-1"));
    await enqueueJob("proc-1");
    await dequeueJob(); // atomically moves proc-1 to the processing list

    const recovered = await recoverInFlightJobs();
    assert.equal(recovered, 1);

    // The job should now be back in the queue and consumable.
    assert.equal(await dequeueJob(), "proc-1");
  });

  it("should reset RUNNING jobs to QUEUED and re-enqueue them", async () => {
    await createJob(makeJob("running-1"));
    await updateJob("running-1", { status: JobStatus.RUNNING, started_at: Date.now() });

    const recovered = await recoverInFlightJobs();
    assert.equal(recovered, 1);

    const job = await getJob("running-1");
    assert.equal(job?.status, JobStatus.QUEUED);
    assert.equal(await dequeueJob(), "running-1");
  });

  it("should not touch QUEUED jobs that are already in the queue", async () => {
    await createJob(makeJob("queued-1"));
    await enqueueJob("queued-1");

    const recovered = await recoverInFlightJobs();
    assert.equal(recovered, 0);

    assert.equal((await getJob("queued-1"))?.status, JobStatus.QUEUED);
    assert.equal(await dequeueJob(), "queued-1");
  });

  it("should not double-enqueue jobs that are both processing and RUNNING", async () => {
    await createJob(makeJob("dupe-1", { status: JobStatus.RUNNING, started_at: Date.now() }));
    await enqueueJob("dupe-1");
    await dequeueJob(); // moves dupe-1 to the processing list

    const recovered = await recoverInFlightJobs();
    assert.equal(recovered, 1);

    // Exactly one queue entry, so the job cannot execute twice.
    assert.equal(await getQueueSize(), 1);
    assert.equal(await dequeueJob(), "dupe-1");
    assert.equal(await dequeueJob(1), null);
  });

  it("should mark stale RUNNING jobs as SYSTEM_ERROR", async () => {
    await createJob(makeJob("stale-1", { status: JobStatus.RUNNING, started_at: Date.now() - 120_000 }));

    const failed = await sweepStaleJobs();
    assert.equal(failed, 1);

    const job = await getJob("stale-1");
    assert.equal(job?.status, JobStatus.SYSTEM_ERROR);
    assert.ok(job?.stderr?.includes("recovered"));
    assert.ok(job?.finished_at);
  });

  it("should leave fresh RUNNING jobs alone", async () => {
    await createJob(makeJob("fresh-1", { status: JobStatus.RUNNING, started_at: Date.now() }));

    const failed = await sweepStaleJobs();
    assert.equal(failed, 0);
    assert.equal((await getJob("fresh-1"))?.status, JobStatus.RUNNING);
  });
});
