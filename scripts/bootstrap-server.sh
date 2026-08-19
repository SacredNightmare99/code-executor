#!/usr/bin/env bash
#
# bootstrap-server.sh — idempotent provisioning for the Runnix code-executor
# on an Oracle Cloud Always-Free VM (1 OCPU / 1GB RAM, Ubuntu).
#
# Run as a user with sudo (e.g. ubuntu):
#   bash scripts/bootstrap-server.sh
#
# What it does:
#   - Installs Node.js 22 LTS, Redis, Docker, gVisor (runsc)
#   - Hardens Redis (maxmemory + requirepass) and configures Docker runsc runtime
#   - Creates a 2GB swapfile (prevents OOM kills on the 1GB box)
#   - Generates a strong JWT_SECRET into .env (never overwrites an existing .env)
#   - Installs deps, builds the 4 runner images
#   - Registers the app with pm2 + enables pm2 startup so it survives reboots
#
set -euo pipefail

APP_DIR="${1:-$HOME/runnix}"
PM2_USER="${PM2_USER:-$USER}"

log()  { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

has() { command -v "$1" >/dev/null 2>&1; }

# ── Swap (2GB) ────────────────────────────────────────────────────────────
setup_swap() {
  if swapon --show | grep -q /swapfile; then
    log "swapfile already active"
  else
    log "creating 2GB swapfile"
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    log "set vm.swappiness=10"
    sudo sysctl -w vm.swappiness=10 >/dev/null
    echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf >/dev/null
  fi
}

# ── Node.js 22 LTS ────────────────────────────────────────────────────────
setup_node() {
  if has node && [ "$(node -v | cut -d. -f1 | tr -d 'v')" -ge 22 ]; then
    log "node $(node -v) already installed"
    return
  fi
  log "installing Node.js 22 LTS"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
}

# ── Redis (hardened) ──────────────────────────────────────────────────────
setup_redis() {
  if ! has redis-server; then
    log "installing redis-server"
    sudo apt-get update
    sudo apt-get install -y redis-server
  else
    log "redis-server already installed"
  fi

  local CONF=/etc/redis/redis.conf
  # Bind to localhost only — the app runs on the same host.
  sudo sed -i 's/^bind .*/bind 127.0.0.1 -::1/' "$CONF"
  sudo sed -i 's/^# *maxmemory <bytes>/maxmemory 192mb/' "$CONF"
  sudo sed -i 's/^# *maxmemory-policy .*/maxmemory-policy allkeys-lru/' "$CONF"

  # Protect Redis with a password when REDIS_PASSWORD is provided.
  if [ -n "${REDIS_PASSWORD:-}" ]; then
    sudo sed -i "s/^# *requirepass .*/requirepass ${REDIS_PASSWORD}/" "$CONF"
    log "redis requirepass set (REDIS_PASSWORD from environment)"
  fi

  sudo systemctl enable redis-server >/dev/null 2>&1 || true
  sudo systemctl restart redis-server
}

# ── Docker ────────────────────────────────────────────────────────────────
setup_docker() {
  if ! has docker; then
    log "installing Docker"
    curl -fsSL https://get.docker.com | sudo sh
  else
    log "docker already installed"
  fi
  sudo usermod -aG docker "$PM2_USER" || true
  sudo systemctl enable docker >/dev/null 2>&1 || true
  sudo systemctl restart docker
}

# ── gVisor (runsc) ────────────────────────────────────────────────────────
setup_gvisor() {
  if has runsc; then
    log "runsc already installed"
  else
    log "installing gVisor (runsc)"
    curl -fsSL https://gvisor.dev/archive/latest/runsc > /tmp/runsc
    chmod +x /tmp/runsc
    sudo mv /tmp/runsc /usr/local/bin/runsc
  fi

  # Register runsc runtime with the Docker daemon.
  local DAEMON=/etc/docker/daemon.json
  if [ ! -f "$DAEMON" ] || ! grep -q runsc "$DAEMON"; then
    log "registering runsc runtime in $DAEMON"
    sudo tee "$DAEMON" >/dev/null <<'EOF'
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc"
    }
  },
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
    sudo systemctl restart docker
  fi
}

# ── App environment ───────────────────────────────────────────────────────
setup_env() {
  [ -f "$APP_DIR/.env" ] && return
  [ -f "$APP_DIR/.env.example" ] || die ".env.example not found in $APP_DIR"
  log "creating .env with a generated JWT_SECRET"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  local secret
  secret="$(openssl rand -hex 48)"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${secret}|" "$APP_DIR/.env"
  # Production-friendly defaults for the 1GB box.
  sed -i 's/^NODE_ENV=.*/NODE_ENV=production/' "$APP_DIR/.env"
  sed -i 's/^WORKERS=.*/WORKERS=1/' "$APP_DIR/.env"
  if [ -n "${REDIS_PASSWORD:-}" ]; then
    sed -i "s|^REDIS_URL=.*|REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379|" "$APP_DIR/.env"
  fi
  log "generated JWT_SECRET and saved to $APP_DIR/.env (edit it if needed)"
}

# ── App install + runner images ───────────────────────────────────────────
setup_app() {
  cd "$APP_DIR"
  log "installing dependencies"
  if [ -f package-lock.json ]; then
    npm ci --omit=dev --no-audit --no-fund
  else
    npm install --omit=dev --no-audit --no-fund
  fi

  log "building runner images (this can take a while)"
  docker build -f deployment/docker/runner-c.Dockerfile -t runner-c . >/dev/null
  docker build -f deployment/docker/runner-py.Dockerfile -t runner-py . >/dev/null
  docker build -f deployment/docker/runner-java.Dockerfile -t runner-java . >/dev/null
  docker build -f deployment/docker/runner-runtime.Dockerfile -t runner-runtime . >/dev/null

  log "seeding admin user (idempotent)"
  npm run seed:admin
}

# ── pm2 ───────────────────────────────────────────────────────────────────
setup_pm2() {
  if ! has pm2; then
    log "installing pm2"
    sudo npm install -g pm2
  fi
  # Ensure pm2 belongs to the correct user (avoid running as root).
  sudo env PATH="$PATH:/usr/local/bin" pm2 startup systemd -u "$PM2_USER" --hp "/home/$PM2_USER" >/dev/null 2>&1 || true

  cd "$APP_DIR"
  if ! pm2 describe runnix >/dev/null 2>&1; then
    log "starting runnix under pm2"
    pm2 start ecosystem.config.cjs
    pm2 save
  else
    log "runnix already registered with pm2 — restarting with new config"
    pm2 restart runnix --update-env
    pm2 save
  fi

  if ! pm2 ls | grep -q pm2-logrotate; then
    log "installing pm2-logrotate (log rotation)"
    pm2 install pm2-logrotate >/dev/null 2>&1 || warn "pm2-logrotate install failed (skip: install manually)"
  fi
}

# ── main ──────────────────────────────────────────────────────────────────
main() {
  [ -d "$APP_DIR" ] || die "app directory not found: $APP_DIR (clone the repo first)"
  setup_swap
  setup_node
  setup_redis
  setup_docker
  setup_gvisor
  setup_env
  setup_app
  setup_pm2

  log "bootstrap complete."
  log "Next steps:"
  log "  - logout/login (or run 'newgrp docker') to pick up the docker group"
  log "  - verify: curl -s http://localhost:4000/health"
  log "  - logs:    pm2 logs runnix"
  log "  - gVisor:  check 'runsc --version' and that /metrics shows sandbox hardening"
}

main "$@"
