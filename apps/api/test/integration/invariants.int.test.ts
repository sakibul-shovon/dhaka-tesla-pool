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
    const {
      rows: [poolRow],
    } = await pool.query<{ id: string }>(
      `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot, seats_reserved) VALUES ($1, $2, 'BANANI', 3, 2) RETURNING id`,
      [vehicle!.id, driver!.id],
    );
    // A real pool always gets an OPEN creation history row (insertPoolCreationHistory) —
    // write it here too so this fixture isolates the I4 drift, not I14.
    await pool.query(`INSERT INTO pool_status_history (pool_id, from_status, to_status) VALUES ($1, NULL, 'OPEN')`, [
      poolRow!.id,
    ]);

    const violations = await assertInvariants(pool);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.invariant).toContain("I4");
  });

  it("catches a ride request whose latest history row disagrees with its status (I14)", async () => {
    const {
      rows: [passenger],
    } = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('P', 'i14@dhakateslapool.test', 'x', 'PASSENGER') RETURNING id`,
    );
    const {
      rows: [ride],
    } = await pool.query<{ id: string }>(
      `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method, status)
       VALUES ($1, 'BANANI', 'MOHAKHALI', 1, 25, 6750, 5400, 'CASH', 'CANCELLED') RETURNING id`,
      [passenger!.id],
    );
    // History still says REQUESTED — a drift only a real transition-writing bug could cause.
    await pool.query(
      `INSERT INTO ride_status_history (ride_request_id, from_status, to_status) VALUES ($1, NULL, 'REQUESTED')`,
      [ride!.id],
    );

    const violations = await assertInvariants(pool);
    expect(violations.some((v) => v.invariant.includes("I14") && v.invariant.includes("ride_request"))).toBe(true);
  });

  it("catches a terminal ride request with no terminal timestamp", async () => {
    const {
      rows: [passenger],
    } = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('P', 'terminal@dhakateslapool.test', 'x', 'PASSENGER') RETURNING id`,
    );
    const {
      rows: [ride],
    } = await pool.query<{ id: string }>(
      `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method, status)
       VALUES ($1, 'BANANI', 'MOHAKHALI', 1, 25, 6750, 5400, 'CASH', 'COMPLETED') RETURNING id`,
      [passenger!.id],
    );
    await pool.query(
      `INSERT INTO ride_status_history (ride_request_id, from_status, to_status) VALUES ($1, 'STARTED', 'COMPLETED')`,
      [ride!.id],
    );

    const violations = await assertInvariants(pool);
    expect(violations.some((v) => v.invariant.includes("terminal ride_request"))).toBe(true);
  });
});
