# Testing Guide

## Overview

Runnix includes comprehensive test suites powered by the Node.js native test runner (`node:test`). Tests are organized into unit, Redis, API, and Docker sandbox integration suites.

## Test Structure

```
tests/
├── unit/              # Pure unit tests (no external services needed)
│   ├── config.test.ts
│   ├── jwt.test.ts
│   ├── languageRegistry.test.ts
│   ├── metricsCollector.test.ts
│   ├── rateLimiter.test.ts
│   ├── sandbox.test.ts
│   ├── urlSafety.test.ts
│   └── ...
├── redis/             # Tests requiring Redis
│   ├── apiKeyStore.test.ts
│   ├── jobQueue.test.ts
│   ├── tokenStore.test.ts
│   └── webhookStore.test.ts
├── api/               # Supertest API tests against in-memory Express server
│   ├── auth.test.ts
│   ├── jobs.test.ts
│   ├── monitoring.test.ts
│   ├── users.test.ts
│   └── webhooks.test.ts
└── docker/            # Real Docker sandbox end-to-end tests
    └── execution.test.ts
```

## Running Tests

### Prerequisites

1. **Start Redis:**
   ```bash
   redis-server
   ```

### 1. Run Complete In-Process Test Suite

Runs all Unit, Redis, and API tests:
```bash
npm test
```

### 2. Run Pure Unit Tests (Fast, No Redis Required)

```bash
npm run test:unit
```

### 3. Run Redis Tests

```bash
npm run test:redis
```

### 4. Run API Route Tests

```bash
npm run test:api
```

### 5. Run Test Suite with Coverage

```bash
npm run test:coverage
```

### 6. Run Real Docker Sandbox Tests (Requires Built Runner Images)

```bash
# Build runner images
docker build -f deployment/docker/runner-c.Dockerfile -t runner-c .
docker build -f deployment/docker/runner-cpp.Dockerfile -t runner-cpp .
docker build -f deployment/docker/runner-py.Dockerfile -t runner-py .
docker build -f deployment/docker/runner-java.Dockerfile -t runner-java .
docker build -f deployment/docker/runner-runtime.Dockerfile -t runner-runtime .

# Run real sandbox integration tests
npm run test:integration
```

## Static Analysis & Quality Checks

### TypeScript Typechecking

```bash
npm run typecheck
```

### ESLint

```bash
npm run lint
```

#### Webhooks Tests
- Webhook CRUD operations
- Delivery tracking
- Failed attempt handling
- Auto-disable after failures
- Invalid URL rejection

#### Language Registry Tests
- Language metadata retrieval
- Alias resolution (py→python, gcc→c)
- Feature flag validation
- Compiler flags for C

#### API Key Tests
- Key generation (sk_live_ format)
- Key validation and hashing
- Revocation
- last_used timestamp updates
- Cross-user protection

### Integration Tests

#### Core Integration Tests
- User registration and login
- JWT token refresh
- Code submission (Python, C)
- Job result retrieval
- Rate limiting
- Error handling

#### Auth Integration Tests
- Complete authentication flow
- JWT access/refresh tokens
- API key generation
- Hybrid authentication (JWT + API keys)
- Token expiration
- Tier-based rate limits

#### Advanced Features Tests
- Language info endpoints
- Code retrieval from jobs
- Job search/filtering
- Webhook registration
- Webhook deliveries
- Webhook deletion

## Load Testing

Load tests use k6 (install separately):

```bash
npm run load:test
```

## Test Coverage

### What's Tested

✅ Authentication (JWT + API keys)
✅ Authorization (role-based access)
✅ Rate limiting (per-tier)
✅ Code execution (Python, C)
✅ Job queue and status
✅ Metrics collection
✅ Webhook delivery
✅ Language metadata
✅ API key management
✅ Error handling

### What's Not Tested

- Docker container isolation (requires Docker)
- gVisor runtime (requires gVisor setup)
- Concurrent load (use k6 for this)
- Redis failure scenarios
- Network timeouts

## Writing New Tests

### Unit Test Template

```javascript
#!/usr/bin/env node

import { redis } from "../../src/infrastructure/redis/redisClient.js";

async function cleanup() {
  // Clean up test data
}

async function runTests() {
  console.log("🧪 My Unit Tests\n");

  let testsPassed = 0;
  let testsFailed = 0;

  try {
    await cleanup();

    // Test 1
    console.log("Test 1: Description");
    // ... test logic
    if (/* success condition */) {
      console.log("✓ Test passed\n");
      testsPassed++;
    } else {
      console.log("✗ Test failed\n");
      testsFailed++;
    }

    await cleanup();

    console.log("\n" + "=".repeat(50));
    console.log(`Tests Passed: ${testsPassed}`);
    console.log(`Tests Failed: ${testsFailed}`);
    console.log("=".repeat(50));

    process.exit(testsFailed > 0 ? 1 : 0);
  } catch (err) {
    console.error("\n❌ Test suite error:", err.message);
    await cleanup();
    process.exit(1);
  }
}

runTests();
```

### Integration Test Template

```javascript
#!/usr/bin/env node

import http from "http";

const BASE_URL = "http://localhost:4000";

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    };

    const req = http.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          body: JSON.parse(data),
        });
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log("🧪 My Integration Tests\n");

  try {
    // Test API endpoints
    const res = await makeRequest("GET", "/health");
    console.log("✓ Test passed");

    process.exit(0);
  } catch (err) {
    console.error("❌ Test failed:", err.message);
    process.exit(1);
  }
}

runTests();
```

## Continuous Integration

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - run: npm install
      - run: npm start &
      - run: sleep 5
      - run: npm test
```

## Debugging Tests

### Verbose Output

Add console.log statements in tests to see intermediate values.

### Run Single Test

```bash
node tests/unit/webhooks.test.ts
```

### Check Server Logs

Tests require the server running. Check server output for errors.

### Inspect Redis

```bash
redis-cli
> KEYS *
> GET webhook:wh_123...
```

## Test Data

Tests create temporary data with specific prefixes:
- `test-user-webhook-*` - Webhook test users
- `test-user-apikey-*` - API key test users
- `testuser_*` - Auth test users

All test data is cleaned up after tests complete.

## Performance

Typical test run times:
- Unit tests: ~5-10 seconds
- Integration tests: ~15-30 seconds
- Load tests: ~1-5 minutes (depending on config)

## Troubleshooting

**Tests fail with "Connection refused"**
- Ensure server is running on port 4000
- Check `npm run dev` is active

**Tests fail with "Redis connection error"**
- Ensure Redis is running on port 6379
- Check `redis-cli ping` returns PONG

**Auth tests fail**
- Clear Redis: `redis-cli FLUSHDB`
- Restart server

**Rate limit tests fail**
- Wait 60 seconds between test runs
- Redis keys expire after 1 minute

**Webhook tests timeout**
- Check network connectivity
- Webhook deliveries to httpbin.org may be slow
