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

async function insertRideRequest(passengerId: string, pickupZone: string, dropoffZone: string, seats = 1): Promise<string> {
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method)
     VALUES ($1, $2, $3, $4, 25, 6750, 5400, 'CASH') RETURNING id`,
    [passengerId, pickupZone, dropoffZone, seats],
  );
  return row!.id;
}

function accept(app: ReturnType<typeof buildTestApp>, cookie: string, rideRequestId: string, key = randomUUID()) {
  return request(app)
    .post(`/api/v1/driver/requests/${rideRequestId}/accept`)
    .set("Cookie", cookie)
    .set("Idempotency-Key", key)
    .send({});
}

describe("POST /driver/requests/:id/accept", () => {
  it("creates a pool on the first accept", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");

    const res = await accept(app, jashim.cookie, rideId);

    expect(res.status).toBe(200);
    expect(res.body.data.pool).toMatchObject({ status: "OPEN", seatsReserved: 1, pickupZone: "BANANI" });

    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM ride_requests WHERE id = $1`, [rideId]);
    expect(rows[0]!.status).toBe("MATCHED");
  });

  it("extends the same pool for a second, compatible passenger", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const nusratRide = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const rafiqRide = await insertRideRequest(rafiq.userId, "BANANI", "GULSHAN_1");

    const first = await accept(app, jashim.cookie, nusratRide);
    const second = await accept(app, jashim.cookie, rafiqRide);

    expect(second.status).toBe(200);
    expect(second.body.data.pool.id).toBe(first.body.data.pool.id);
    expect(second.body.data.pool.seatsReserved).toBe(2);
  });

  it("rejects a request outside the vehicle's current zone", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "MOHAKHALI", "GULSHAN_1");

    const res = await accept(app, jashim.cookie, rideId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ZONE_MISMATCH");
  });

  it("rejects accepting while offline", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db); // offline by default
    const nusrat = await passengerContext(pool, db);
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");

    const res = await accept(app, jashim.cookie, rideId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DRIVER_OFFLINE");
  });

  it("rejects once the vehicle's capacity is full", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 1,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const nusratRide = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const rafiqRide = await insertRideRequest(rafiq.userId, "BANANI", "GULSHAN_1");

    await accept(app, jashim.cookie, nusratRide);
    const res = await accept(app, jashim.cookie, rafiqRide);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("POOL_CAPACITY_EXCEEDED");
  });

  it("replays the same response for a repeated idempotency key", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    const key = randomUUID();

    const first = await accept(app, jashim.cookie, rideId, key);
    const second = await accept(app, jashim.cookie, rideId, key);

    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(second.headers["idempotent-replayed"]).toBe("true");

    const { rows } = await pool.query(`SELECT * FROM pool_memberships`);
    expect(rows).toHaveLength(1);
  });

  it("404s a ride request that doesn't exist", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });

    const res = await accept(app, jashim.cookie, randomUUID());
    expect(res.status).toBe(404);
  });
});
