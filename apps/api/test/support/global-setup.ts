import { runMigrations } from "../../src/db/migrate.js";

// Runs once before the whole test run so every integration test can assume
// an up-to-date schema without re-migrating per file. Skipped (not failed)
// when DATABASE_URL is unset, so a filtered run of only the pure unit tests
// under test/unit (plan §16.1: "ms, no I/O") never needs a database at all —
// any integration test that actually runs will still fail clearly on its
// own first query.
export default async function setup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("DATABASE_URL not set — skipping migrations for this test run.");
    return;
  }
  await runMigrations(databaseUrl);
}
