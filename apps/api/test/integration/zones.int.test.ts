import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";

let pool: Pool;

beforeAll(() => {
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
});

describe("zones reference data (plan §7.1)", () => {
  it("has all 10 zones with Banani at the grid origin", async () => {
    const { rows } = await pool.query<{ code: string; x_dkm: number; y_dkm: number }>(
      `SELECT code, x_dkm, y_dkm FROM zones ORDER BY code`,
    );
    expect(rows).toHaveLength(10);

    const banani = rows.find((z) => z.code === "BANANI");
    expect(banani).toEqual({ code: "BANANI", x_dkm: 0, y_dkm: 0 });

    const mohakhali = rows.find((z) => z.code === "MOHAKHALI");
    expect(mohakhali).toEqual({ code: "MOHAKHALI", x_dkm: -5, y_dkm: -20 });
  });
});
