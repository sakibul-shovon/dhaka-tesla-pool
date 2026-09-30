import { describe, expect, it } from "vitest";
import { createPool } from "../../src/db/pool.js";

describe("createPool", () => {
  it("waits long enough for a free-tier database to wake up", async () => {
    // Nothing connects here (pg connects lazily, on first query); this only
    // reads the configured timeout back. At the old 1s, the first request
    // after an idle spell failed before Neon was awake.
    const pool = createPool("postgres://dtp@127.0.0.1:59999/none");
    try {
      expect(pool.options.connectionTimeoutMillis).toBeGreaterThanOrEqual(5_000);
    } finally {
      await pool.end();
    }
  });
});
