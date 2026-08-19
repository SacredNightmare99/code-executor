import type { NextFunction, Response } from "express";
import { verifyToken } from "../core/auth/jwtUtils.ts";
import { getUserById } from "../core/auth/userStore.ts";
import { validateApiKey } from "../core/auth/apiKeyStore.ts";
import { ApiError } from "../utils/apiError.ts";
import type { AuthenticatedRequest, AuthUser } from "../types/http.ts";

function mapUser(user: Record<string, any>, authMethod: "jwt" | "apikey"): AuthUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    tier: user.tier,
    rateLimit: user.rateLimit,
    role: user.role || "user",
    authMethod,
  };
}

export async function authenticateJWT(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const apiKeyHeader = req.headers["x-api-key"];
    const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;

    if (apiKey) {
      const user = await validateApiKey(apiKey);
      if (!user) throw new ApiError(401, "Invalid API key");
      req.user = mapUser(user, "apikey");
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new ApiError(401, "No authorization credentials provided. Use Authorization: Bearer <token> or X-API-Key: <key>");
    }
    if (!authHeader.startsWith("Bearer ")) throw new ApiError(401, "Invalid authorization format. Use: Bearer <token>");

    const token = authHeader.substring(7);
    if (!token) throw new ApiError(401, "No token provided");

    let decoded: Record<string, any>;
    try {
      decoded = verifyToken(token) as Record<string, any>;
    } catch (err: any) {
      if (err?.message === "Token expired") throw new ApiError(401, "Token expired");
      throw new ApiError(401, "Invalid token");
    }

    if (decoded.type !== "access") throw new ApiError(401, "Invalid token type");

    const user = await getUserById(decoded.sub);
    if (!user) throw new ApiError(401, "User not found");

    req.user = mapUser(user, "jwt");
    next();
  } catch (err) {
    next(err);
  }
}
