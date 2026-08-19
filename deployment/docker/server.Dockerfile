# Server image for the Runnix code-executor API.
# Runtime-only (no dev deps). The sandbox needs access to the host Docker
# daemon, so mount /var/run/docker.sock when running in a container.
FROM node:22-bookworm-slim

WORKDIR /app

# Install runtime dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy application source.
COPY server.ts ./
COPY src ./src

# The API spawns sandbox containers via the Docker CLI over the mounted
# /var/run/docker.sock, so the CLI must be present in the image.
RUN apt-get update && apt-get install -y --no-install-recommends docker.io \
    && rm -rf /var/lib/apt/lists/*

# Non-root user.
RUN useradd -m appuser
USER appuser

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["node", "--experimental-strip-types", "server.ts"]

# Health check via Node's built-in fetch (no curl needed).
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
