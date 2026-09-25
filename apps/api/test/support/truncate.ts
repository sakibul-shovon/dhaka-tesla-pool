import type { Pool } from "pg";

// zones is reference data seeded by a migration (plan §7.1) — never
// truncated between tests. TRUNCATE does not fire the row-level
// BEFORE UPDATE OR DELETE history triggers, so this is safe cleanup even
// for the append-only tables.
const BUSINESS_TABLES = [
  "idempotency_keys",
  "pool_status_history",
  "ride_status_history",
  "pool_memberships",
  "pools",
  "ride_requests",
  "vehicles",
  "sessions",
  "users",
] as const;

export async function truncateAll(pool: Pool): Promise<void> {
  const tables = BUSINESS_TABLES.map((t) => `"${t}"`).join(", ");
  await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
