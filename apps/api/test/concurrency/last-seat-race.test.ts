import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { buildTestApp } from "../support/build-test-app.js";
import { createDb, type Db } from "../../src/db/client.js";
import { driverContext, passengerContext } from "../support/auth-fixtures.js";
import { assertInvariants } from "../support/assert-invariants.js";

let pool: Pool;
let db: Db;
const logger = pino({ level: "silent" });

beforeAll(() => {
  // pg pool >= N + 2 (plan §16.1) so the 10-way variant's contenders never
  // queue behind each other for a connection before they even reach Postgres.
  pool = createTestPool({ max: 15 });
  db = createDb(pool);
});

afterEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

type App = ReturnType<typeof buildTestApp>;

// Mirrors what POST /ride-requests actually writes (fare snapshot + the
// REQUESTED creation history row) so these raw-SQL fixtures satisfy I14
// exactly like a request created through the real endpoint would.
async function insertRideRequest(passengerId: string): Promise<string> {
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method)
     VALUES ($1, 'BANANI', 'MOHAKHALI', 1, 25, 6750, 5400, 'CASH') RETURNING id`,
    [passengerId],
  );
  await pool.query(
    `INSERT INTO ride_status_history (ride_request_id, from_status, to_status) VALUES ($1, NULL, 'REQUESTED')`,
    [row!.id],
  );
  return row!.id;
}

// The real vehicle capacity is capped at 6 (`vehicles_capacity_range`), but
// `pools.capacity_snapshot` has no such upper bound once it's just a plain
// snapshot column — set it higher directly to drive the 10-way variant.
async function seedOpenPool(capacitySnapshot: number, seatsReserved: number): Promise<string> {
  const jashim = await driverContext(pool, db, "Jashim", {
    name: "Bullet",
    capacity: Math.min(capacitySnapshot, 6),
    isOnline: true,
    currentZone: "BANANI",
  });
  const {
    rows: [poolRow],
  } = await pool.query<{ id: string }>(
    `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot, seats_reserved) VALUES ($1, $2, 'BANANI', $3, $4) RETURNING id`,
    [jashim.vehicleId, jashim.userId, capacitySnapshot, seatsReserved],
  );
  await pool.query(`INSERT INTO pool_status_history (pool_id, from_status, to_status) VALUES ($1, NULL, 'OPEN')`, [
    poolRow!.id,
  ]);
  // One 1-seat filler membership per reserved seat (`ride_requests_seats_range`
  // caps a single request at 6 seats, which the 9-capacity variant would exceed).
  for (let seat = 0; seat < seatsReserved; seat++) {
    const filler = await passengerContext(pool, db, `Filler${seat}`);
    const fillerRequest = await insertRideRequest(filler.userId);
    await pool.query(`UPDATE ride_requests SET status = 'MATCHED', matched_at = now() WHERE id = $1`, [
      fillerRequest,
    ]);
    await pool.query(
      `INSERT INTO ride_status_history (ride_request_id, from_status, to_status) VALUES ($1, 'REQUESTED', 'MATCHED')`,
      [fillerRequest],
    );
    await pool.query(`INSERT INTO pool_memberships (pool_id, ride_request_id, seats) VALUES ($1, $2, 1)`, [
      poolRow!.id,
      fillerRequest,
    ]);
  }
  return poolRow!.id;
}

function join(app: App, cookie: string, poolId: string, rideRequestId: string) {
  return request(app)
    .post(`/api/v1/pools/${poolId}/join`)
    .set("Cookie", cookie)
    .set("Idempotency-Key", randomUUID())
    .send({ rideRequestId });
}

// C1 (plan §10.5, §10.6): the PRD's own race — Nusrat and Shirin, one seat
// left in Bullet. Under READ COMMITTED, the loser's `SELECT ... FOR UPDATE`
// blocks until the winner commits, then re-reads the committed row and
// correctly sees no capacity left (plan §10.5) — this is what these
// iterations exist to prove empirically, not just narrate.
describe("C1 — last-seat race (plan §10.5, §10.6)", () => {
  it("exactly one of two concurrent joins for the last seat wins (20 iterations)", async () => {
    for (let i = 0; i < 20; i++) {
      const app = buildTestApp(pool, logger);
      const poolId = await seedOpenPool(3, 2);
      const nusrat = await passengerContext(pool, db, "Nusrat");
      const shirin = await passengerContext(pool, db, "Shirin");
      const nusratRide = await insertRideRequest(nusrat.userId);
      const shirinRide = await insertRideRequest(shirin.userId);

      const [a, b] = await Promise.all([
        join(app, nusrat.cookie, poolId, nusratRide),
        join(app, shirin.cookie, poolId, shirinRide),
      ]);

      const statuses = [a.status, b.status].sort((x, y) => x - y);
      expect(statuses).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.error.code).toBe("POOL_CAPACITY_EXCEEDED");

      const {
        rows: [poolRow],
      } = await pool.query<{ seats_reserved: number }>(`SELECT seats_reserved FROM pools WHERE id = $1`, [poolId]);
      expect(poolRow!.seats_reserved).toBe(3);
      expect(await assertInvariants(pool)).toEqual([]);

      await truncateAll(pool);
    }
  }, 60_000);

  it("exactly one of ten concurrent joins for the last seat wins", async () => {
    for (let i = 0; i < 5; i++) {
      const app = buildTestApp(pool, logger);
      const poolId = await seedOpenPool(9, 8);
      const contenders = await Promise.all(
        Array.from({ length: 10 }, (_, idx) => passengerContext(pool, db, `Contender${idx}`)),
      );
      const rides = await Promise.all(contenders.map((c) => insertRideRequest(c.userId)));

      const responses = await Promise.all(contenders.map((c, idx) => join(app, c.cookie, poolId, rides[idx]!)));

      const winners = responses.filter((r) => r.status === 200);
      const losers = responses.filter((r) => r.status === 409);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(9);
      expect(losers.every((r) => r.body.error.code === "POOL_CAPACITY_EXCEEDED")).toBe(true);

      const {
        rows: [poolRow],
      } = await pool.query<{ seats_reserved: number }>(`SELECT seats_reserved FROM pools WHERE id = $1`, [poolId]);
      expect(poolRow!.seats_reserved).toBe(9);
      expect(await assertInvariants(pool)).toEqual([]);

      await truncateAll(pool);
    }
  }, 60_000);
});
