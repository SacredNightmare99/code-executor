# Code-Executor

Secure, isolated code execution service with JWT authentication, user-based rate limiting, Docker + gVisor sandbox, and comprehensive monitoring.

## Endpoints

### Authentication

- **POST /auth/register** - Register new user
- **POST /auth/login** - Login and get JWT tokens
- **POST /auth/refresh** - Refresh access token
- **POST /auth/logout** - Logout current device
- **POST /auth/logout-all** - Logout from all devices
- **GET /auth/me** - Get current user profile
- **PATCH /auth/me** - Update email or username
- **POST /auth/change-password** - Change password
- **DELETE /auth/me** - Delete own account
- **POST /auth/api-keys** - Generate API key (JWT required)
- **GET /auth/api-keys** - List API keys
- **DELETE /auth/api-keys/:keyId** - Revoke API key

### Admin (Requires Admin Role)

- **POST /admin/users/:userId/upgrade** - Upgrade user tier
- **GET /admin/users/:userId** - View user details
- **GET /admin/users** - List all users (paginated)
- **POST /admin/users/:userId/make-admin** - Grant admin role
- **POST /admin/users/:userId/revoke-admin** - Revoke admin role

### Core Execution (Requires Authentication)

- **POST /submit** - Submit code for execution (rate limited by tier)
- **GET /result/:id** - Poll job result (only your jobs)

### Advanced Features (Requires Authentication)

- **GET /jobs/:id/code** - Retrieve code from previous submission
- **GET /jobs** - Search job history with filters
- **GET /languages** - List all supported languages (public)
- **GET /languages/:lang** - Get language details (public)

### Webhooks (Requires Authentication)

- **POST /webhooks** - Register webhook callback
- **GET /webhooks** - List your webhooks
- **GET /webhooks/:id** - Get webhook details
- **GET /webhooks/:id/deliveries** - View delivery history
- **DELETE /webhooks/:id** - Delete webhook

### Monitoring & Diagnostics  

- **GET /health** - Health check with Redis connectivity
- **GET /status** - Real-time metrics summary (JSON)
- **GET /metrics** - Prometheus-format metrics

## Quick Start

```bash
# 1. Build Docker images
docker build -f deployment/docker/runner-c.Dockerfile -t runner-c .
docker build -f deployment/docker/runner-py.Dockerfile -t runner-py .
docker build -f deployment/docker/runner-java.Dockerfile -t runner-java .
docker build -f deployment/docker/runner-runtime.Dockerfile -t runner-runtime .

# 2. Start Redis (if not running)
redis-server

# 3. Configure environment
cp .env.example .env
# Edit .env and set JWT_SECRET to a secure random value

# 4. Start services
npm install
npm run dev

# 5. Seed database with test users (optional)
npm run seed

# 6. Test authentication
npm run test:integration:auth

# 7. Run all tests
npm test
```

## Testing

```bash
# Run all tests (pure unit + Redis unit + integration)
npm test

# Run pure unit tests (Node.js built-in test runner, no Redis/Server needed)
npm run test:unit:pure

# Run all unit tests (including Redis-dependent ones)
npm run test:unit

# Run only integration tests (requires Server and Redis)
npm run test:integration

# Run specific test suites
npm run test:unit:webhooks
npm run test:unit:apikey
npm run test:integration:advanced
```

See [docs/TESTING.md](docs/TESTING.md) for complete testing guide.

## Authentication & Usage

### 1. Register a User

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "johndoe",
    "email": "john@example.com",
    "password": "SecurePass123"
  }'
```

Response includes `accessToken` (15min) and `refreshToken` (7 days).

### 2. Submit Code with Authentication

```bash
curl -X POST http://localhost:4000/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "language": "python",
    "code": "print(\"Hello, World!\")"
  }'
```

### 3. Rate Limiting

Rate limits based on user tier:

- **free**: 10 requests/minute
- **starter**: 50 requests/minute
- **professional**: 100 requests/minute
- **enterprise**: 500 requests/minute

Headers returned with each authenticated request:

- `X-RateLimit-Limit`: Your tier's limit
- `X-RateLimit-Remaining`: Remaining requests this minute
- `X-RateLimit-Reset`: Unix timestamp when limit resets

## Test Users & Admin Access

Run the seeding script to populate the database with test users:

```bash
npm run seed
```

This creates:

- **admin** / AdminPass123! - Admin user (enterprise tier)
- **alice** / AlicePass123! - Free tier user
- **bob** / BobPass123! - Starter tier user
- **charlie** / CharliePass123! - Professional tier user
- **diana** / DianaPass123! - Enterprise tier user

### Admin Operations

With admin credentials, you can:

- Upgrade user tiers
- View user details
- Grant/revoke admin privileges
- View admin statistics

Example:

```bash
# Login as admin
ADMIN_TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"AdminPass123!"}' | jq '.data.accessToken' -r)

# Upgrade a user to professional tier
curl -X POST http://localhost:4000/admin/users/USER_ID/upgrade \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newTier":"professional"}'
```

See [docs/API.md](docs/API.md) for complete admin API documentation.

---

## Monitoring Stack

```bash
# Start complete stack: Server, Redis, Prometheus, Grafana
docker-compose -f deployment/docker-compose.monitoring.yml up -d

# Access:
# - Code Executor: http://localhost:4000
# - Prometheus: http://localhost:9090
# - Grafana: http://localhost:3000 (user: admin, pass: admin)
```

See [docs/MONITORING.md](docs/MONITORING.md) for complete guide.

## Project Structure

```bash
src/
├── api/                    # API layer
│   └── routes/            # Express route handlers (auth, jobs, health)
├── core/                  # Business logic
│   ├── auth/             # User management, JWT utils
│   ├── jobs/             # Job management
│   ├── limits/           # Execution limiting
│   ├── runner/           # Code execution
│   └── workers/          # Worker processes
├── infrastructure/        # Infrastructure concerns
│   ├── logs/            # Logging
│   ├── metrics/         # Metrics collection
│   └── redis/           # Redis client
├── middleware/           # Express middleware (auth, rate limiting, errors)
└── utils/               # Utility functions

config/                   # Configuration files
deployment/              # Docker & orchestration
docs/                    # Documentation
tests/                   # Test suites
```

## Documentation

- **[docs/API.md](docs/API.md)** - Complete API documentation with examples (incl. webhooks, code retrieval, job search)
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** - Production deployment, pm2, CI/CD
- **[docs/MONITORING.md](docs/MONITORING.md)** - Metrics, dashboards, alerting
- **[docs/DOCKER.md](docs/DOCKER.md)** - Docker images and security
- **[docs/TESTING.md](docs/TESTING.md)** - Testing guide and procedures
- **[docs/ADMIN.md](docs/ADMIN.md)** - Admin features and user management

## Features

✅ **Authentication & Authorization**

- JWT-based authentication (access + refresh tokens)
- API key support for programmatic access
- User registration and login
- Bcrypt password hashing
- Role-based access control (user/admin)
- User-based rate limiting by tier

✅ **Security**

- Docker isolation with gVisor sandbox
- Resource limits (128MB memory, 0.5 CPU, 32 processes per container)
- Seccomp filtering / dropped capabilities
- User isolation (users can only access their own jobs)
- HMAC-signed webhook deliveries

✅ **Code Execution**

- Python 3.12, C (GCC 13), and Java 21 support
- stdin/stdout/stderr capture
- Timeout protection (2s default, 8s for Java)
- Queue-based job distribution with crash recovery
- Execution metrics (compile time, run time, queue wait)

✅ **Advanced Features**

- Code retrieval from past submissions
- Job search and filtering
- Language metadata API
- Webhook callbacks on job completion
- Automatic webhook retry with exponential backoff

✅ **Monitoring & Observability**

- Comprehensive metrics collection
- Prometheus integration
- Grafana dashboards (11 panels)
- Health checks and diagnostics
- Request logging with correlation IDs

✅ **Performance & Reliability**

- Redis-backed persistence
- Graceful shutdown
- Rate limiting with fixed-window Redis counters
- Reliable job queue (in-flight jobs recovered after crash/restart)
- Comprehensive test suite (unit + integration)
- Load testing with k6

## Production Deployment (OCI / 1GB VM)

The app runs on a single VM under **pm2**. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
for the full guide. Summary:

```bash
# 1. Clone + provision the box (installs Node 22, Redis, Docker, gVisor,
#    swap, builds runner images, configures pm2 + startup). Idempotent.
bash scripts/bootstrap-server.sh

# 2. Manage
pm2 status                  # process status
pm2 logs runnix             # logs
pm2 reload runnix --update-env   # zero-downtime reload
```

- Deploys via GitHub Actions **on tagged releases** (`git tag v0.1.0 && git push origin v0.1.0`) — see `.github/workflows/` and `docs/DEPLOYMENT.md`.
- `ecosystem.config.cjs` pins runtime settings (1 worker, 350MB memory cap, auto-restart).
- Runtime uses `node --experimental-strip-types` (Node ≥ 22.18), no build step.
- Requirements: Node 22 LTS, Redis, Docker (+ gVisor `runsc` runtime), pm2.
