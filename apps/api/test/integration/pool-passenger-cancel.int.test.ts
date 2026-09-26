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

function cancel(app: App, cookie: string, rideRequestId: string) {
  return request(app)
    .post(`/api/v1/ride-requests/${rideRequestId}/cancel`)
    .set("Cookie", cookie)
    .set("Idempotency-Key", randomUUID())
    .send({});
}

async function onlineDriver(name = "Jashim", zone = "BANANI") {
  return driverContext(pool, db, name, { name: "Bullet", capacity: 3, isOnline: true, currentZone: zone });
}

describe("passenger cancels a matched ride", () => {
  it("releases the seat and auto-cancels the pool when Nusrat was the only member", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, rideId);
    const poolId = accepted.body.data.pool.id as string;

    const res = await cancel(app, nusrat.cookie, rideId);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");

    const { rows } = await pool.query<{ status: string; seats_reserved: number }>(
      `SELECT status, seats_reserved FROM pools WHERE id = $1`,
      [poolId],
    );
    expect(rows[0]).toMatchObject({ status: "CANCELLED", seats_reserved: 0 });
  });

  it("keeps the pool open and only releases Rafiq's seat when Nusrat stays", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const nusratRide = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const rafiqRide = await insertRideRequest(rafiq.userId, "BANANI", "GULSHAN_1");
    const accepted = await accept(app, jashim.cookie, nusratRide);
    await accept(app, jashim.cookie, rafiqRide);
    const poolId = accepted.body.data.pool.id as string;

    const res = await cancel(app, rafiq.cookie, rafiqRide);
    expect(res.status).toBe(200);

    const { rows } = await pool.query<{ status: string; seats_reserved: number }>(
      `SELECT status, seats_reserved FROM pools WHERE id = $1`,
      [poolId],
    );
    expect(rows[0]).toMatchObject({ status: "OPEN", seats_reserved: 1 });

    const nusratStatus = await pool.query<{ status: string }>(`SELECT status FROM ride_requests WHERE id = $1`, [
      nusratRide,
    ]);
    expect(nusratStatus.rows[0]!.status).toBe("MATCHED");
  });

  it("still cascades after the driver has arrived (DRIVER_ARRIVED)", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, rideId);
    const poolId = accepted.body.data.pool.id as string;
    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);

    const res = await cancel(app, nusrat.cookie, rideId);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");

    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM pools WHERE id = $1`, [poolId]);
    expect(rows[0]!.status).toBe("CANCELLED");
  });

  it("still forbids cancelling once the pool has STARTED", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, rideId);
    const poolId = accepted.body.data.pool.id as string;
    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set("Cookie", jashim.cookie);

    const res = await cancel(app, nusrat.cookie, rideId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CANCELLATION_NOT_ALLOWED");

    // Untouched: the pool lock taken to check for a cascade must not have
    // left any side effect when the cancellation itself was rejected.
    const { rows } = await pool.query<{ seats_reserved: number }>(`SELECT seats_reserved FROM pools WHERE id = $1`, [
      poolId,
    ]);
    expect(rows[0]!.seats_reserved).toBe(1);
  });
});
