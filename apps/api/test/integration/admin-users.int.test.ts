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

async function insertRideRequest(passengerId: string, status = "COMPLETED"): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests
       (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method, status)
     VALUES ($1, 'BANANI', 'MOHAKHALI', 1, 25, 6750, 5400, 'CASH', $2) RETURNING id`,
    [passengerId, status],
  );
  return rows[0]!.id;
}

async function insertWalletTopUp(userId: string, amountPaisa: number): Promise<void> {
  await pool.query(`INSERT INTO wallets (user_id, balance_paisa) VALUES ($1, $2)`, [
    userId,
    amountPaisa,
  ]);
  await pool.query(
    `INSERT INTO wallet_transactions (wallet_user_id, type, amount_paisa) VALUES ($1, 'TOPUP', $2)`,
    [userId, amountPaisa],
  );
}

async function insertCompletedPoolWithEarnings(
  vehicleId: string,
  driverId: string,
  rideRequestId: string,
  finalFarePaisa: number,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot, seats_reserved, status)
     VALUES ($1, $2, 'BANANI', 3, 0, 'COMPLETED') RETURNING id`,
    [vehicleId, driverId],
  );
  const poolId = rows[0]!.id;
  await pool.query(
    `INSERT INTO pool_memberships (pool_id, ride_request_id, seats, final_fare_paisa) VALUES ($1, $2, 1, $3)`,
    [poolId, rideRequestId, finalFarePaisa],
  );
  return poolId;
}

describe("GET /admin/users", () => {
  it("rejects an unauthenticated request", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app).get("/api/v1/admin/users");
    expect(res.status).toBe(401);
  });

  it("rejects a passenger", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db);
    const res = await request(app).get("/api/v1/admin/users").set("Cookie", nusrat.cookie);
    expect(res.status).toBe(403);
  });

  it("never returns password_hash", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    await passengerContext(pool, db, "Nusrat");
    const res = await request(app).get("/api/v1/admin/users").set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    for (const row of res.body.data) {
      expect(row.passwordHash).toBeUndefined();
      expect(row.password_hash).toBeUndefined();
    }
  });

  it("filters by role and status", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const rafiq = await passengerContext(pool, db, "Rafiq");
    await driverContext(pool, db, "Jashim");
    await pool.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [rafiq.userId]);

    const driversOnly = await request(app)
      .get("/api/v1/admin/users")
      .query({ role: "DRIVER" })
      .set("Cookie", admin.cookie);
    expect(driversOnly.body.data).toHaveLength(1);
    expect(driversOnly.body.data[0].name).toBe("Jashim");

    const suspendedOnly = await request(app)
      .get("/api/v1/admin/users")
      .query({ status: "SUSPENDED" })
      .set("Cookie", admin.cookie);
    expect(suspendedOnly.body.data).toHaveLength(1);
    expect(suspendedOnly.body.data[0].name).toBe("Rafiq");
  });

  it("searches by name or email substring, case-insensitively", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    await passengerContext(pool, db, "Shirin");
    await passengerContext(pool, db, "Rafiq");

    const res = await request(app)
      .get("/api/v1/admin/users")
      .query({ q: "shir" })
      .set("Cookie", admin.cookie);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Shirin");
  });

  it("paginates with a cursor that reaches every row exactly once", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    await passengerContext(pool, db, "Nusrat");
    await passengerContext(pool, db, "Rafiq");
    await passengerContext(pool, db, "Shirin");

    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .get("/api/v1/admin/users")
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .set("Cookie", admin.cookie);
      for (const row of res.body.data) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = res.body.page.nextCursor;
      if (!cursor) break;
    }
    // admin + 3 passengers.
    expect(seen.size).toBe(4);
  });

  it("rejects a malformed cursor", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const res = await request(app)
      .get("/api/v1/admin/users")
      .query({ cursor: "not-a-real-cursor" })
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("GET /admin/users/:id", () => {
  it("rejects an unauthenticated request", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app).get(`/api/v1/admin/users/${randomUUID()}`);
    expect(res.status).toBe(401);
  });

  it("404s for a user that doesn't exist", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const res = await request(app)
      .get(`/api/v1/admin/users/${randomUUID()}`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(404);
  });

  it("shows a passenger's recent rides and wallet, and driver is null", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const nusrat = await passengerContext(pool, db, "Nusrat");
    await insertRideRequest(nusrat.userId);
    await insertWalletTopUp(nusrat.userId, 50000);

    const res = await request(app)
      .get(`/api/v1/admin/users/${nusrat.userId}`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.driver).toBeNull();
    expect(res.body.data.passenger.recentRides).toHaveLength(1);
    expect(res.body.data.passenger.wallet.balancePaisa).toBe(50000);
    expect(res.body.data.passenger.wallet.transactions).toHaveLength(1);
  });

  it("shows a driver's vehicle and recent pools with earnings, and passenger is null", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: false,
      currentZone: null,
    });
    const somePassenger = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertRideRequest(somePassenger.userId);
    await insertCompletedPoolWithEarnings(jashim.vehicleId, jashim.userId, rideId, 5400);

    const res = await request(app)
      .get(`/api/v1/admin/users/${jashim.userId}`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.passenger).toBeNull();
    expect(res.body.data.driver.vehicle).toMatchObject({ name: "Bullet", capacity: 3 });
    expect(res.body.data.driver.recentPools).toHaveLength(1);
    expect(res.body.data.driver.recentPools[0].earningsPaisa).toBe(5400);
  });

  it("shows an admin's base profile with no passenger or driver detail", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db, "Admin");
    const otherAdmin = await adminContext(pool, db, "Other Admin");

    const res = await request(app)
      .get(`/api/v1/admin/users/${otherAdmin.userId}`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.passenger).toBeNull();
    expect(res.body.data.driver).toBeNull();
  });

  it("shows the account's own status history after a suspend/reactivate cycle", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const rafiq = await passengerContext(pool, db, "Rafiq");
    await request(app)
      .post(`/api/v1/admin/users/${rafiq.userId}/suspend`)
      .set("Cookie", admin.cookie)
      .send({ reason: "test" });
    await request(app)
      .post(`/api/v1/admin/users/${rafiq.userId}/reactivate`)
      .set("Cookie", admin.cookie)
      .send({});

    const res = await request(app)
      .get(`/api/v1/admin/users/${rafiq.userId}`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.statusHistory).toHaveLength(2);
    expect(res.body.data.statusHistory[0].toStatus).toBe("ACTIVE"); // newest first
    expect(res.body.data.statusHistory[1].toStatus).toBe("SUSPENDED");
  });
});
