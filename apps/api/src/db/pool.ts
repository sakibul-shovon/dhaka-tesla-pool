import { Pool } from "pg";

// §18.3's 1s readiness timeout lives here as connectionTimeoutMillis so an
// unreachable DB fails /readyz fast. `max` is env-configurable (DB_POOL_MAX)
// but defaults to the same 5 the free-tier deployment decision calls for.
export function createPool(databaseUrl: string, max = 5): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max,
    connectionTimeoutMillis: 1000,
    idleTimeoutMillis: 10_000,
  });
}
