// Restores a known-good demo state on demand (plan §18.1, §21 K11 "demo
// non-deterministic") — truncates every business table (never zones, which
// are migration-seeded reference data) and reseeds the story cast, so a
// video take or a re-run of the last-seat race always starts from the same
// place. Truncates rather than dropping schemas: the migrations tracking
// table is untouched, so this is safe to run against a database that's
// already fully migrated without re-running drizzle-kit at all.
import "../lib/load-env.js";
import { Pool } from "pg";
import { runSeed } from "./seed/index.js";

const BUSINESS_TABLES = [
  "idempotency_keys",
  "wallet_transactions",
  "wallets",
  "pool_status_history",
  "ride_status_history",
  "pool_memberships",
  "pools",
  "ride_requests",
  "vehicles",
  "sessions",
  "users",
] as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const demoPassword = process.env.DEMO_PASSWORD;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required to reset the database.");
    process.exit(1);
  }
  if (!demoPassword) {
    console.error("DEMO_PASSWORD is required to reseed the demo cast.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const tables = BUSINESS_TABLES.map((t) => `"${t}"`).join(", ");
    await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
    console.log("tables truncated");
  } finally {
    await pool.end();
  }

  await runSeed(databaseUrl, demoPassword);
  console.log("db:reset complete");
}

main().catch((err: unknown) => {
  console.error("db:reset failed:", err);
  process.exit(1);
});
