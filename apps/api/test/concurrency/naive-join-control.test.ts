import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { assertInvariants } from "../support/assert-invariants.js";
import { naiveJoinPool } from "../support/naive-join-pool.js";

let pool: Pool;

beforeAll(() => {
  pool = createTestPool({ max: 5 });
});

afterEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

async function seedLastSeatScenario(): Promise<{ poolId: string; requestAId: string; requestBId: string }> {
  const {
    rows: [driver],
  } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Jashim', 'naive-driver@dhakateslapool.test', 'x', 'DRIVER') RETURNING id`,
  );
  const {
    rows: [vehicle],
  } = await pool.query<{ id: string }>(
    `INSERT INTO vehicles (driver_id, name, capacity, is_online, current_zone) VALUES ($1, 'Bullet', 3, true, 'BANANI') RETURNING id`,
    [driver!.id],
  );
  const {
    rows: [poolRow],
  } = await pool.query<{ id: string }>(
    `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot, seats_reserved) VALUES ($1, $2, 'BANANI', 3, 2) RETURNING id`,
    [vehicle!.id, driver!.id],
  );
  await pool.query(`INSERT INTO pool_status_history (pool_id, from_status, to_status) VALUES ($1, NULL, 'OPEN')`, [
    poolRow!.id,
  ]);
  const {
    rows: [existingPassenger],
  } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Rafiq', 'naive-existing@dhakateslapool.test', 'x', 'PASSENGER') RETURNING id`,
  );
  const {
    rows: [existingRequest],
  } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method, status, matched_at)
     VALUES ($1, 'BANANI', 'MOHAKHALI', 2, 25, 6750, 5400, 'CASH', 'MATCHED', now()) RETURNING id`,
    [existingPassenger!.id],
  );
  await pool.query(`INSERT INTO pool_memberships (pool_id, ride_request_id, seats) VALUES ($1, $2, 2)`, [
    poolRow!.id,
    existingRequest!.id,
  ]);

  async function insertContender(name: string): Promise<string> {
    const {
      rows: [passenger],
    } = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', 'PASSENGER') RETURNING id`,
      [name, `naive-${name.toLowerCase()}@dhakateslapool.test`],
    );
    const {
      rows: [request],
    } = await pool.query<{ id: string }>(
      `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method, status)
       VALUES ($1, 'BANANI', 'MOHAKHALI', 1, 25, 6750, 5400, 'CASH', 'REQUESTED') RETURNING id`,
      [passenger!.id],
    );
    return request!.id;
  }

  const requestAId = await insertContender("Nusrat");
  const requestBId = await insertContender("Shirin");

  return { poolId: poolRow!.id, requestAId, requestBId };
}

describe("naive join control (plan §16.5 — proving the harness isn't vacuous)", () => {
  it("catches the naive, unlocked join with overbooking evidence or a CHECK violation", async () => {
    let caught = false;

    for (let i = 0; i < 20 && !caught; i++) {
      const { poolId, requestAId, requestBId } = await seedLastSeatScenario();

      const [a, b] = await Promise.all([
        naiveJoinPool(pool, { poolId, rideRequestId: requestAId, seats: 1 }),
        naiveJoinPool(pool, { poolId, rideRequestId: requestBId, seats: 1 }),
      ]);

      const anyCheckViolation = [a, b].some((r) => r.errorCode === "23514");
      const violations = await assertInvariants(pool);

      if (anyCheckViolation || violations.length > 0) {
        caught = true;
      }

      await truncateAll(pool);
    }

    expect(caught).toBe(true);
  }, 30_000);
});
