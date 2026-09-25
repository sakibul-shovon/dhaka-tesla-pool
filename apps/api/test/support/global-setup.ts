import { runMigrations } from "../../src/db/migrate.js";
import { testDatabaseUrl } from "./db.js";

// Runs once before the whole test run so every integration test can assume
// an up-to-date schema without re-migrating per file.
export default async function setup(): Promise<void> {
  await runMigrations(testDatabaseUrl());
}
