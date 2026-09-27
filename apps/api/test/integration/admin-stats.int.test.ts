import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { buildTestApp } from "../support/build-test-app.js";
import { createDb, type Db } from "../../src/db/client.js";
import { adminContext, driverContext, passengerContext } from "../support/auth-fixtures.js";

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

async function insertRideRequest(
  passengerId: string,
  status: string,
  pickupZone = "BANANI",
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests
       (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method, status)
     VALUES ($1, $2, 'MOHAKHALI', 1, 25, 6750, 5400, 'CASH', $3) RETURNING id`,
    [passengerId, pickupZone, status],
  );
  return rows[0]!.id;
}

async function insertOpenPool(
  vehicleId: string,
  driverId: string,
  pickupZone: string,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot, seats_reserved, status)
     VALUES ($1, $2, $3, 3, 0, 'OPEN') RETURNING id`,
    [vehicleId, driverId, pickupZone],
  );
  return rows[0]!.id;
}

describe("GET /admin/stats", () => {
  it("rejects an unauthenticated request", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app).get("/api/v1/admin/stats");
    expect(res.status).toBe(401);
  });

  it("rejects a driver", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db);
    const res = await request(app).get("/api/v1/admin/stats").set("Cookie", jashim.cookie);
    expect(res.status).toBe(403);
  });

  it("matches a known fixture, including per-zone breakdown", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);

    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    await driverContext(pool, db, "Monir", {
      name: "Toofan",
      capacity: 3,
      isOnline: true,
      currentZone: "GULSHAN_1",
    });
    await driverContext(pool, db, "Offline Driver", {
      name: "Parked",
      capacity: 3,
      isOnline: false,
    });

    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const shirin = await passengerContext(pool, db, "Shirin");
    await insertRideRequest(nusrat.userId, "REQUESTED", "BANANI");
    await insertRideRequest(rafiq.userId, "COMPLETED", "GULSHAN_1");
    await insertRideRequest(shirin.userId, "CANCELLED", "BANANI");
    await insertOpenPool(jashim.vehicleId, jashim.userId, "BANANI");

    const res = await request(app).get("/api/v1/admin/stats").set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({
      totalRides: 3,
      activeRides: 1,
      completedRides: 1,
      cancelledRides: 1,
      onlineDrivers: 2,
      activePools: 1,
    });

    const banani = res.body.data.byZone.find((z: { zoneCode: string }) => z.zoneCode === "BANANI");
    expect(banani).toMatchObject({ onlineDrivers: 1, openRequests: 1, activePools: 1 });
    const gulshan1 = res.body.data.byZone.find(
      (z: { zoneCode: string }) => z.zoneCode === "GULSHAN_1",
    );
    expect(gulshan1).toMatchObject({ onlineDrivers: 1, openRequests: 0, activePools: 0 });
  });

  it("never counts a suspended driver as online, even if is_online is still true", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    // Deliberately bypasses the suspend endpoint (which itself takes the
    // vehicle offline) to test the stats query's own defensive filter in
    // isolation, not just the write path's side effect.
    await pool.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [jashim.userId]);

    const res = await request(app).get("/api/v1/admin/stats").set("Cookie", admin.cookie);
    expect(res.body.data.totals.onlineDrivers).toBe(0);
    const banani = res.body.data.byZone.find((z: { zoneCode: string }) => z.zoneCode === "BANANI");
    expect(banani.onlineDrivers).toBe(0);
  });
});
