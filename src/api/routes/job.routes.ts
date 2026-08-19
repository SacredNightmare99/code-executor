import express from "express";
import crypto from "crypto";
import { info } from "../../infrastructure/logs/logger.ts";
import { ApiError } from "../../utils/apiError.ts";
import { ApiResponse } from "../../utils/apiResponse.ts";
import { metrics } from "../../infrastructure/metrics/metricsCollector.ts";
import { createJob, getJob, addJobToUserIndex, getUserJobIds, getUserJobCount } from "../../core/jobs/jobStore.ts";
import { enqueueJob } from "../../core/jobs/jobQueue.ts";
import { JobStatus, type JobRecord } from "../../core/jobs/jobTypes.ts";
import { authenticateJWT } from "../../middleware/authMiddleware.ts";
import { rateLimitByUser, checkRateLimit } from "../../middleware/rateLimiter.ts";
import { getAllLanguages, getLanguageById, isLanguageSupported } from "../../core/languages/languageRegistry.ts";

const router = express.Router();

/**
 * Submit Code for Execution
 * POST /submit
 * Requires JWT authentication and enforces rate limiting
 * Optional: callback_url (for webhook notification on completion)
 */
router.post("/submit", authenticateJWT, rateLimitByUser(), async (req, res, next) => {
  try {
    const { language, code, stdin, inputs, callback_url } = req.body;
    const reqId = req.requestId;
    const userId = req.user.id;

    if (!language || !code) {
      throw new ApiError(400, "Missing language or code");
    }

    if (!isLanguageSupported(language)) {
      throw new ApiError(400, `Unsupported language: ${language}`, "UNSUPPORTED_LANGUAGE");
    }

    if (stdin !== undefined && typeof stdin !== "string") {
      throw new ApiError(400, "stdin must be a string");
    }

    if (inputs !== undefined && !Array.isArray(inputs)) {
      throw new ApiError(400, "inputs must be an array of strings");
    }

    if (stdin !== undefined && inputs !== undefined) {
      throw new ApiError(400, "Provide either stdin or inputs, not both");
    }

    const normalizedInputs = inputs !== undefined
      ? inputs
      : (stdin !== undefined ? [stdin] : [""]);

    if (normalizedInputs.length === 0) {
      throw new ApiError(400, "inputs must contain at least one item");
    }
    if (normalizedInputs.length > 50) {
      throw new ApiError(400, "inputs array too large (max 50)");
    }
    for (const input of normalizedInputs) {
      if (typeof input !== "string") {
        throw new ApiError(400, "inputs must be an array of strings");
      }
      if (input.length > 100_000) {
        throw new ApiError(413, "input too large");
      }
    }

    if (callback_url !== undefined && typeof callback_url !== "string") {
      throw new ApiError(400, "callback_url must be a string");
    }

    info("submission received", { reqId, userId });
    info(`code size ${code.length} bytes`, { reqId });

    if (code.length > 100_000) {
      throw new ApiError(413, "Code too large");
    }

    if (stdin && stdin.length > 100_000) {
      throw new ApiError(413, "stdin too large");
    }

    const jobId = crypto.randomUUID();

    await createJob({
      id: jobId,
      userId,
      language,
      code,
      stdin: "",
      inputs: normalizedInputs,
      callback_url: callback_url ?? null,
      status: JobStatus.QUEUED,
      created_at: Date.now(),
    });

    await addJobToUserIndex(userId, jobId);

    await enqueueJob(jobId);

    info("job queued", { reqId, jobId, userId });

    // Record metrics
    metrics.recordSubmission(language);

    return res.status(201).json(
      ApiResponse.success(
        ApiResponse.jobResponse({ id: jobId, status: JobStatus.QUEUED }),
      ),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Get Job Result
 * GET /result/:id
 * Requires JWT authentication - users can only see their own jobs
 * Rate limit check (doesn't increment)
 */
router.get("/result/:id", authenticateJWT, checkRateLimit(), async (req, res, next) => {
  try {
    const jobId = req.params.id;
    const userId = req.user.id;
    const job = await getJob(jobId);

    if (!job) {
      return res.status(404).json(
        ApiResponse.error("Job not found", "JOB_NOT_FOUND"),
      );
    }

    // Users can only see their own jobs
    if (job.userId !== userId) {
      return res.status(403).json(
        ApiResponse.error("Forbidden", "FORBIDDEN"),
      );
    }

    const includeOutput =
      job.status !== JobStatus.QUEUED && job.status !== JobStatus.RUNNING;

    return res.json(
      ApiResponse.success(
        ApiResponse.jobResponse(job, includeOutput),
      ),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Get Job Code
 * GET /jobs/:id/code
 * Requires JWT authentication - users can only see their own code
 */
router.get("/jobs/:id/code", authenticateJWT, checkRateLimit(), async (req, res, next) => {
  try {
    const jobId = req.params.id;
    const userId = req.user.id;
    const job = await getJob(jobId);

    if (!job) {
      return res.status(404).json(
        ApiResponse.error("Job not found", "JOB_NOT_FOUND"),
      );
    }

    // Users can only see their own jobs
    if (job.userId !== userId) {
      return res.status(403).json(
        ApiResponse.error("Forbidden", "FORBIDDEN"),
      );
    }

    return res.json({
      success: true,
      data: {
        id: job.id,
        language: job.language,
        code: job.code,
        stdin: job.stdin || "",
        created_at: job.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * List User Jobs
 * GET /jobs
 * Requires JWT authentication - users see only their own jobs
 * Query params: status, language, limit, offset, from, to
 */
router.get("/jobs", authenticateJWT, checkRateLimit(), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status, language, limit = 50, offset = 0, from, to } = req.query;

    const pageLimit = Math.min(parseInt(String(limit), 10) || 50, 100);
    const pageOffset = parseInt(String(offset), 10) || 0;

    const [jobIds, total] = await Promise.all([
      getUserJobIds(userId, pageOffset, pageLimit),
      getUserJobCount(userId),
    ]);

    // Fetch all jobs in parallel
    const jobs = (
      await Promise.all(jobIds.map((id) => getJob(id)))
    ).filter((job): job is JobRecord => job !== null); // filter expired jobs

    // Apply filters in-memory
    const filtered = jobs.filter((job) => {
      if (status && job.status !== status) return false;
      if (language && job.language !== language) return false;
      const createdAt = job.created_at ?? job.createdAt ?? 0;
      if (from && createdAt < parseInt(from, 10)) return false;
      if (to && createdAt > parseInt(to, 10)) return false;
      return true;
    });

    return res.json({
      success: true,
      data: {
        jobs: filtered,
        total,
        limit: pageLimit,
        offset: pageOffset,
        filters: {
          status: status || null,
          language: language || null,
          from: from || null,
          to: to || null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get Language Info
 * GET /languages/:lang
 * No authentication required
 */
router.get("/languages/:lang", (req, res, next) => {
  try {
    const lang = req.params.lang;
    const langInfo = getLanguageById(lang);

    if (!langInfo) {
      return res.status(404).json(
        ApiResponse.error("Language not found", "LANGUAGE_NOT_FOUND"),
      );
    }

    return res.json({
      success: true,
      data: langInfo,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * List All Languages
 * GET /languages
 * No authentication required
 */
router.get("/languages", (req, res, next) => {
  try {
    const languages = getAllLanguages();

    return res.json({
      success: true,
      data: {
        languages,
        count: languages.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
