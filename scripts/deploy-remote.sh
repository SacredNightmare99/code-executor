#!/usr/bin/env bash
#
# deploy-remote.sh — runs ON the server to deploy a specific release ref.
# Installs deps, rebuilds runner images when their Dockerfiles changed,
# reloads the app under pm2, verifies /health, and rolls back on failure.
#
# Usage: bash scripts/deploy-remote.sh [RELEASE_REF] [PREV_COMMIT]
#   RELEASE_REF: git ref (tag or branch) to deploy, e.g. v0.1.0.
#                Defaults to the current HEAD if empty.
#   PREV_COMMIT: the commit that was live before this deploy (for rollback +
#                to detect Dockerfile changes). May be empty.
#
set -euo pipefail

RELEASE_REF="${1:-}"
PREV="${2:-}"

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; }

reload_app() {
  pm2 reload runnix --update-env 2>/dev/null || pm2 restart runnix --update-env
}

# ── 0. Checkout the requested release ref ────────────────────────────────
if [ -n "$RELEASE_REF" ]; then
  REF_COMMIT=$(git rev-parse --verify "$RELEASE_REF^{commit}" 2>/dev/null || true)
  if [ -z "$REF_COMMIT" ]; then
    log "fetching tags"
    git fetch origin --tags
    REF_COMMIT=$(git rev-parse --verify "$RELEASE_REF^{commit}" 2>/dev/null || true)
  fi
  if [ -z "$REF_COMMIT" ]; then
    die "could not resolve ref: $RELEASE_REF"
    exit 1
  fi
  if [ "$(git rev-parse HEAD)" != "$REF_COMMIT" ]; then
    log "checking out release ref: $RELEASE_REF"
    git checkout -f "$RELEASE_REF"
  else
    log "already at $RELEASE_REF"
  fi
fi

# ── 1. Install dependencies ───────────────────────────────────────────────
log "installing dependencies (runtime only)"
if [ -f package-lock.json ]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi

# ── 2. Rebuild runner images only if their Dockerfiles changed ───────────
if [ -n "$PREV" ] && git diff --name-only "$PREV" HEAD | grep -q '^deployment/docker/'; then
  log "runner Dockerfiles changed — rebuilding images"
  docker build -f deployment/docker/runner-c.Dockerfile -t runner-c .
  docker build -f deployment/docker/runner-py.Dockerfile -t runner-py .
  docker build -f deployment/docker/runner-java.Dockerfile -t runner-java .
  docker build -f deployment/docker/runner-runtime.Dockerfile -t runner-runtime .
else
  log "no runner Dockerfile changes — skipping image build"
fi

# ── 3. Reload the app ─────────────────────────────────────────────────────
log "reloading runnix"
reload_app

# ── 4. Health check ───────────────────────────────────────────────────────
log "waiting for /health to report healthy"
OK=0
for i in $(seq 1 15); do
  if curl -fsS http://localhost:4000/health 2>/dev/null | grep -q '"healthy"'; then
    OK=1
    break
  fi
  sleep 2
done

if [ "$OK" != "1" ]; then
  die "health check FAILED — rolling back to ${PREV:-<previous>}"
  if [ -n "$PREV" ]; then
    git checkout -f "$PREV"
    log "reinstalling dependencies for rolled-back commit"
    if [ -f package-lock.json ]; then
      npm ci --omit=dev --no-audit --no-fund
    else
      npm install --omit=dev --no-audit --no-fund
    fi
    reload_app
  fi
  exit 1
fi

log "deploy complete — /health OK (ref: ${RELEASE_REF:-HEAD})"
