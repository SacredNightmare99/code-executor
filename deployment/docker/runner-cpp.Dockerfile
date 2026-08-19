FROM gcc:13

WORKDIR /app

RUN useradd -m runner
USER runner

CMD []
# Health check: verify GCC is available
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD g++ --version || exit 1
