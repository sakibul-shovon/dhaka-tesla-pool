import pino from "pino";
import type { Env } from "../config/env.js";

// Redaction list from docs/IMPLEMENTATION_PLAN.md §14 — never log credentials
// or session material, even by accident through a spread object.
export function createLogger(env: Pick<Env, "LOG_LEVEL">): pino.Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: ["req.headers.cookie", "req.headers.authorization", "*.password", "*.token"],
      remove: true,
    },
  });
}
