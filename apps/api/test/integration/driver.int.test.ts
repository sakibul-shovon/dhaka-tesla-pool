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
import { createSession, SESSION_COOKIE_NAME } from "../../src/modules/auth/session-service.js";

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

async function insertRideRequest(passengerId: string, pickupZone: string, dropoffZone = "MOHAKHALI"): Promise<string> {
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method)
     VALUES ($1, $2, $3, 1, 25, 6750, 5400, 'CASH') RETURNING id`,
    [passengerId, pickupZone, dropoffZone],
  );
  return row!.id;
}

describe("GET /driver/status", () => {
  it("returns the driver's vehicle with no active pool", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db);

    const res = await request(app).get("/api/v1/driver/status").set("Cookie", jashim.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "Bullet", capacity: 3, isOnline: false, activePoolId: null });
  });

  it("404s a driver with no vehicle", async () => {
    const app = buildTestApp(pool, logger);
    const {
      rows: [row],
    } = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('No Vehicle', $1, 'x', 'DRIVER') RETURNING id`,
      [`${randomUUID()}@dhakateslapool.test`],
    );
    const { token } = await createSession(db, row!.id, 1);

    const res = await request(app).get("/api/v1/driver/status").set("Cookie", `${SESSION_COOKIE_NAME}=${token}`);
    expect(res.status).toBe(404);
  });

  it("rejects a passenger calling a driver endpoint", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db);

    const res = await request(app).get("/api/v1/driver/status").set("Cookie", nusrat.cookie);
    expect(res.status).toBe(403);
  });
});

describe("POST /driver/go-online and /go-offline", () => {
  it("goes online with a zone, then back offline", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db);

    const online = await request(app)
      .post("/api/v1/driver/go-online")
      .set("Cookie", jashim.cookie)
      .send({ zone: "BANANI" });
    expect(online.status).toBe(200);
    expect(online.body.data).toMatchObject({ isOnline: true, currentZone: "BANANI" });

    const offline = await request(app).post("/api/v1/driver/go-offline").set("Cookie", jashim.cookie);
    expect(offline.status).toBe(200);
    expect(offline.body.data.isOnline).toBe(false);
  });

  it("rejects going offline while a pool is active", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    await pool.query(
      `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot, seats_reserved) VALUES ($1, $2, 'BANANI', 3, 0)`,
      [jashim.vehicleId, jashim.userId],
    );

    const res = await request(app).post("/api/v1/driver/go-offline").set("Cookie", jashim.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DRIVER_HAS_ACTIVE_POOL");
  });
});

describe("GET /driver/requests", () => {
  it("rejects when the driver is offline", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db);

    const res = await request(app).get("/api/v1/driver/requests").set("Cookie", jashim.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DRIVER_OFFLINE");
  });

  it("lists only REQUESTED rides in the driver's current zone", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const shirin = await passengerContext(pool, db, "Shirin");
    await insertRideRequest(nusrat.userId, "BANANI", "MOHAKHALI");
    await insertRideRequest(shirin.userId, "MOHAKHALI", "GULSHAN_1"); // different pickup zone

    const res = await request(app).get("/api/v1/driver/requests").set("Cookie", jashim.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].pickupZone).toBe("BANANI");
  });
});
