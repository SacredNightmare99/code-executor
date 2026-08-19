/**
 * Test environment that exercises PRODUCTION config paths (error handler
 * message hiding, JWT secret guard, etc.). Import FIRST, before any src module.
 */
process.env.NODE_ENV = "production";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

export {};
