export const JobStatus = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",

  ACCEPTED: "ACCEPTED",
  COMPILE_ERROR: "COMPILE_ERROR",
  RUNTIME_ERROR: "RUNTIME_ERROR",
  TIME_LIMIT_EXCEEDED: "TIME_LIMIT_EXCEEDED",
  MEMORY_LIMIT_EXCEEDED: "MEMORY_LIMIT_EXCEEDED",

  SYSTEM_ERROR: "SYSTEM_ERROR",
} as const;

export type JobStatusValue = (typeof JobStatus)[keyof typeof JobStatus];
export type JobStatus = JobStatusValue;

export interface ExecutionMetrics {
  [key: string]: number;
  compile_time_ms: number;
  exec_time_ms: number;
}

export interface ExecutionResult {
  stdin?: string;
  status: JobStatusValue;
  stdout: string;
  stderr: string;
  exit_code: number | null;
}

export interface JobRecord {
  id: string;
  userId?: string | null;
  language: string;
  code: string;
  status: JobStatusValue;
  stdout?: string;
  stderr?: string;
  exit_code?: number | null;
  callback_url?: string;
  inputs?: Array<string | number | null>;
  stdin?: string;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  completedAt?: number;
  started_at?: number;
  finished_at?: number;
  metrics?: Record<string, number>;
  results?: ExecutionResult[];
}
