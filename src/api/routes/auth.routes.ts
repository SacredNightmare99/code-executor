import express from "express";
import { ApiError } from "../../utils/apiError.ts";
import {
  createUser,
  getUserByUsername,
  getUserByEmail,
  getUserById,
  validatePassword,
  updateUser,
  deleteUser,
  hashPassword,
  type UserUpdate,
} from "../../core/auth/userStore.ts";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
} from "../../core/auth/jwtUtils.ts";
import {
  generateApiKey,
  listApiKeys,
  revokeApiKey,
} from "../../core/auth/apiKeyStore.ts";
import { 
  storeRefreshToken, 
  revokeRefreshToken, 
  revokeAllUserRefreshTokens,
  validateRefreshToken,
  getDeviceInfo, 
} from "../../core/auth/refreshTokenStore.ts";
import { authenticateJWT } from "../../middleware/authMiddleware.ts";
import { rateLimitByIp } from "../../middleware/rateLimiter.ts";
import config from "../../config/index.ts";

const router = express.Router();

/**
 * Register New User
 * POST /auth/register
 */
router.post("/register", rateLimitByIp(config.authRegisterLimit, 60), async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    
    // Validation
    if (!username || !email || !password) {
      throw new ApiError(400, "Username, email, and password are required");
    }
    
    if (username.length < 3) {
      throw new ApiError(400, "Username must be at least 3 characters");
    }
    
    if (password.length < 8) {
      throw new ApiError(400, "Password must be at least 8 characters");
    }
    
    if (!email.includes("@")) {
      throw new ApiError(400, "Invalid email format");
    }
    
    // Create user
    const user = await createUser({ username, email, password, tier: "free" });
    
    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    
    // Store refresh token in database
    const deviceInfo = getDeviceInfo(req);
    await storeRefreshToken(refreshToken, user.id, deviceInfo);
    
    return res.status(201).json({
      success: true,
      data: {
        user,
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    if (err.message.includes("already exists")) {
      return next(new ApiError(409, err.message));
    }
    next(err);
  }
});

/**
 * Login User
 * POST /auth/login
 */
router.post("/login", rateLimitByIp(config.authLoginLimit, 60), async (req, res, next) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      throw new ApiError(400, "Username and password are required");
    }
    
    // Get user (try username first, then email)
    let user = await getUserByUsername(username);
    if (!user) {
      user = await getUserByEmail(username);
    }
    
    if (!user) {
      throw new ApiError(401, "Invalid credentials");
    }
    
    // Validate password
    const isValid = await validatePassword(user, password);
    if (!isValid) {
      throw new ApiError(401, "Invalid credentials");
    }
    
    // Remove password hash from response
    const { passwordHash: _passwordHash, ...safeUser } = user;
    
    // Generate tokens
    const accessToken = generateAccessToken(safeUser);
    const refreshToken = generateRefreshToken(safeUser);
    
    // Store refresh token in database
    const deviceInfo = getDeviceInfo(req);
    await storeRefreshToken(refreshToken, safeUser.id, deviceInfo);
    
    return res.json({
      success: true,
      data: {
        user: safeUser,
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Refresh Access Token
 * POST /auth/refresh
 */
router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      throw new ApiError(400, "Refresh token is required");
    }
    
    // Verify refresh token
    let decoded;
    try {
      decoded = verifyToken(refreshToken);
    } catch (err) {
      if (err.message === "Token expired") {
        throw new ApiError(401, "Refresh token expired");
      }
      throw new ApiError(401, "Invalid refresh token");
    }
    
    // Check token type
    if (decoded.type !== "refresh") {
      throw new ApiError(401, "Invalid token type");
    }
    
    // Check if refresh token exists in database (not revoked)
    const tokenData = await validateRefreshToken(refreshToken);
    if (!tokenData) {
      throw new ApiError(401, "Refresh token has been revoked or is invalid");
    }
    
    // Get user
    const user = await getUserById(decoded.sub);
    if (!user) {
      throw new ApiError(401, "User not found");
    }
    
    const { passwordHash: _passwordHash, ...safeUser } = user;
    
    // Generate new access token
    const accessToken = generateAccessToken(safeUser);
    
    return res.json({
      success: true,
      data: {
        accessToken,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Logout User (Current Device)
 * POST /auth/logout
 * Revokes only the current refresh token (single device logout)
 */
router.post("/logout", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      throw new ApiError(400, "Refresh token is required");
    }
    
    // Revoke this specific refresh token
    await revokeRefreshToken(refreshToken);
    
    return res.json({
      success: true,
      data: {
        message: "Logged out successfully",
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Logout All Devices
 * POST /auth/logout-all
 * Revokes ALL refresh tokens for the authenticated user (all sessions)
 */
router.post("/logout-all", authenticateJWT, async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Revoke all refresh tokens for this user
    await revokeAllUserRefreshTokens(userId);
    
    return res.json({
      success: true,
      data: {
        message: "Logged out from all devices successfully",
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get Current User Info
 * GET /auth/me
 * Requires: Authentication
 */
router.get("/me", authenticateJWT, async (req, res, next) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) {
      throw new ApiError(404, "User not found", "USER_NOT_FOUND");
    }

    const { passwordHash: _passwordHash, ...safeUser } = user;

    return res.json({
      success: true,
      data: safeUser,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Update Profile (Email and/or Username)
 * PATCH /auth/me
 * Requires: Authentication
 */
router.patch("/me", authenticateJWT, async (req, res, next) => {
  try {
    const { email, username } = req.body;
    
    if (!email && !username) {
      throw new ApiError(400, "Provide email or username to update");
    }
    
    const updates: UserUpdate = {};
    
    if (email) {
      if (!email.includes("@")) {
        throw new ApiError(400, "Invalid email format");
      }
      updates.email = email;
    }
    
    if (username) {
      if (username.length < 3) {
        throw new ApiError(400, "Username must be at least 3 characters");
      }
      updates.username = username;
    }
    
    const updated = await updateUser(req.user.id, updates);
    
    return res.json({
      success: true,
      data: {
        user: updated,
        message: "Profile updated successfully",
      },
    });
  } catch (err) {
    if (err.message.includes("already exists")) {
      return next(new ApiError(409, err.message));
    }
    next(err);
  }
});

/**
 * Change Password
 * POST /auth/change-password
 * Requires: Authentication
 */
router.post("/change-password", authenticateJWT, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      throw new ApiError(400, "Current and new passwords are required");
    }
    
    if (newPassword.length < 8) {
      throw new ApiError(400, "New password must be at least 8 characters");
    }
    
    const user = await getUserById(req.user.id);
    if (!user) {
      throw new ApiError(404, "User not found");
    }
    
    // Validate current password
    const isValid = await validatePassword(user, currentPassword);
    if (!isValid) {
      throw new ApiError(401, "Invalid current password");
    }
    
    const passwordHash = await hashPassword(newPassword);
    await updateUser(req.user.id, { passwordHash });
    
    // Invalidate all active sessions for security
    await revokeAllUserRefreshTokens(req.user.id);
    
    return res.json({
      success: true,
      data: {
        message: "Password updated successfully. All sessions revoked, please login again.",
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Delete Own Account
 * DELETE /auth/me
 * Requires: Authentication
 */
router.delete("/me", authenticateJWT, async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const user = await getUserById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }
    
    await deleteUser(userId);
    
    return res.json({
      success: true,
      data: {
        deleted: true,
        message: "Account deleted successfully",
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Generate API Key
 * POST /auth/api-keys
 * Requires: Authentication (JWT)
 */
router.post("/api-keys", authenticateJWT, async (req, res, next) => {
  try {
    const { name } = req.body;
    const userId = req.user.id;

    if (!name || name.trim().length === 0) {
      throw new ApiError(400, "API key name is required");
    }

    if (name.length > 100) {
      throw new ApiError(400, "API key name must be 100 characters or less");
    }

    const apiKeyData = await generateApiKey(userId, name.trim());

    return res.status(201).json({
      success: true,
      data: {
        key: apiKeyData.key, // Only time the raw key is shown
        keyId: apiKeyData.keyId,
        name: apiKeyData.name,
        createdAt: apiKeyData.createdAt,
        warning: "Save this key securely. You won't be able to see it again.",
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * List API Keys
 * GET /auth/api-keys
 * Requires: Authentication (JWT)
 */
router.get("/api-keys", authenticateJWT, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const keys = await listApiKeys(userId);

    return res.json({
      success: true,
      data: {
        keys,
        count: keys.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Revoke API Key
 * DELETE /auth/api-keys/:keyId
 * Requires: Authentication (JWT)
 */
router.delete("/api-keys/:keyId", authenticateJWT, async (req, res, next) => {
  try {
    const { keyId } = req.params;
    const userId = req.user.id;

    if (!keyId) {
      throw new ApiError(400, "Key ID is required");
    }

    const revoked = await revokeApiKey(userId, keyId);

    if (!revoked) {
      throw new ApiError(404, "API key not found");
    }

    return res.json({
      success: true,
      data: {
        message: "API key revoked successfully",
        keyId,
      },
    });
  } catch (err) {
    if (err.message.includes("Unauthorized")) {
      return next(new ApiError(403, "Cannot revoke API key that doesn't belong to you"));
    }
    next(err);
  }
});

export default router;
