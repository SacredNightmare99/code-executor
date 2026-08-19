/**
 * Structured API error with HTTP status code and machine-readable error code.
 */
export class ApiError extends Error {
  statusCode: number;
  code: string | null;
  details: unknown;

  /**
   * @param {number} statusCode - HTTP status code
   * @param {string} message    - Human-readable error message
   * @param {string} [code]     - Machine-readable error code (e.g. "RATE_LIMIT_EXCEEDED")
   * @param {*}      [details]  - Optional additional details for logging
   */
  constructor(statusCode: number, message: string, code: string | null = null, details: unknown = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }
}
