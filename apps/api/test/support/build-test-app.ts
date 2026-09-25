import type { Pool } from "pg";
import type pino from "pino";
import { buildApp } from "../../src/app.js";

// Shared defaults so integration tests don't repeat AppDeps boilerplate.
export function buildTestApp(pool: Pool, logger: pino.Logger) {
  return buildApp({ pool, logger, sessionTtlHours: 1, cookieSecure: false });
}
