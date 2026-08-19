# Docker Images Documentation

This document describes the Docker images used by the code executor and how to
build, secure, and maintain them.

## Available Images

All Dockerfiles live in `deployment/docker/`.

### 1. `runner-c` (C Compilation)
Dockerfile: `deployment/docker/runner-c.Dockerfile`

- **Purpose**: Compiles C code with GCC (`-O2`).
- **Base**: `gcc:13` (Debian-based).
- **User**: non-root `runner`.
- **Build**:
  ```bash
  docker build -f deployment/docker/runner-c.Dockerfile -t runner-c .
  ```

### 1.b. `runner-cpp` (C++ Compilation)
Dockerfile: `deployment/docker/runner-cpp.Dockerfile`
- Based on `gcc:13`
- Contains g++
- Compiles C++ code into an ELF binary but cannot execute it.
- Uses `-std=c++17`

  ```bash
  docker build -f deployment/docker/runner-cpp.Dockerfile -t runner-cpp .
  ```

### 2. `runner-py` (Python Runtime)
Dockerfile: `deployment/docker/runner-py.Dockerfile`

- **Purpose**: Executes Python 3.12 scripts.
- **Base**: `python:3.12-alpine`.
- **User**: non-root `runner` (`ENTRYPOINT ["python3"]`).
- **Build**:
  ```bash
  docker build -f deployment/docker/runner-py.Dockerfile -t runner-py .
  ```

### 3. `runner-java` (Java 21)
Dockerfile: `deployment/docker/runner-java.Dockerfile`

- **Purpose**: Compiles (`javac`) and runs Java 21 code in a single container.
- **Base**: `eclipse-temurin:21-jdk-alpine`.
- **User**: non-root `runner`.
- **Build**:
  ```bash
  docker build -f deployment/docker/runner-java.Dockerfile -t runner-java .
  ```

### 4. `runner-runtime` (C/C++ Binary Execution)
Dockerfile: `deployment/docker/runner-runtime.Dockerfile`

- **Purpose**: Runs compiled C and C++ binaries (`./a.out`).
- **Base**: `debian:trixie-slim` (provides `GLIBCXX_3.4.32` and glibc matching `gcc:13`).
- **User**: non-root `runner`.
- **Build**:
  ```bash
  docker build -f deployment/docker/runner-runtime.Dockerfile -t runner-runtime .
  ```

### Building All Images

```bash
docker build -f deployment/docker/runner-c.Dockerfile -t runner-c .
docker build -f deployment/docker/runner-cpp.Dockerfile -t runner-cpp .
docker build -f deployment/docker/runner-py.Dockerfile -t runner-py .
docker build -f deployment/docker/runner-java.Dockerfile -t runner-java .
docker build -f deployment/docker/runner-runtime.Dockerfile -t runner-runtime .
```

## Runtime Requirements

### gVisor

The executor uses gVisor (`runsc`) for stronger isolation when available.
Install and register it with Docker:

```bash
curl -fsSL https://gvisor.dev/archive/latest/runsc > /usr/local/bin/runsc
chmod +x /usr/local/bin/runsc

# /etc/docker/daemon.json
{
  "runtimes": {
    "runsc": { "path": "/usr/local/bin/runsc" }
  }
}
sudo systemctl restart docker
```

On startup the app detects runsc via `docker info` and logs whether sandbox
hardening is enabled. Set `DISABLE_GVISOR=true` to force it off.

## Security Model

Every runner container is launched by `src/core/runner/sandbox.ts`
(`buildSandboxArgs`/`buildCompileArgs`), which applies:

1. **Non-root user**: runs as `runner`.
2. **No network**: `--network=none`.
3. **Dropped capabilities**: `--cap-drop=ALL`.
4. **No new privileges**: `--security-opt=no-new-privileges`.
5. **Read-only root filesystem**: `--read-only` (execution only; compilation
   mounts `/app` read-write for build artifacts).
6. **Tmpfs**: `/tmp` is a tmpfs (`nosuid,noexec`) — code cannot persist files.
7. **Resource limits** (from `src/config/index.ts`, overridable per language):
   - Memory: `128m` (env `SANDBOX_MEMORY`), Java `128m`
   - CPU: `0.5` (Java `1`)
   - Processes: `32` (Java `100`)
   - Timeout: 2s Python/C (env `EXEC_TIMEOUT_MS`), 8s Java
8. **gVisor**: `--runtime=runsc` when available.

The Java runner is routed through the same sandbox builder as Python/C for a
consistent security posture.

## Customization: Adding a New Language

1. Create `deployment/docker/runner-<lang>.Dockerfile` (distroless/alpine base,
   non-root user).
2. Register it in `src/core/languages/languageRegistry.ts` (id, aliases,
   limits, example).
3. Add a runner in `src/core/runner/run<Lang>.ts` that uses `buildSandboxArgs`
   (or `buildCompileArgs` for compiled languages).
4. Dispatch to it from `src/core/runner/runCode.ts`.
5. Add a unit test in `tests/unit/`.

## Maintenance

- Rebuild images after base-image security patches:
  ```bash
  docker pull gcc:13 python:3.12-alpine eclipse-temurin:21-jdk-alpine debian:bookworm-slim
  docker build --no-cache -f deployment/docker/runner-c.Dockerfile -t runner-c .
  # ... etc
  ```
- In CI/CD, runner images are rebuilt automatically only when their Dockerfiles
  change (see `scripts/deploy-remote.sh`).
