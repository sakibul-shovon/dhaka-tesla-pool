import { Pool } from "pg";

// Just a connection pool for now — schema, migrations and seed data land in
// feature/database-schema (plan §5). §18.3's 1s readiness timeout lives here
// as connectionTimeoutMillis so an unreachable DB fails /readyz fast.
export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: 1000,
    idleTimeoutMillis: 10_000,
  });
}
