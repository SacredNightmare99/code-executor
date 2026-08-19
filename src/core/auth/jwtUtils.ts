import jwt from "jsonwebtoken";
import config from "../../config/index.ts";
import type { SafeUser } from "./userStore.ts";

export interface AccessTokenPayload {
  sub: string;
  username: string;
  email: string;
  tier: string;
  rateLimit: number;
  role: "admin" | "user";
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  type: "refresh";
}

export type TokenPayload = AccessTokenPayload | RefreshTokenPayload;

/**
 * Generate access token (short-lived)
 */
export function generateAccessToken(user: SafeUser): string {
  const payload = {
    sub: user.id,
    username: user.username,
    email: user.email,
    tier: user.tier,
    rateLimit: user.rateLimit,
    role: user.role || "user",
    type: "access",
  };

  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/**
 * Generate refresh token (long-lived)
 */
export function generateRefreshToken(user: SafeUser): string {
  const payload = {
    sub: user.id,
    type: "refresh",
  };

  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.refreshTokenExpiresIn,
  });
}

/**
 * Verify and decode token
 */
export function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, config.jwtSecret) as unknown as TokenPayload;
  } catch (err) {
    if (err instanceof Error && err.name === "TokenExpiredError") {
      throw new Error("Token expired");
    }
    if (err instanceof Error && err.name === "JsonWebTokenError") {
      throw new Error("Invalid token");
    }
    throw err;
  }
}
