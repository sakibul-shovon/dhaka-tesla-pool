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
  pool = createTestPool({ max: 10 });
  db = createDb(pool);
});

afterEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

type App = ReturnType<typeof buildTestApp>;

function createRide(app: App, cookie: string) {
  return request(app)
    .post("/api/v1/ride-requests")
    .set("Cookie", cookie)
    .set("Idempotency-Key", randomUUID())
    .send({ pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1, paymentMethod: "CASH" });
}

function accept(app: App, cookie: string, rideRequestId: string) {
  return request(app)
    .post(`/api/v1/driver/requests/${rideRequestId}/accept`)
    .set("Cookie", cookie)
    .set("Idempotency-Key", randomUUID())
    .send({});
}

function cancel(app: App, cookie: string, rideRequestId: string) {
  return request(app)
    .post(`/api/v1/ride-requests/${rideRequestId}/cancel`)
    .set("Cookie", cookie)
    .set("Idempotency-Key", randomUUID())
    .send({});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A passenger cancels a still-REQUESTED ride at the same instant a driver
// accepts it. The cancel handler's unlocked "does this ride already have a
// membership" read can see "no" a moment before the accept commits one — if
// the accept then wins the ride_request's own row lock, the cancel's cleanup
// code is still holding that stale "no membership" answer and never releases
// the membership the accept just created. The membership becomes a "ghost":
// unreleased, but pointing at a ride_request that is now CANCELLED.
describe("accept vs cancel on an unmatched ride", () => {
  it("never leaves a released ride with an unreleased membership pointing at it (30 iterations)", async () => {
    for (let i = 0; i < 30; i++) {
      const app = buildTestApp(pool, logger);
      const jashim = await driverContext(pool, db, "Jashim", {
        name: "Bullet",
        capacity: 3,
        isOnline: true,
        currentZone: "BANANI",
      });
      const nusrat = await passengerContext(pool, db, "Nusrat");
      const created = await createRide(app, nusrat.cookie);
      const rideId = created.body.data.id as string;

      // Accept has more work to do before it ever touches the ride_request
      // row (lock the vehicle, lock/create the pool) than cancel does before
      // its own first touch (a single unlocked SELECT) — firing accept
      // first evens the race for the ride_request row lock itself, instead
      // of cancel winning it by default every time.
      const acceptPromise = accept(app, jashim.cookie, rideId);
      await sleep(1);
      const cancelPromise = cancel(app, nusrat.cookie, rideId);
      await Promise.all([acceptPromise, cancelPromise]);

      const { rows } = await pool.query<{
        released_at: Date | null;
        ride_status: string;
      }>(
        `SELECT m.released_at, r.status AS ride_status
         FROM pool_memberships m
         JOIN ride_requests r ON r.id = m.ride_request_id
         WHERE m.ride_request_id = $1`,
        [rideId],
      );

      const ghost = rows.some((r) => r.released_at === null && r.ride_status === "CANCELLED");

      // Checked directly (not just via assertInvariants) so this test is
      // self-contained proof of the exact failure mode, independent of
      // whether the invariant checker's own coverage of it stays correct.
      expect(ghost).toBe(false);
      expect(await assertInvariants(pool)).toEqual([]);

      await truncateAll(pool);
    }
  }, 60_000);
});
