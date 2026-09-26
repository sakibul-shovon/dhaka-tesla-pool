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
import { manhattanDistanceDkm } from "../../src/domain/geography.js";
import { computeFare } from "../../src/domain/fare.js";

let pool: Pool;
let db: Db;
const logger = pino({ level: "silent" });

beforeAll(() => {
  pool = createTestPool();
  db = createDb(pool);
});

afterEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

type App = ReturnType<typeof buildTestApp>;

// Real fare per zone pair (not a hardcoded value repeated for every trip) —
// Rafiq's Banani->Gulshan 1 trip must not silently get Nusrat's numbers.
async function insertRideRequest(passengerId: string, pickupZone: string, dropoffZone: string): Promise<string> {
  const distanceDkm = manhattanDistanceDkm(pickupZone, dropoffZone);
  const fare = computeFare(distanceDkm, 1);
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method)
     VALUES ($1, $2, $3, 1, $4, $5, $6, 'CASH') RETURNING id`,
    [passengerId, pickupZone, dropoffZone, distanceDkm, fare.soloFarePaisa, fare.pooledFarePaisa],
  );
  return row!.id;
}

function accept(app: App, cookie: string, rideRequestId: string) {
  return request(app)
    .post(`/api/v1/driver/requests/${rideRequestId}/accept`)
    .set("Cookie", cookie)
    .set("Idempotency-Key", randomUUID())
    .send({});
}

async function onlineDriver(name = "Jashim", zone = "BANANI") {
  return driverContext(pool, db, name, { name: "Bullet", capacity: 3, isOnline: true, currentZone: zone });
}

describe("single-passenger pool lifecycle (plan: Nusrat -> Jashim accepts -> arrive -> start -> drop-off)", () => {
  it("goes REQUESTED -> MATCHED -> DRIVER_ARRIVED -> STARTED -> COMPLETED with full history", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    // Created through the real endpoint (not the raw-SQL helper) so the
    // REQUESTED history row exists too — this test proves the *whole*
    // plan-mandated flow, not just the pool half of it.
    const created = await request(app)
      .post("/api/v1/ride-requests")
      .set("Cookie", nusrat.cookie)
      .set("Idempotency-Key", randomUUID())
      .send({ pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1, paymentMethod: "CASH" });
    expect(created.status).toBe(201);
    const rideId = created.body.data.id as string;

    const accepted = await accept(app, jashim.cookie, rideId);
    expect(accepted.status).toBe(200);
    const poolId = accepted.body.data.pool.id as string;

    const arrived = await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);
    expect(arrived.status).toBe(200);
    expect(arrived.body.data.status).toBe("DRIVER_ARRIVED");

    const started = await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set("Cookie", jashim.cookie);
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe("STARTED");

    const activeAfterStart = await request(app).get(`/api/v1/driver/pools/${poolId}`).set("Cookie", jashim.cookie);
    const membershipId = activeAfterStart.body.data.members[0].membershipId as string;
    // solo (only member in the pool) -> full solo fare, not the pooled discount
    expect(activeAfterStart.body.data.members[0].finalFarePaisa).toBe(6750);
    expect(activeAfterStart.body.data.members[0].sharedRide).toBe(false);

    const droppedOff = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/memberships/${membershipId}/drop-off`)
      .set("Cookie", jashim.cookie);
    expect(droppedOff.status).toBe(200);
    expect(droppedOff.body.data.status).toBe("COMPLETED");

    const { rows: rideRows } = await pool.query<{ status: string }>(`SELECT status FROM ride_requests WHERE id = $1`, [
      rideId,
    ]);
    expect(rideRows[0]!.status).toBe("COMPLETED");

    const rideHistory = await pool.query(`SELECT to_status FROM ride_status_history WHERE ride_request_id = $1 ORDER BY created_at`, [
      rideId,
    ]);
    expect(rideHistory.rows.map((r: { to_status: string }) => r.to_status)).toEqual([
      "REQUESTED",
      "MATCHED",
      "DRIVER_ARRIVED",
      "STARTED",
      "COMPLETED",
    ]);

    const poolHistory = await request(app).get(`/api/v1/driver/pools/${poolId}/history`).set("Cookie", jashim.cookie);
    expect(poolHistory.body.data.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      "OPEN",
      "DRIVER_ARRIVED",
      "STARTED",
      "COMPLETED",
    ]);
  });
});

describe("pooled fares fixed at start", () => {
  it("gives both Nusrat and Rafiq the pooled fare once they share Bullet", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const nusratRide = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const rafiqRide = await insertRideRequest(rafiq.userId, "BANANI", "GULSHAN_1");

    const accepted = await accept(app, jashim.cookie, nusratRide);
    await accept(app, jashim.cookie, rafiqRide);
    const poolId = accepted.body.data.pool.id as string;

    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set("Cookie", jashim.cookie);

    const view = await request(app).get(`/api/v1/driver/pools/${poolId}`).set("Cookie", jashim.cookie);
    const fares = view.body.data.members.map((m: { finalFarePaisa: number; sharedRide: boolean }) => m.finalFarePaisa).sort(
      (a: number, b: number) => a - b,
    );
    expect(fares).toEqual([5400, 6000]); // Nusrat 67.50 -> 54.00 pooled, Rafiq 75.00 -> 60.00 pooled
    expect(view.body.data.members.every((m: { sharedRide: boolean }) => m.sharedRide)).toBe(true);
  });
});

describe("C7 — arrive/start order enforced", () => {
  it("rejects starting before the driver has arrived", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, rideId);
    const poolId = accepted.body.data.pool.id as string;

    const res = await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set("Cookie", jashim.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("rejects arriving at a pool with no members (POOL_EMPTY)", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const {
      rows: [poolRow],
    } = await pool.query<{ id: string }>(
      `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot) VALUES ($1, $2, 'BANANI', 3) RETURNING id`,
      [jashim.vehicleId, jashim.userId],
    );

    const res = await request(app).post(`/api/v1/driver/pools/${poolRow!.id}/arrive`).set("Cookie", jashim.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("POOL_EMPTY");
  });
});

describe("C8 — drop-off order enforced", () => {
  it("rejects a drop-off before the pool has started", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, rideId);
    const poolId = accepted.body.data.pool.id as string;
    const membershipId = accepted.body.data.membershipId as string;
    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);

    const res = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/memberships/${membershipId}/drop-off`)
      .set("Cookie", jashim.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("rejects dropping the same passenger off twice", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, rideId);
    const poolId = accepted.body.data.pool.id as string;
    const membershipId = accepted.body.data.membershipId as string;
    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set("Cookie", jashim.cookie);
    await request(app)
      .post(`/api/v1/driver/pools/${poolId}/memberships/${membershipId}/drop-off`)
      .set("Cookie", jashim.cookie);

    // Membership row still exists (releasedAt is null — a completed member
    // was never "released"), so the ride's own state machine is what
    // rejects this: dropOff isn't a legal command from COMPLETED (plan §12.2's
    // 409 INVALID_TRANSITION for "drop-off twice", C8).
    const res = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/memberships/${membershipId}/drop-off`)
      .set("Cookie", jashim.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });
});

describe("ownership and role checks", () => {
  it("Monir cannot arrive at Jashim's pool (404)", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver("Jashim");
    const monir = await onlineDriver("Monir", "MOHAKHALI");
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, rideId);
    const poolId = accepted.body.data.pool.id as string;

    const res = await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", monir.cookie);
    expect(res.status).toBe(404);
  });

  it("rejects a passenger calling a pool endpoint", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db, "Nusrat");

    const res = await request(app).get(`/api/v1/driver/pools/active`).set("Cookie", nusrat.cookie);
    expect(res.status).toBe(403);
  });
});
