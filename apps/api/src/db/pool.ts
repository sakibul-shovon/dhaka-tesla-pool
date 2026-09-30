import { Pool } from "pg";

// A free-tier Postgres (Neon) suspends when idle and takes a few seconds to
// wake on the first connection, so waiting for a connection has to outlast
// that: at 1s the first request after a quiet spell failed as a 500 before
// the database was even awake. /readyz keeps its own 1s cap (see health
// routes) so a slow database still fails readiness fast.
// `max` is env-configurable (DB_POOL_MAX) but defaults to the same 5 the
// free-tier deployment decision calls for.
export const CONNECTION_TIMEOUT_MS = 10_000;

export function createPool(databaseUrl: string, max = 5): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: 10_000,
  });
}
