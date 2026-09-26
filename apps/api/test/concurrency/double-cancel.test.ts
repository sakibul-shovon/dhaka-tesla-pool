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

function createRide(app: App, cookie: string, dropoffZone: string) {
  return request(app)
    .post("/api/v1/ride-requests")
    .set("Cookie", cookie)
    .set("Idempotency-Key", randomUUID())
    .send({ pickupZone: "BANANI", dropoffZone, seats: 1, paymentMethod: "CASH" });
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

// C10 (plan §10.6): both of a pool's two members cancel at the same instant.
// Both cancels lock the pool first, so they serialize — whichever commits
// second sees the first's release already applied and correctly finds the
// pool empty, auto-cancelling it exactly once.
describe("C10 — two passengers cancel simultaneously (plan §10.6)", () => {
  it("both cancels succeed, seats decrement exactly twice, and the pool auto-cancels exactly once (20 iterations)", async () => {
    for (let i = 0; i < 20; i++) {
      const app = buildTestApp(pool, logger);
      const jashim = await driverContext(pool, db, "Jashim", {
        name: "Bullet",
        capacity: 3,
        isOnline: true,
        currentZone: "BANANI",
      });
      const nusrat = await passengerContext(pool, db, "Nusrat");
      const rafiq = await passengerContext(pool, db, "Rafiq");

      const nusratRide = (await createRide(app, nusrat.cookie, "MOHAKHALI")).body.data.id as string;
      const rafiqRide = (await createRide(app, rafiq.cookie, "GULSHAN_1")).body.data.id as string;
      const accepted = await accept(app, jashim.cookie, nusratRide);
      const poolId = accepted.body.data.pool.id as string;
      await accept(app, jashim.cookie, rafiqRide);

      const [resA, resB] = await Promise.all([
        cancel(app, nusrat.cookie, nusratRide),
        cancel(app, rafiq.cookie, rafiqRide),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const {
        rows: [poolRow],
      } = await pool.query<{ status: string; seats_reserved: number }>(
        `SELECT status, seats_reserved FROM pools WHERE id = $1`,
        [poolId],
      );
      expect(poolRow!.seats_reserved).toBe(0);
      expect(poolRow!.status).toBe("CANCELLED");

      const { rows: cancelHistory } = await pool.query(
        `SELECT id FROM pool_status_history WHERE pool_id = $1 AND to_status = 'CANCELLED'`,
        [poolId],
      );
      expect(cancelHistory).toHaveLength(1);

      expect(await assertInvariants(pool)).toEqual([]);
      await truncateAll(pool);
    }
  }, 60_000);
});
