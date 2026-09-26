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

// C4 (plan §10.6): the driver starts the trip while a passenger cancels, both
// racing for the same pool row. Both handlers lock the pool first (plan
// §10.2, §10.4), so whichever gets there first runs to completion before the
// other even reads the current state — there is no window where they can
// both partially apply.
describe("C4 — start vs cancel (plan §10.6)", () => {
  it("either cancel wins (start proceeds with the remaining rider) or start wins (cancel is rejected) — never both, 50 iterations", async () => {
    for (let i = 0; i < 50; i++) {
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
      await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);

      const [startRes, cancelRes] = await Promise.all([
        request(app).post(`/api/v1/driver/pools/${poolId}/start`).set("Cookie", jashim.cookie),
        cancel(app, nusrat.cookie, nusratRide),
      ]);

      if (cancelRes.status === 200) {
        // Cancel won the pool lock: Nusrat is released before start reads
        // the member list, so start proceeds with just Rafiq aboard.
        expect(startRes.status).toBe(200);
        const {
          rows: [nusratRow],
        } = await pool.query<{ status: string }>(`SELECT status FROM ride_requests WHERE id = $1`, [nusratRide]);
        expect(nusratRow!.status).toBe("CANCELLED");
        const {
          rows: [rafiqRow],
        } = await pool.query<{ status: string }>(`SELECT status FROM ride_requests WHERE id = $1`, [rafiqRide]);
        expect(rafiqRow!.status).toBe("STARTED");
      } else {
        // Start won the pool lock: by the time cancel re-reads Nusrat's
        // request under lock, it's already STARTED.
        expect(startRes.status).toBe(200);
        expect(cancelRes.status).toBe(409);
        expect(cancelRes.body.error.code).toBe("CANCELLATION_NOT_ALLOWED");
        const {
          rows: [nusratRow],
        } = await pool.query<{ status: string }>(`SELECT status FROM ride_requests WHERE id = $1`, [nusratRide]);
        expect(nusratRow!.status).toBe("STARTED");
      }

      expect(await assertInvariants(pool)).toEqual([]);
      await truncateAll(pool);
    }
  }, 120_000);
});
