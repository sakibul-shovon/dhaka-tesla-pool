import "../../src/lib/load-env.js";
import { Pool } from "pg";

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL must be set to run integration tests.");
  }
  return url;
}

export function createTestPool(options?: { max?: number }): Pool {
  return new Pool({ connectionString: testDatabaseUrl(), ...(options?.max ? { max: options.max } : {}) });
}
