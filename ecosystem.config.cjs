module.exports = {
  apps: [
    {
      name: "runnix",
      script: "server.ts",
      interpreter: "node",
      interpreter_args: "--experimental-strip-types",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      // Auto-restart if the process exceeds this memory (1GB box, node ~200MB).
      max_memory_restart: "350M",
      // Logs go to pm2's default location (~/.pm2/logs/runnix-*.log).
      // Install pm2-logrotate for rotation: pm2 install pm2-logrotate
      merge_logs: true,
      time: true,
      // Graceful shutdown: give SIGTERM time to finish in-flight HTTP + jobs.
      kill_timeout: 12000,
      listen_timeout: 15000,
      // Restart strategy
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      exp_backoff_restart_delay: 100,
      // Pass through env vars from .env at startup
      update_env: true,
    },
  ],
};
