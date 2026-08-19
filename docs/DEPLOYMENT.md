# Production Deployment Guide

The service is designed to run on a single small VM (e.g. Oracle Cloud
Always-Free: 1 OCPU / 1GB RAM / Ubuntu) with this layout:

```
┌──────────────────────────────────────────────┐
│ VM                                          │
│  Node.js 22 (server + in-process workers)   │  ← pm2 ("runnix")
│  Redis (queue, jobs, users, tokens)         │  ← systemd, bound to 127.0.0.1
│  Docker daemon (spawns runner containers)   │  ← optional gVisor (runsc)
│    runner-c / runner-py / runner-java /     │
│    runner-runtime images                    │
└──────────────────────────────────────────────┘
```

## Requirements

- **Node.js ≥ 22.18** — the server runs directly from TypeScript with
  `node --experimental-strip-types` (no build step). Node < 22.6 cannot run it.
- **Redis** — queue, job storage, users, tokens. Bound to localhost.
- **Docker** — the app spawns sandbox containers via the Docker CLI. The
  `ubuntu` user must be in the `docker` group.
- **gVisor (runsc)** — optional but recommended, registered in
  `/etc/docker/daemon.json`. Falls back to runc if absent (`DISABLE_GVISOR`).

## Bootstrap (idempotent)

```bash
git clone <repo> ~/runnix
cd ~/runnix
bash scripts/bootstrap-server.sh
```

`scripts/bootstrap-server.sh`:

1. Creates a 2GB swapfile (avoids OOM kills on the 1GB box).
2. Installs Node 22 LTS, Redis, Docker, gVisor.
3. Hardens Redis: `bind 127.0.0.1`, `maxmemory 192mb`, `allkeys-lru`, optional
   `requirepass` (set `REDIS_PASSWORD` before running).
4. Registers the `runsc` runtime and sets Docker log rotation.
5. Generates a strong `JWT_SECRET` into `.env` (never overwrites an existing one).
6. Runs `npm ci --omit=dev` and builds the four runner images.
7. Seeds the admin user.
8. Registers the app with pm2 (`ecosystem.config.cjs`) and enables `pm2 startup`
   so it survives reboots; installs `pm2-logrotate`.

After bootstrap, verify:

```bash
curl -s http://localhost:4000/health   # {"status":"healthy",...}
pm2 status
docker info --format '{{json .Runtimes}}'   # should include runsc
```

## pm2

Runtime settings live in `ecosystem.config.cjs`:

- `instances: 1` (fork mode) — workers run in-process; keep this at 1.
- `max_memory_restart: 350M` — auto-restart if Node leaks.
- `kill_timeout: 12000` — gives graceful shutdown time to finish in-flight jobs.
- Logs go to `~/.pm2/logs/runnix-*.log` (rotated by `pm2-logrotate`).

```bash
pm2 start ecosystem.config.cjs && pm2 save
pm2 reload runnix --update-env   # zero-downtime reload after config/env changes
```

## Environment (.env)

Copy `.env.example` to `.env` (bootstrap does this for you) and set:

| Variable            | Default                 | Note                                   |
|---------------------|-------------------------|----------------------------------------|
| `NODE_ENV`          | `development`           | set to `production` on the VM          |
| `WORKERS`           | `1`                     | keep 1 on a 1GB box                    |
| `MAX_CONCURRENT`    | `2`                     | running containers at once (1GB box)   |
| `MAX_QUEUE`         | `200`                   | queued jobs cap                        |
| `SANDBOX_MEMORY`    | `128m`                  | per-container memory limit             |
| `EXEC_TIMEOUT_MS`   | `2000`                  | Python/C timeout (Java uses 8s)        |
| `JWT_SECRET`        | *(none)*                | **required in production** — bootstrap generates one |
| `REDIS_URL`         | `redis://localhost:6379`| add `:password@` if you set `requirepass` |

In production the app **refuses to start** if `JWT_SECRET` is missing or still
the default.

## CI / CD

- **`.github/workflows/ci.yml`** — runs on every push/PR: `npm ci`, `tsc --noEmit`,
  ESLint, pure unit tests, and Redis-backed unit tests (Redis service container).
- **`.github/workflows/deploy.yml`** — **runs only on tagged releases**
  (`v*` tags) or a manual `workflow_dispatch`. It deploys the tagged ref to the
  VM over SSH (`appleboy/ssh-action`) and runs `scripts/deploy-remote.sh`, which:
  1. Checks out the release ref.
  2. Installs runtime deps (`npm ci --omit=dev`).
  3. Rebuilds the runner images **only** when `deployment/docker/**` changed.
  4. `pm2 reload runnix --update-env`.
  5. Waits for `/health` to report healthy; on failure rolls back to the
     previous commit and reloads.
- **`.github/workflows/release.yml`** — on tag push, builds release notes from
  `CHANGELOG.md` and creates a GitHub Release.

GitHub repo secrets required: `HOST`, `SSH_KEY`, and optionally `SSH_USER`
(defaults to `ubuntu`).

> **Note:** `package-lock.json` must be committed for `npm ci` to work — it is
> no longer gitignored.

## Releasing

Deployments are triggered by version tags — pushing to `main` **does not**
deploy. To cut a release:

1. **Update `CHANGELOG.md`** — move entries from `[Unreleased]` into a new
   `[x.y.z] - <date>` section (Keep a Changelog format) and update the compare
   link at the bottom.
2. **Bump the version** in `package.json` (semver: while `0.x`, breaking
   changes bump the minor; from `1.0.0` onward breaking changes bump the major).
3. Commit and push to `main` (CI runs, but nothing deploys).
4. **Tag and push the tag:**
   ```bash
   git tag -a v0.1.0 -m "Release 0.1.0"
   git push origin v0.1.0
   ```
   This triggers `deploy.yml` (server update + health check + rollback) and
   `release.yml` (GitHub Release with notes from the CHANGELOG).

## Sizing the 1GB box

Memory is the constraint: Node (~150-250MB) + Redis (192MB cap) + Docker daemon
(~100MB) + runner containers (128MB each, × `MAX_CONCURRENT`). Keep
`MAX_CONCURRENT=2` (≈256MB of sandbox) and add swap via the bootstrap script.
If you raise concurrency, raise the instance size accordingly.

## Troubleshooting

- **`pm2 restart` leaves jobs stuck RUNNING** — shouldn't happen anymore: on
  startup the app requeues in-flight jobs (processing list + RUNNING scan), and
  a sweeper fails jobs stuck RUNNING for >30s.
- **`/submit` returns SYSTEM_ERROR / Docker not reachable** — the pm2 user isn't
  in the `docker` group (`sudo usermod -aG docker ubuntu && newgrp docker`).
- **gVisor not used** — check `docker info` runtimes and that
  `/usr/local/bin/runsc` exists; or set `DISABLE_GVISOR=true` to force off.
- **OOM kills** — check `dmesg | grep -i oom`; reduce `MAX_CONCURRENT`/`WORKERS`,
  ensure swap is on, and check Redis `maxmemory`.
