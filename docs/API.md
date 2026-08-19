# Code Executor API Documentation

## Overview

The Code Executor provides a secure, isolated environment for executing user-submitted code in multiple languages with full stdin/stdout/stderr capture.

## Base URL

```
http://localhost:4000
```

## Authentication

The API supports two authentication methods:

### 1. JWT Tokens (Recommended for user sessions)
- Short-lived access tokens (15 minutes)
- Long-lived refresh tokens (7 days)
- Use for web applications and user-facing interfaces

### 2. API Keys (Recommended for programmatic access)
- Long-lived credentials for machine-to-machine communication
- Use for backend services, scripts, and automation
- Format: `sk_live_<64_character_hex>`

### Getting Started with JWT

1. **Register**: Create a new user account at `POST /auth/register`
2. **Login**: Get access and refresh tokens at `POST /auth/login`
3. **Use Token**: Include the access token in the `Authorization` header:
   ```
   Authorization: Bearer <your-access-token>
   ```
4. **Refresh Token**: When access token expires (15 minutes), use refresh token at `POST /auth/refresh`
5. **Logout**: Revoke current device's refresh token at `POST /auth/logout` (pass refresh token in body)
6. **Logout All**: Revoke ALL devices at `POST /auth/logout-all` (requires access token, revokes all refresh tokens)

### Getting Started with API Keys

1. **Login**: Authenticate with JWT to get access token
2. **Generate Key**: Create an API key at `POST /auth/api-keys`
3. **Use Key**: Include the API key in the `X-API-Key` header:
   ```
   X-API-Key: sk_live_abc123...
   ```
4. **Manage Keys**: List and revoke keys via `/auth/api-keys` endpoints

**Important:** API keys are shown only once when created. Store them securely.

### Rate Limiting

Rate limits are enforced per user based on tier:
- **free**: 10 requests/minute
- **starter**: 50 requests/minute
- **professional**: 100 requests/minute
- **enterprise**: 500 requests/minute

Rate limit headers are included in all authenticated responses:
- `X-RateLimit-Limit`: Maximum requests per minute
- `X-RateLimit-Remaining`: Remaining requests in current minute
- `X-RateLimit-Reset`: Timestamp when the limit resets

---

## Authentication Endpoints

### 1. Register User

**Endpoint:** `POST /auth/register`

**Description:** Create a new user account.

**Request Body:**
```json
{
  "username": "johndoe",
  "email": "john@example.com",
  "password": "secure_password123"
}
```

**Validation:**
- `username`: 3+ characters, unique
- `email`: Valid email format, unique
- `password`: 8+ characters

**Response (201):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "username": "johndoe",
      "email": "john@example.com",
      "tier": "free",
      "rateLimit": 10,
      "created_at": 1738339200000
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Error Responses:**
- `400` - Validation failed (missing/invalid fields)
- `409` - Username or email already exists

**cURL Example:**
```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "johndoe",
    "email": "john@example.com",
    "password": "SecurePass123"
  }'
```

---

### 2. Login

**Endpoint:** `POST /auth/login`

**Description:** Authenticate with username/email and password.

**Request Body:**
```json
{
  "username": "johndoe",
  "password": "secure_password123"
}
```

Or with email:
```json
{
  "email": "john@example.com",
  "password": "secure_password123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "username": "johndoe",
      "email": "john@example.com",
      "tier": "free",
      "rateLimit": 10
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Error Responses:**
- `400` - Missing username/email or password
- `401` - Invalid credentials

**cURL Example (with username):**
```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "johndoe",
    "password": "SecurePass123"
  }'
```

**cURL Example (with email):**
```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "SecurePass123"
  }'
```

---

### 3. Refresh Token

**Endpoint:** `POST /auth/refresh`

**Description:** Get a new access token using a refresh token.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Error Responses:**
- `400` - Missing refresh token
- `401` - Invalid or expired refresh token
- `401` - Token has been revoked (user logged out)

**cURL Example:**
```bash
curl -X POST http://localhost:4000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

---

### 4. Logout

**Endpoint:** `POST /auth/logout`

**Description:** Logout from the current device by revoking the refresh token. Access tokens remain valid until expiration (15 min).

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully"
  }
}
```

**Error Responses:**
- `400` - Missing refresh token

**Notes:**
- Only revokes the specific refresh token (single device logout)
- Access tokens continue to work until they expire (15 minutes max)
- The refresh token is stored hashed in Redis and tied to user/device
- To logout from all devices, use `POST /auth/logout-all`

**cURL Example:**
```bash
curl -X POST http://localhost:4000/auth/logout \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

---

### 5. Logout All Devices

**Endpoint:** `POST /auth/logout-all`

**Description:** Logout from ALL devices by revoking all refresh tokens for the user. Requires authentication.

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:** (None required)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Logged out from all devices successfully"
  }
}
```

**Error Responses:**
- `401` - Not authenticated or invalid token

**Notes:**
- Revokes ALL refresh tokens for the user (all active sessions)
- Current access token continues to work until expiration (15 minutes max)
- Useful for security scenarios (e.g., password change, suspected compromise)
- User must log in again on all devices after this operation

**cURL Example:**
```bash
curl -X POST http://localhost:4000/auth/logout-all \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 6. Get Current User

**Endpoint:** `GET /auth/me`

**Description:** Get the authenticated user's profile.

**Request Headers:**
```
Authorization: Bearer <access-token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "username": "johndoe",
    "email": "john@example.com",
    "tier": "free",
    "rateLimit": 10,
    "created_at": 1738339200000
  }
}
```

**Error Responses:**
- `401` - Missing or invalid token
- `404` - User not found

**cURL Example:**
```bash
curl -X GET http://localhost:4000/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 7. Update Profile

**Endpoint:** `PATCH /auth/me`

**Description:** Update the authenticated user's email or username. Both fields are optional, but at least one must be provided.

**Request Headers:**
```
Authorization: Bearer <access-token>
```

**Request Body:**
```json
{
  "email": "new_email@example.com",
  "username": "new_username"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": { ... },
    "message": "Profile updated successfully"
  }
}
```

**Error Responses:**
- `400` - Missing fields, invalid email format, or username too short
- `401` - Not authenticated
- `409` - Email or username already exists

---

### 8. Change Password

**Endpoint:** `POST /auth/change-password`

**Description:** Update the authenticated user's password. For security, this will invalidate all active sessions (revokes all refresh tokens). You must login again after this operation.

**Request Headers:**
```
Authorization: Bearer <access-token>
```

**Request Body:**
```json
{
  "currentPassword": "old_password123",
  "newPassword": "new_secure_password123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Password updated successfully. All sessions revoked, please login again."
  }
}
```

**Error Responses:**
- `400` - Missing passwords or new password too short
- `401` - Not authenticated or invalid current password

---

### 9. Delete Own Account

**Endpoint:** `DELETE /auth/me`

**Description:** Permanently delete the authenticated user's account and all associated data (API keys, webhooks, etc.).

**Request Headers:**
```
Authorization: Bearer <access-token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "message": "Account deleted successfully"
  }
}
```

**Error Responses:**
- `401` - Not authenticated

---

### 11. Generate API Key

**Endpoint:** `POST /auth/api-keys`

**Description:** Generate a new API key for programmatic access. Requires JWT authentication.

**Request Headers:**
```
Authorization: Bearer <access-token>
```

**Request Body:**
```json
{
  "name": "Production Server"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "key": "sk_live_a1b2c3d4e5f6...",
    "keyId": "apikey_1738339200000_abc123",
    "name": "Production Server",
    "createdAt": 1738339200000,
    "warning": "Save this key securely. You won't be able to see it again."
  }
}
```

**Error Responses:**
- `400` - Missing or invalid name
- `401` - Not authenticated

**cURL Example:**
```bash
curl -X POST http://localhost:4000/auth/api-keys \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My API Key"
  }'
```

**⚠️ Important:** The raw API key is only shown once. Store it securely.

---

### 12. List API Keys

**Endpoint:** `GET /auth/api-keys`

**Description:** List all API keys for the authenticated user (raw keys are never returned).

**Request Headers:**
```
Authorization: Bearer <access-token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "keys": [
      {
        "keyId": "apikey_1738339200000_abc123",
        "name": "Production Server",
        "createdAt": 1738339200000,
        "lastUsedAt": 1738339500000
      },
      {
        "keyId": "apikey_1738340000000_def456",
        "name": "Development",
        "createdAt": 1738340000000,
        "lastUsedAt": null
      }
    ],
    "count": 2
  }
}
```

**Error Responses:**
- `401` - Not authenticated

**cURL Example:**
```bash
curl -X GET http://localhost:4000/auth/api-keys \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

### 13. Revoke API Key

**Endpoint:** `DELETE /auth/api-keys/:keyId`

**Description:** Revoke (delete) an API key. The key will no longer work for authentication.

**Request Headers:**
```
Authorization: Bearer <access-token>
```

**URL Parameters:**
- `keyId`: The API key ID to revoke

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "API key revoked successfully",
    "keyId": "apikey_1738339200000_abc123"
  }
}
```

**Error Responses:**
- `401` - Not authenticated
- `403` - Key doesn't belong to you
- `404` - Key not found

**cURL Example:**
```bash
curl -X DELETE http://localhost:4000/auth/api-keys/apikey_1738339200000_abc123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Admin Endpoints

⚠️ **All admin endpoints require:**
- Valid JWT authentication
- Admin role (`role: "admin"`)

Request headers:
```
Authorization: Bearer <admin-access-token>
Content-Type: application/json
```

### 5. Upgrade User Tier

**Endpoint:** `POST /admin/users/:userId/upgrade`

**Description:** Change a user's tier (admin only).

**URL Parameters:**
- `userId`: User ID to upgrade

**Request Body:**
```json
{
  "newTier": "professional"
}
```

**Valid Tiers:**
- `free` - 10 requests/minute
- `starter` - 50 requests/minute
- `professional` - 100 requests/minute
- `enterprise` - 500 requests/minute

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_id",
      "username": "johndoe",
      "email": "john@example.com",
      "tier": "professional",
      "rateLimit": 100,
      "role": "user"
    },
    "message": "Upgraded johndoe from free to professional"
  }
}
```

**Error Responses:**
- `400` - Invalid tier
- `401` - Not authenticated
- `403` - Not admin
- `404` - User not found

**cURL Example:**
```bash
curl -X POST http://localhost:4000/admin/users/user_12345/upgrade \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "newTier": "professional"
  }'
```

---

### 6. Get User Details

**Endpoint:** `GET /admin/users/:userId`

**Description:** Get detailed information about a user (admin only).

**URL Parameters:**
- `userId`: User ID to retrieve

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_id",
      "username": "johndoe",
      "email": "john@example.com",
      "tier": "professional",
      "role": "user",
      "rateLimit": 100,
      "createdAt": 1738339200000
    }
  }
}
```

**Error Responses:**
- `401` - Not authenticated
- `403` - Not admin
- `404` - User not found

**cURL Example:**
```bash
curl -X GET http://localhost:4000/admin/users/user_12345 \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

### 7. Delete User

**Endpoint:** `DELETE /admin/users/:userId`

**Description:** Delete a user account and related API keys/webhooks (admin only).

**URL Parameters:**
- `userId`: User ID to delete

**Response (200):**
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "userId": "user_id"
  }
}
```

**Error Responses:**
- `400` - Cannot delete your own account
- `401` - Not authenticated
- `403` - Not admin
- `404` - User not found

**cURL Example:**
```bash
curl -X DELETE http://localhost:4000/admin/users/user_12345 \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

### 8. List All Users

**Endpoint:** `GET /admin/users`

**Description:** List all registered users with pagination (admin only).

**Request Headers:**
```
Authorization: Bearer <admin-access-token>
```

**Query Parameters:**
- `limit` - Results per page (default: 50, max: 100)
- `offset` - Number of results to skip (default: 0)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "user_1738339200000_abc123",
        "username": "johndoe",
        "email": "john@example.com",
        "tier": "professional",
        "rateLimit": 100,
        "role": "user",
        "createdAt": 1738339200000
      },
      {
        "id": "user_1738340000000_def456",
        "username": "alice",
        "email": "alice@example.com",
        "tier": "free",
        "rateLimit": 10,
        "role": "user",
        "createdAt": 1738340000000
      }
    ],
    "total": 42,
    "limit": 50,
    "offset": 0
  }
}
```

**Error Responses:**
- `401` - Not authenticated
- `403` - Not admin

**cURL Examples:**
```bash
# Get first 50 users
curl -X GET "http://localhost:4000/admin/users" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Get next 50 users
curl -X GET "http://localhost:4000/admin/users?limit=50&offset=50" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Get specific page size
curl -X GET "http://localhost:4000/admin/users?limit=20&offset=0" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

### 9. Grant Admin Role

**Endpoint:** `POST /admin/users/:userId/make-admin`

**Description:** Grant admin privileges to a user (admin only).

**URL Parameters:**
- `userId`: User ID to promote

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_id",
      "username": "johndoe",
      "email": "john@example.com",
      "tier": "enterprise",
      "role": "admin"
    },
    "message": "Made johndoe an admin"
  }
}
```

**Error Responses:**
- `400` - User already admin / Cannot change own role
- `401` - Not authenticated
- `403` - Not admin
- `404` - User not found

**cURL Example:**
```bash
curl -X POST http://localhost:4000/admin/users/user_12345/make-admin \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

### 10. Revoke Admin Role

**Endpoint:** `POST /admin/users/:userId/revoke-admin`

**Description:** Remove admin privileges from a user (admin only).

**URL Parameters:**
- `userId`: User ID to demote

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_id",
      "username": "johndoe",
      "email": "john@example.com",
      "tier": "professional",
      "role": "user"
    },
    "message": "Revoked admin role from johndoe"
  }
}
```

**Error Responses:**
- `400` - User not admin / Cannot revoke own role
- `401` - Not authenticated
- `403` - Not admin
- `404` - User not found

**cURL Example:**
```bash
curl -X POST http://localhost:4000/admin/users/user_12345/revoke-admin \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

## Code Execution Endpoints

### 5. Health Check

**Endpoint:** `GET /health`

**Description:** Check if the service is healthy and Redis is accessible. No authentication required.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-31T14:00:00.000Z",
  "uptime": 123.456
}
```

**Status Codes:**
- `200` - Service is healthy
- `503` - Service unavailable (Redis down)

**cURL Example:**
```bash
curl -X GET http://localhost:4000/health
```

---

### 6. Submit Code for Execution

**Endpoint:** `POST /submit`

**Description:** Submit code for execution in an isolated Docker container. Requires authentication.

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer <access-token>
```

Or with API key:
```
Content-Type: application/json
X-API-Key: sk_live_abc123...
```

**Request Body:**
```json
{
  "language": "python",
  "code": "print('Hello, World!')",
  "inputs": ["input 1", "input 2"]
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `language` | string | Yes | Programming language (`python`, `c`, `cpp`, `java`) |
| `code` | string | Yes | Source code to execute (max 100KB) |
| `inputs` | array | No | Array of stdin values for repeated runs (max 50). If omitted, defaults to a single empty input. |
| `callback_url` | string | No | Optional URL to deliver an asynchronous `job.completed` webhook upon completion |

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "job_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "QUEUED"
  }
}
```

**Example Requests:**

**cURL Examples:**

**Simple Python (no authentication shown, but required):**
```bash
curl -X POST http://localhost:4000/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "language": "python",
    "code": "print(\"Hello, World!\")",
    "inputs": [""]
  }'
```

**Python with stdin:**
```bash
curl -X POST http://localhost:4000/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "language": "python",
    "code": "name = input(\"Enter your name: \")\nprint(f\"Hello, {name}!\")",
    "inputs": ["Alice"]
  }'
```

**C with stdin:**
```bash
curl -X POST http://localhost:4000/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "language": "c",
    "code": "#include <stdio.h>\nint main() {\n  int x;\n  scanf(\"%d\", &x);\n  printf(\"%d squared = %d\\\\n\", x, x*x);\n  return 0;\n}",
    "inputs": ["7"]
  }'
```

**Error Responses:**

- `400 Bad Request` - Missing required fields
  ```json
  {
    "success": false,
    "error": "Missing language or code",
    "code": "VALIDATION_ERROR"
  }
  ```

- `413 Payload Too Large` - Code exceeds 100KB
  ```json
  {
    "success": false,
    "error": "Code too large",
    "code": "VALIDATION_ERROR"
  }
  ```

---

### 7. Get Job Result

**Endpoint:** `GET /result/:id`

**Description:** Poll for the result of a submitted job. Users can only access their own jobs. Requires authentication.

**Request Headers:**
```
Authorization: Bearer <access-token>
```

Or with API key:
```
X-API-Key: sk_live_abc123...
```

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Job ID returned from /submit endpoint |

**Response:**

**Note:** When a job completes, output is always returned as a `results` array. For single-input jobs, `results` will contain exactly one item.

**While executing (QUEUED or RUNNING):**
```json
{
  "success": true,
  "data": {
    "job_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "RUNNING"
  }
}
```

**After completion (ACCEPTED):**
```json
{
  "success": true,
  "data": {
    "job_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "ACCEPTED",
    "metrics": {
      "queue_wait_ms": 12,
      "compile_time_ms": 0,
      "exec_time_ms": 34,
      "total_time_ms": 58
    },
    "results": [
      {
        "stdin": "",
        "status": "ACCEPTED",
        "stdout": "Hello, World!\n",
        "stderr": "",
        "exit_code": 0
      }
    ]
  }
}
```

**After completion (multiple inputs):**
```json
{
  "success": true,
  "data": {
    "job_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "ACCEPTED",
    "metrics": {
      "queue_wait_ms": 12,
      "compile_time_ms": 0,
      "exec_time_ms": 120,
      "total_time_ms": 160
    },
    "results": [
      {
        "stdin": "input 1",
        "status": "ACCEPTED",
        "stdout": "Output 1\n",
        "stderr": "",
        "exit_code": 0
      },
      {
        "stdin": "input 2",
        "status": "ACCEPTED",
        "stdout": "Output 2\n",
        "stderr": "",
        "exit_code": 0
      }
    ]
  }
}
```

**On error (RUNTIME_ERROR):**
```json
{
  "success": true,
  "data": {
    "job_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "RUNTIME_ERROR",
    "metrics": {
      "queue_wait_ms": 10,
      "compile_time_ms": 0,
      "exec_time_ms": 21,
      "total_time_ms": 40
    },
    "results": [
      {
        "stdin": "",
        "status": "RUNTIME_ERROR",
        "stdout": "",
        "stderr": "Traceback (most recent call last):\n  File \"main.py\", line 1, in <module>\n    1/0\nZeroDivisionError: division by zero\n",
        "exit_code": 1
      }
    ]
  }
}
```

**Metrics Fields:**
- `queue_wait_ms` - Time spent in queue before execution
- `compile_time_ms` - Time spent compiling (0 for interpreted languages)
- `exec_time_ms` - Execution time inside the container
- `total_time_ms` - End-to-end time from submit to finish

**Job Status Values:**

| Status | Meaning |
|--------|---------|
| `QUEUED` | Waiting to be executed |
| `RUNNING` | Currently executing |
| `ACCEPTED` | Completed successfully (exit code 0) |
| `RUNTIME_ERROR` | Runtime error or non-zero exit |
| `COMPILE_ERROR` | Compilation failed (C only) |
| `TIME_LIMIT_EXCEEDED` | Execution exceeded timeout (2s default) |
| `SYSTEM_ERROR` | System/infrastructure error |

**Error Response (404 Not Found):**
```json
{
  "success": false,
  "error": "Job not found",
  "code": "JOB_NOT_FOUND"
}
```

**cURL Example:**
```bash
curl -X GET http://localhost:4000/result/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Polling for Result (with loop):**
```bash
#!/bin/bash

JOB_ID="550e8400-e29b-41d4-a716-446655440000"
TOKEN="YOUR_ACCESS_TOKEN"

# Poll for 30 seconds
for i in {1..30}; do
  RESULT=$(curl -s -X GET http://localhost:4000/result/$JOB_ID \
    -H "Authorization: Bearer $TOKEN")
  
  STATUS=$(echo $RESULT | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  
  if [[ $STATUS == "ACCEPTED" ]] || [[ $STATUS == "RUNTIME_ERROR" ]]; then
    echo $RESULT | jq .
    break
  fi
  
  echo "Still running... (attempt $i/30)"
  sleep 1
done
```

---

### 4. Prometheus Metrics

**Endpoint:** `GET /metrics`

**Description:** Get application metrics in Prometheus/OpenMetrics format.

**Response:** Text format (Prometheus compatible)
```
# HELP jobs_submitted_total Total jobs submitted
# TYPE jobs_submitted_total counter
jobs_submitted_total{language="python"} 42
jobs_submitted_total{language="c"} 18
...
```

**cURL Example:**
```bash
curl -X GET http://localhost:4000/metrics
```

**cURL Example (with formatting):**
```bash
curl -s http://localhost:4000/metrics | grep -E "^(# |[a-z])"
```

**Usage:**
```bash
curl http://localhost:4000/metrics
```

---

### 5. Status & Metrics Summary

**Endpoint:** `GET /status`

**Description:** Get real-time metrics summary as JSON.

**Response:**
```json
{
  "timestamp": "2026-01-31T14:00:00.000Z",
  "redis": {
    "connected": true
  },
  "submissions": {
    "total": 150,
    "by_language": {
      "python": 100,
      "c": 50
    }
  },
  "queue": {
    "depth": 5,
    "processing": 2
  },
  "performance": {
    "p50": 245,
    "p95": 1200,
    "p99": 1850,
    "avg": 450,
    "min": 50,
    "max": 2000
  },
  "success_rate": 0.98,
  "throughput": 12.5
}
```

---

## Supported Languages

### Python 3.12
- Supports all standard library features
- Security: Runs in Docker with limited resources (128MB memory, 0.5 CPU)
- Timeout: 2 seconds (configurable via `EXEC_TIMEOUT_MS`)

### C (GCC 13)
- Requires explicit compilation step
- Standard: C11/C17 (`gcc -O2`)
- Security: Runs in Docker with limited resources (128MB memory, 0.5 CPU)
- Example:
  ```c
  #include <stdio.h>
  int main() {
    printf("Hello, World!\n");
    return 0;
  }
  ```

### C++ (G++ 13)
- Requires explicit compilation step
- Standard: C++17 (`g++ -O2 -std=c++17 -pipe`)
- Security: Runs in Docker with limited resources (128MB memory, 0.5 CPU)
- Example:
  ```cpp
  #include <iostream>
  int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
  }
  ```

### Java 21 (OpenJDK 21)
- Requires compilation and execution inTemurin JDK container
- Timeout: Up to 8 seconds (allows JVM startup)
- Security: Runs in Docker with limited resources (128MB memory, 0.5 CPU)
- Example:
  ```java
  public class Main {
    public static void main(String[] args) {
      System.out.println("Hello, World!");
    }
  }
  ```

---

## Request/Response Examples

### Complete Workflow Example

**1. Submit code:**
```bash
curl -X POST http://localhost:4000/submit \
  -H "Content-Type: application/json" \
  -d '{
    "language": "python",
    "code": "import sys\nfor i in range(3):\n  line = input()\n  print(f\"Line {i+1}: {line}\")",
    "stdin": "first\nsecond\nthird"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "job_id": "abc123",
    "status": "QUEUED"
  }
}
```

**2. Poll for result (may need multiple attempts):**
```bash
curl http://localhost:4000/result/abc123
```

**Response (still running):**
```json
{
  "success": true,
  "data": {
    "job_id": "abc123",
    "status": "RUNNING"
  }
}
```

**Response (completed):**
```json
{
  "success": true,
  "data": {
    "job_id": "abc123",
    "status": "ACCEPTED",
    "results": [
      {
        "stdin": "first\nsecond\nthird",
        "status": "ACCEPTED",
        "stdout": "Line 1: first\nLine 2: second\nLine 3: third\n",
        "stderr": "",
        "exit_code": 0
      }
    ]
  }
}
```

---

## Error Handling

All errors follow this format:

```json
{
  "success": false,
  "error": "Error description",
  "code": "ERROR_CODE"
}
```

**HTTP Status Codes:**
- `200` - Success
- `201` - Created (job submitted)
- `400` - Bad Request (validation error)
- `404` - Not Found (job not found)
- `413` - Payload Too Large (code too large)
- `500` - Internal Server Error
- `503` - Service Unavailable

---

## Rate Limiting

Rate limiting is enforced per-user per minute using atomic Redis buckets.

Limits are applied per-user (based on their JWT or API key) and are tied to their subscription tier:
- **free**: 10 requests/minute
- **starter**: 50 requests/minute
- **professional**: 100 requests/minute
- **enterprise**: 500 requests/minute

Each authenticated request returns rate limit headers:
- `X-RateLimit-Limit`: Your total limit
- `X-RateLimit-Remaining`: Remaining requests this minute
- `X-RateLimit-Reset`: Unix timestamp for the next minute reset

If the limit is exceeded, the server returns a `429 Too Many Requests` status. Note: `GET` webhook endpoints check the rate limit without decrementing the quota.

---

## Security Considerations

1. **Code Isolation**: All code runs in isolated Docker containers with:
   - 128MB execution memory limit (512MB for compilation containers)
   - 0.5 CPU cores limit
   - No network access (`--network=none`)
   - Read-only root filesystem
   - Dropped capabilities (`--cap-drop=ALL`) and non-root user (`runner`)
   - `no-new-privileges` security option
   - gVisor sandbox (`runsc`) when available

2. **Input Validation**:
   - Code limited to 100KB
   - Language restricted to whitelist (`python`, `c`, `cpp`, `java`)
   - Stdin size reasonable

3. **Timeouts**:
   - Default 2 seconds per execution
   - Configurable via `EXEC_TIMEOUT_MS`

4. **Output Limits**:
   - Stdout/stderr truncated to prevent memory exhaustion

---

## Configuration

Environment variables:
- `PORT` - Server port (default: 4000)
- `WORKERS` - Number of parallel workers (default: 2)
- `REDIS_URL` - Redis connection URL
- `EXEC_TIMEOUT_MS` - Execution timeout in ms (default: 2000)
- `DISABLE_GVISOR` - Disable gVisor sandbox (default: false)

---

## Monitoring

See [docs/MONITORING.md](../MONITORING.md) for:
- Prometheus metrics setup
- Grafana dashboard configuration
- Alert rules
- Performance metrics

---

## cURL Cheat Sheet

Quick reference for all endpoints with cURL commands.

### Authentication

**Register:**
```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "myuser",
    "email": "user@example.com",
    "password": "SecurePass123"
  }' | jq .
```

**Login:**
```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "myuser",
    "password": "SecurePass123"
  }' | jq '.data.accessToken' -r
```

**Store token in variable:**
```bash
TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"myuser","password":"SecurePass123"}' \
  | jq '.data.accessToken' -r)

echo "Token: $TOKEN"
```

**Refresh token:**
```bash
curl -X POST http://localhost:4000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }' | jq .
```

**Get current user profile:**
```bash
curl -X GET http://localhost:4000/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Generate API key (requires JWT):**
```bash
curl -X POST http://localhost:4000/auth/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My API Key"
  }' | jq .
```

**List API keys:**
```bash
curl -X GET http://localhost:4000/auth/api-keys \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Revoke API key:**
```bash
curl -X DELETE http://localhost:4000/auth/api-keys/apikey_1738339200000_abc123 \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### Code Execution with API Keys

**Submit code with API key:**
```bash
curl -X POST http://localhost:4000/submit \
  -H "X-API-Key: sk_live_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "language": "python",
    "code": "print(\"Hello, World!\")"
  }' | jq .
```

**Get result with API key:**
```bash
curl -X GET http://localhost:4000/result/job_id \
  -H "X-API-Key: sk_live_abc123..." | jq .
```

### Code Execution

**Health check (no auth needed):**
```bash
curl http://localhost:4000/health | jq .
```

**Simple Python:**
```bash
curl -X POST http://localhost:4000/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "language": "python",
    "code": "print(\"Hello, World!\")"
  }' | jq .
```

**Python with stdin:**
```bash
curl -X POST http://localhost:4000/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "language": "python",
    "code": "name = input(\"Enter name: \")\\nprint(f\"Hello, {name}!\")",
    "stdin": "Alice"
  }' | jq .
```

**C program:**
```bash
curl -X POST http://localhost:4000/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "language": "c",
    "code": "#include <stdio.h>\\nint main() {\\n  printf(\"Hello!\\\\n\");\\n  return 0;\\n}"
  }' | jq .
```

**Get job result:**
```bash
curl -X GET http://localhost:4000/result/YOUR_JOB_ID \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Poll for result (until complete):**
```bash
#!/bin/bash
JOB_ID="$1"
TOKEN="$2"

while true; do
  RESULT=$(curl -s -X GET http://localhost:4000/result/$JOB_ID \
    -H "Authorization: Bearer $TOKEN")
  
  STATUS=$(echo $RESULT | jq '.data.status' -r)
  
  if [[ $STATUS != "QUEUED" && $STATUS != "RUNNING" ]]; then
    echo $RESULT | jq .
    break
  fi
  
  echo "Status: $STATUS (waiting...)"
  sleep 1
done
```

**Metrics (Prometheus):**
```bash
curl http://localhost:4000/metrics | head -20
```

### Admin Operations

**Get admin token:**
```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"AdminPass123!"}' \
  | jq '.data.accessToken' -r)
```

**Upgrade user tier:**
```bash
curl -X POST http://localhost:4000/admin/users/USER_ID/upgrade \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "newTier": "professional"
  }' | jq .
```

**Get user details:**
```bash
curl -X GET http://localhost:4000/admin/users/USER_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```

**Make user admin:**
```bash
curl -X POST http://localhost:4000/admin/users/USER_ID/make-admin \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```

**Revoke admin role:**
```bash
curl -X POST http://localhost:4000/admin/users/USER_ID/revoke-admin \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```

### Complete Workflow Script

```bash
#!/bin/bash

echo "=== Code Executor API Test ==="
echo

# Step 1: Register
echo "1. Registering user..."
REGISTER=$(curl -s -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser_'$(date +%s)'",
    "email": "test_'$(date +%s)'@example.com",
    "password": "TestPass123"
  }')

TOKEN=$(echo $REGISTER | jq '.data.accessToken' -r)
echo "   Token: ${TOKEN:0:20}..."
echo

# Step 2: Submit code
echo "2. Submitting Python code..."
SUBMIT=$(curl -s -X POST http://localhost:4000/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "language": "python",
    "code": "print(\"Hello from Code Executor!\")"
  }')

JOB_ID=$(echo $SUBMIT | jq '.data.id' -r)
echo "   Job ID: $JOB_ID"
echo

# Step 3: Poll for result
echo "3. Waiting for execution..."
for i in {1..10}; do
  RESULT=$(curl -s -X GET http://localhost:4000/result/$JOB_ID \
    -H "Authorization: Bearer $TOKEN")
  
  STATUS=$(echo $RESULT | jq '.data.status' -r)
  
  if [[ $STATUS == "ACCEPTED" ]]; then
    echo "   Status: $STATUS ✓"
    echo "   Output: $(echo $RESULT | jq '.data.stdout' -r)"
    break
  elif [[ $STATUS == "RUNTIME_ERROR" ]]; then
    echo "   Status: $STATUS ✗"
    echo "   Error: $(echo $RESULT | jq '.data.stderr' -r)"
    break
  else
    echo "   Status: $STATUS (attempt $i/10)"
  fi
  
  sleep 1
done
```

### Using with jq for JSON parsing

**Pretty print response:**
```bash
curl -s http://localhost:4000/health | jq .
```

**Extract specific field:**
```bash
curl -s http://localhost:4000/health | jq '.status'
```

**Extract nested field:**
```bash
curl -s http://localhost:4000/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq '.data.username'
```

**Extract array:**
```bash
curl -s http://localhost:4000/metrics | jq -s .
```

### Useful curl options

```bash
# Save response to file
curl ... -o response.json

# Follow redirects
curl -L ...

# Include response headers
curl -i ...

# Verbose (show request/response details)
curl -v ...

# Add custom header
curl -H "Custom-Header: value" ...

# Add authentication
curl -H "Authorization: Bearer TOKEN" ...

# Data from file
curl -d @data.json ...

# Timeout (seconds)
curl --max-time 5 ...

# Show only response headers
curl -I ...
```

## Advanced Features

### Code Retrieval

Retrieve code from previously submitted jobs.

#### Get Code from Job

```
GET /jobs/:id/code
```

**Authentication:** Required (JWT or API Key)

**Parameters:**
- `id` (path): Job ID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "job-uuid",
    "language": "python",
    "code": "print('Hello, World!')",
    "stdin": "",
    "created_at": 1706131200000
  }
}
```

### Job Search and History

Search and filter your job history with multiple filters.

#### List User Jobs

```
GET /jobs
```

**Authentication:** Required (JWT or API Key)

**Query Parameters:**
- `status` (optional): Filter by status
- `language` (optional): Filter by language
- `limit` (optional): Max results (default: 50, max: 100)
- `offset` (optional): Pagination offset (default: 0)

### Language Information

Get information about supported languages.

#### List All Languages

```
GET /languages
```

**Authentication:** Not required (public endpoint)

#### Get Language Info

```
GET /languages/:lang
```

**Authentication:** Not required (public endpoint)

### Webhooks

Register webhooks to receive notifications when jobs complete.

#### Register Webhook

```
POST /webhooks
```

**Authentication:** Required (JWT or API Key)

**Body:**
```json
{
  "url": "https://your-server.com/callback",
  "events": ["job.completed"],
  "secret": "optional-hmac-secret"
}
```

#### List Webhooks

```
GET /webhooks
```

**Authentication:** Required

#### Delete Webhook

```
DELETE /webhooks/:id
```

**Authentication:** Required

---

**Last Updated:** February 1, 2026
