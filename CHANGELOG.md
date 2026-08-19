# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-19

First semver release. This release formalizes the pre-alpha codebase: it
hardens the sandbox, makes the job queue crash-safe, adds security guards, and
introduces reproducible CI/CD + production deployment tooling.

### Added

- **Reliable job queue**: jobs are atomically moved to a `jobs:processing`
  list; on startup any in-flight jobs are requeued, and a periodic sweeper
  fails jobs stuck `RUNNING` for >30s (`src/core/workers/jobRecovery.ts`).
- **Java 21 support** (runtime image `runner-java`) — routed through the shared
  sandbox builder with the same security posture as Python/C.
- **SSRF guard** for webhook URLs: http(s) only, blocks private/loopback/
  link-local/metadata addresses at creation and delivery
  (`src/utils/urlSafety.ts`).
- **Language validation** on `/submit` — unsupported languages now rejected
  with `400 UNSUPPORTED_LANGUAGE` instead of failing at execution time.
- **IP-based rate limiting** on `/auth/login` and `/auth/register` to mitigate
  brute force and signup spam.
- **Production `JWT_SECRET` guard** — the app refuses to start in production
  with a missing/default secret.
- **CI workflow** (`.github/workflows/ci.yml`): `npm ci`, `tsc --noEmit`,
  ESLint, pure + Redis-backed unit tests on every push/PR.
- **Tag-gated deployment** (`.github/workflows/deploy.yml`): deploys the pushed
  version tag; installs deps, rebuilds runner images only when their
  Dockerfiles changed, health-checks `/health`, and rolls back on failure.
- **Release workflow** (`.github/workflows/release.yml`): builds release notes
  from `CHANGELOG.md` and creates a GitHub Release on tag push.
- **Production tooling**: `ecosystem.config.cjs` (pm2), idempotent
  `scripts/bootstrap-server.sh` (Node 22, Redis, Docker, gVisor, swap, pm2
  startup), `scripts/deploy-remote.sh`, `.nvmrc`, `docs/DEPLOYMENT.md`.
- ESLint + `npm run lint`/`typecheck` scripts; `package-lock.json` is now
  committed for reproducible installs.

### Changed

- **Memory/concurrency defaults** tuned for a 1GB host: `WORKERS=1`,
  `MAX_CONCURRENT=2`, `MAX_QUEUE=200`, `SANDBOX_MEMORY=128m` (was 2/10/1000/256m).
  Update `.env` if you rely on the old defaults.
- **Request body limit** raised 100KB → 6MB to match the documented code/input
  limits.
- **Queue metrics** now reflect real Redis queue state (`/status` no longer
  reports a frozen `current_size` of 0); metric sample arrays are capped.
- Sandbox memory limit is configurable via `SANDBOX_MEMORY`.
- `config/prometheus.yml` scrape target fixed to `code-executor:4000`;
  `docker-compose.monitoring.yml` corrected (real server image, docker-socket
  mount, correct Grafana volume path, pinned image versions, restart policy).

### Security

- Java runner now uses the full sandbox profile (gVisor, `--cap-drop=ALL`,
  `--read-only`, tmpfs, pids limit) and kills its own container on timeout
  (previously it attempted `docker kill $(docker ps -q)`, which orphaned
  containers).
- Production error handler no longer leaks internal 500 messages to clients.
- Webhook SSRF protection (see Added).

### Breaking

- `/submit` returns `400 UNSUPPORTED_LANGUAGE` for unknown languages (previously
  accepted and failed at runtime).
- Webhook registration rejects private/local/metadata URLs and non-http(s)
  schemes.
- In production, a missing/default `JWT_SECRET` prevents startup.
- Config defaults changed (see Changed) — set env vars explicitly.

[0.1.0]: https://github.com/ishaan-jindal/runnix/releases/tag/v0.1.0
