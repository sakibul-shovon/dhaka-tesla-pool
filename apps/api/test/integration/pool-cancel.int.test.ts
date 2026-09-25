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

async function onlineDriver(name = "Jashim", zone = "BANANI") {
  return driverContext(pool, db, name, { name: "Bullet", capacity: 3, isOnline: true, currentZone: zone });
}

describe("no-show", () => {
  it("rejects marking a no-show before the driver has arrived", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, rideId);
    const poolId = accepted.body.data.pool.id as string;
    const membershipId = accepted.body.data.membershipId as string;

    const res = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/memberships/${membershipId}/no-show`)
      .set("Cookie", jashim.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("releases the seat and auto-cancels an emptied pool", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, rideId);
    const poolId = accepted.body.data.pool.id as string;
    const membershipId = accepted.body.data.membershipId as string;
    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);

    const res = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/memberships/${membershipId}/no-show`)
      .set("Cookie", jashim.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
    expect(res.body.data.seatsReserved).toBe(0);

    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM ride_requests WHERE id = $1`, [rideId]);
    expect(rows[0]!.status).toBe("CANCELLED");
  });

  it("keeps the pool DRIVER_ARRIVED when one of two members no-shows", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const nusratRide = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const rafiqRide = await insertRideRequest(rafiq.userId, "BANANI", "GULSHAN_1");
    const nusratAccepted = await accept(app, jashim.cookie, nusratRide);
    await accept(app, jashim.cookie, rafiqRide);
    const poolId = nusratAccepted.body.data.pool.id as string;
    const nusratMembershipId = nusratAccepted.body.data.membershipId as string;
    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);

    const res = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/memberships/${nusratMembershipId}/no-show`)
      .set("Cookie", jashim.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("DRIVER_ARRIVED");
    expect(res.body.data.seatsReserved).toBe(1);

    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM ride_requests WHERE id = $1`, [
      rafiqRide,
    ]);
    // The earlier pool-wide `arrive` already moved Rafiq to DRIVER_ARRIVED
    // too (plan §9.1: arrive cascades to every unreleased member) — Nusrat's
    // no-show doesn't touch him.
    expect(rows[0]!.status).toBe("DRIVER_ARRIVED");
  });
});

describe("driver cancels the pool", () => {
  it("cancels every unreleased member's ride and resets the pool", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver();
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const nusratRide = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const rafiqRide = await insertRideRequest(rafiq.userId, "BANANI", "GULSHAN_1");
    const accepted = await accept(app, jashim.cookie, nusratRide);
    await accept(app, jashim.cookie, rafiqRide);
    const poolId = accepted.body.data.pool.id as string;

    const res = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/cancel`)
      .set("Cookie", jashim.cookie)
      .send({ reason: "vehicle breakdown" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
    expect(res.body.data.seatsReserved).toBe(0);

    const { rows } = await pool.query<{ status: string; cancel_reason: string }>(
      `SELECT status, cancel_reason FROM ride_requests WHERE id IN ($1, $2)`,
      [nusratRide, rafiqRide],
    );
    for (const row of rows) {
      expect(row.status).toBe("CANCELLED");
      expect(row.cancel_reason).toBe("vehicle breakdown");
    }
  });

  it("Monir cannot cancel Jashim's pool (404)", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await onlineDriver("Jashim");
    const monir = await onlineDriver("Monir", "MOHAKHALI");
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, rideId);
    const poolId = accepted.body.data.pool.id as string;

    const res = await request(app).post(`/api/v1/driver/pools/${poolId}/cancel`).set("Cookie", monir.cookie).send({});
    expect(res.status).toBe(404);
  });
});
