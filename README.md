# Runnix — ARCHIVED

> **Archived — `runnix` → `runnix-legacy`.** This Node.js/TypeScript prototype is frozen. No new issues or PRs will be accepted here. Active development has moved to the Go + Kubernetes rewrite.

## What this was

`runnix` (originally `code-executor`, v0.1.0) — a single-VM sandboxed code execution service. Express + TypeScript, Redis-backed job queue with crash recovery (`jobs:processing` requeue + `RUNNING` sweeper), Docker + gVisor (`runsc`) isolation, JWT auth with tiered rate limiting (free 10 → enterprise 500 req/min), Prometheus/Grafana observability, and tag-gated `pm2` deploys on a 1 GB OCI VM. Supported Python 3.12, C (GCC 13), and Java 21. It proved the product surface; it does not scale to multi-tenant Kubernetes.

## Why archived — what v2 is

| v1 (this repo, frozen) | v2 (new `runnix`, Go + K8s) |
|---|---|
| Single VM, `pm2`, `WORKERS=1` | Go control plane + API gateway, horizontally scalable |
| Redis list as queue | **NATS JetStream** — durable streams, per-language subjects, at-least-once delivery |
| `docker run --runtime=runsc` per execution | **Job-per-execution** `k8s Job` with `RuntimeClass: kata-gvisor`, `cap-drop=ALL`, read-only rootfs, no egress by default |
| Single Redis namespace, app-level isolation | **Namespace-per-tenant** with `ResourceQuota`, `LimitRange`, `NetworkPolicy` default-deny |
| `config/prometheus.yml` + Grafana on compose | OTel + kube-prometheus, tenant-scoped metrics |

v2 is a proper multi-tenant sandboxed execution platform on Kubernetes. See the vault for the full vision: `Runnix/` (Obsidian).

## New home

- **Active repo (Go + K8s):** `github.com/ishaan-jindal/runnix` — to be created — will be the source of truth. This repo will be renamed to **`runnix-legacy`** and archived on GitHub.
- **Vault (vision + migration map):** `Runnix/Runnix.md`, `Runnix/01-Overview/About.md`, `Runnix/01-Overview/Architecture.md`, `Runnix/04-Development/Migration-Map.md`.

## Legacy use (frozen)

This codebase is frozen at **[v0.1.0](https://github.com/ishaan-jindal/runnix/releases/tag/v0.1.0)**. `docs/` is kept as-is for reference.

- Docs: [docs/API.md](docs/API.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/DOCKER.md](docs/DOCKER.md) · [docs/MONITORING.md](docs/MONITORING.md) · [docs/TESTING.md](docs/TESTING.md) · [docs/ADMIN.md](docs/ADMIN.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

If you need to run it:

```bash
cp .env.example .env   # set JWT_SECRET — app refuses to start in production without it
npm ci
# build runner images (requires Docker + gVisor runsc)
docker build -f deployment/docker/runner-py.Dockerfile -t runner-py .
docker build -f deployment/docker/runner-c.Dockerfile -t runner-c .
docker build -f deployment/docker/runner-java.Dockerfile -t runner-java .
npm run dev            # Node >=22.18, Redis required
```

No further releases are planned from this repo. File issues/PRs against the new `runnix` Go repo once it is live.
