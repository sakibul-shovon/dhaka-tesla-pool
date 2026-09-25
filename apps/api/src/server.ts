import { parseEnv, EnvValidationError } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { createPool } from "./db/pool.js";
import { buildApp } from "./app.js";

let env;
try {
  env = parseEnv();
} catch (err) {
  if (err instanceof EnvValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger(env);
const pool = createPool(env.DATABASE_URL);
const app = buildApp({
  pool,
  logger,
  sessionTtlHours: env.SESSION_TTL_HOURS,
  cookieSecure: env.COOKIE_SECURE,
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "api listening");
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down");
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
