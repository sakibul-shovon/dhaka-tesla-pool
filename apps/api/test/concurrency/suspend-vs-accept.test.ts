import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { buildTestApp } from "../support/build-test-app.js";
import { createDb, type Db } from "../../src/db/client.js";
import { adminContext, driverContext, passengerContext } from "../support/auth-fixtures.js";
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

function suspend(app: App, cookie: string, userId: string) {
  return request(app).post(`/api/v1/admin/users/${userId}/suspend`).set("Cookie", cookie).send({});
}

// C-series style (plan §10.6), for ADR-019: an admin suspending a driver
// races the driver accepting a request, both ultimately contending for the
// same vehicle row (plan §10.2 puts vehicle before user in the lock order,
// precisely so this has a well-defined winner instead of two half-applied
// writes). Three interleavings are all "safe" and all actually happen across
// enough iterations: accept locks the vehicle first and creates a pool, so
// suspend then sees an active pool and is refused; suspend locks the vehicle
// first, takes it offline, and accept's own re-check of is_online then
// refuses it; or suspend's session revocation lands before accept's own
// authenticate() middleware runs, so accept never reaches the handler at
// all. What must never happen, in any interleaving, is a suspended driver
// left holding an active pool.
describe("suspend vs accept (ADR-019)", () => {
  it("never leaves a suspended driver holding an active pool, 40 iterations", async () => {
    for (let i = 0; i < 40; i++) {
      const app = buildTestApp(pool, logger);
      const admin = await adminContext(pool, db);
      const jashim = await driverContext(pool, db, "Jashim", {
        name: "Bullet",
        capacity: 3,
        isOnline: true,
        currentZone: "BANANI",
      });
      const nusrat = await passengerContext(pool, db, "Nusrat");
      const rideId = (await createRide(app, nusrat.cookie)).body.data.id as string;

      const [acceptRes, suspendRes] = await Promise.all([
        accept(app, jashim.cookie, rideId),
        suspend(app, admin.cookie, jashim.userId),
      ]);

      if (acceptRes.status === 200) {
        // Accept won the vehicle lock first: a pool now exists, so suspend's
        // own check of it must refuse.
        expect(suspendRes.status).toBe(409);
        expect(suspendRes.body.error.code).toBe("DRIVER_HAS_ACTIVE_POOL");
      } else if (suspendRes.status === 200) {
        // Suspend won: accept either never got past authentication (session
        // already revoked) or reached the handler and found the vehicle
        // offline under the same lock suspend just released.
        expect([401, 409]).toContain(acceptRes.status);
        if (acceptRes.status === 409) {
          expect(acceptRes.body.error.code).toBe("DRIVER_OFFLINE");
        }
      } else {
        throw new Error(
          `Neither side succeeded: accept=${acceptRes.status} ${JSON.stringify(acceptRes.body)}, ` +
            `suspend=${suspendRes.status} ${JSON.stringify(suspendRes.body)}`,
        );
      }

      const { rows: driverRows } = await pool.query<{ status: string }>(
        `SELECT status FROM users WHERE id = $1`,
        [jashim.userId],
      );
      const { rows: poolRows } = await pool.query<{ status: string }>(
        `SELECT status FROM pools WHERE vehicle_id = $1`,
        [jashim.vehicleId],
      );
      if (driverRows[0]!.status === "SUSPENDED") {
        const hasActivePool = poolRows.some((row) =>
          ["OPEN", "DRIVER_ARRIVED", "STARTED"].includes(row.status),
        );
        expect(hasActivePool).toBe(false);
      }

      expect(await assertInvariants(pool)).toEqual([]);
      await truncateAll(pool);
    }
  }, 120_000);
});
