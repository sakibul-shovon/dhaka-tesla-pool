import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { assertInvariants } from "../support/assert-invariants.js";

let pool: Pool;

beforeAll(() => {
  pool = createTestPool();
});

afterEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("assertInvariants", () => {
  it("finds nothing wrong on an empty database", async () => {
    expect(await assertInvariants(pool)).toEqual([]);
  });

  it("catches seats_reserved drifting from membership seats (I4)", async () => {
    const {
      rows: [driver],
    } = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('D', 'drift@dhakateslapool.test', 'x', 'DRIVER') RETURNING id`,
    );
    const {
      rows: [vehicle],
    } = await pool.query<{ id: string }>(
      `INSERT INTO vehicles (driver_id, name, capacity, is_online, current_zone) VALUES ($1, 'Bullet', 3, false, 'BANANI') RETURNING id`,
      [driver!.id],
    );
    // seats_reserved claims 2 while no membership backs that up — a drift the DB CHECK alone can't catch.
    await pool.query(
      `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot, seats_reserved) VALUES ($1, $2, 'BANANI', 3, 2)`,
      [vehicle!.id, driver!.id],
    );

    const violations = await assertInvariants(pool);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.invariant).toContain("I4");
  });
});
