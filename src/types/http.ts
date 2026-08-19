import type { Request } from "express";
import type { JobStatus } from "../core/jobs/jobTypes.ts";

export type { JobStatus };

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
  tier?: string;
  rateLimit?: number;
  role?: "admin" | "user";
  authMethod?: "jwt" | "apikey";
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  apiKey?: string;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

export interface JobResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
}

export interface JobResponseData {
  id: string;
  status: JobStatus;
  language: string;
  created_at?: number;
  completed_at?: number;
  metrics?: Record<string, unknown>;
  results?: JobResult[];
}
