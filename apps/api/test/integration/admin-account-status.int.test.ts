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

async function insertActiveRideRequest(passengerId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests
       (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method, status)
     VALUES ($1, 'BANANI', 'MOHAKHALI', 1, 25, 6750, 5400, 'CASH', 'REQUESTED') RETURNING id`,
    [passengerId],
  );
  return rows[0]!.id;
}

async function insertOpenPool(vehicleId: string, driverId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot, seats_reserved, status)
     VALUES ($1, $2, 'BANANI', 3, 0, 'OPEN') RETURNING id`,
    [vehicleId, driverId],
  );
  return rows[0]!.id;
}

describe("POST /admin/users/:id/suspend", () => {
  it("rejects an unauthenticated request", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app).post(`/api/v1/admin/users/${randomUUID()}/suspend`).send({});
    expect(res.status).toBe(401);
  });

  it("rejects a passenger", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db);
    const res = await request(app)
      .post(`/api/v1/admin/users/${randomUUID()}/suspend`)
      .set("Cookie", nusrat.cookie)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects a driver", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db);
    const res = await request(app)
      .post(`/api/v1/admin/users/${randomUUID()}/suspend`)
      .set("Cookie", jashim.cookie)
      .send({});
    expect(res.status).toBe(403);
  });

  it("404s for a user that doesn't exist", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const res = await request(app)
      .post(`/api/v1/admin/users/${randomUUID()}/suspend`)
      .set("Cookie", admin.cookie)
      .send({});
    expect(res.status).toBe(404);
  });

  it("403s when the target is another admin", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db, "Admin");
    const otherAdmin = await adminContext(pool, db, "Other Admin");
    const res = await request(app)
      .post(`/api/v1/admin/users/${otherAdmin.userId}/suspend`)
      .set("Cookie", admin.cookie)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    // Untouched.
    const meRes = await request(app).get("/api/v1/auth/me").set("Cookie", otherAdmin.cookie);
    expect(meRes.status).toBe(200);
  });

  it("suspends a passenger and immediately kills their live session", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const rafiq = await passengerContext(pool, db, "Rafiq");

    const res = await request(app)
      .post(`/api/v1/admin/users/${rafiq.userId}/suspend`)
      .set("Cookie", admin.cookie)
      .send({ reason: "reported by another rider" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: rafiq.userId, status: "SUSPENDED" });
    expect(res.body.data.email).toBeTypeOf("string");

    const meRes = await request(app).get("/api/v1/auth/me").set("Cookie", rafiq.cookie);
    expect(meRes.status).toBe(401);
  });

  it("refuses to suspend a passenger with an active ride (A27)", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = await insertActiveRideRequest(nusrat.userId);

    const res = await request(app)
      .post(`/api/v1/admin/users/${nusrat.userId}/suspend`)
      .set("Cookie", admin.cookie)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ACTIVE_RIDE_EXISTS");
    expect(res.body.error.details.rideRequestId).toBe(rideId);

    // Untouched: session still resolves.
    const meRes = await request(app).get("/api/v1/auth/me").set("Cookie", nusrat.cookie);
    expect(meRes.status).toBe(200);
  });

  it("refuses to suspend a driver with an active pool (A27)", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const poolId = await insertOpenPool(jashim.vehicleId, jashim.userId);

    const res = await request(app)
      .post(`/api/v1/admin/users/${jashim.userId}/suspend`)
      .set("Cookie", admin.cookie)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DRIVER_HAS_ACTIVE_POOL");
    expect(res.body.error.details.poolId).toBe(poolId);

    const { rows } = await pool.query<{ is_online: boolean }>(
      `SELECT is_online FROM vehicles WHERE id = $1`,
      [jashim.vehicleId],
    );
    expect(rows[0]!.is_online).toBe(true);
  });

  it("suspends an online driver with no active pool and takes the vehicle offline", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });

    const res = await request(app)
      .post(`/api/v1/admin/users/${jashim.userId}/suspend`)
      .set("Cookie", admin.cookie)
      .send({});
    expect(res.status).toBe(200);

    const { rows } = await pool.query<{ is_online: boolean }>(
      `SELECT is_online FROM vehicles WHERE id = $1`,
      [jashim.vehicleId],
    );
    expect(rows[0]!.is_online).toBe(false);
  });

  it("rejects suspending an already-suspended account", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const rafiq = await passengerContext(pool, db, "Rafiq");
    await request(app)
      .post(`/api/v1/admin/users/${rafiq.userId}/suspend`)
      .set("Cookie", admin.cookie)
      .send({});

    const res = await request(app)
      .post(`/api/v1/admin/users/${rafiq.userId}/suspend`)
      .set("Cookie", admin.cookie)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("rejects an oversized reason", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const res = await request(app)
      .post(`/api/v1/admin/users/${rafiq.userId}/suspend`)
      .set("Cookie", admin.cookie)
      .send({ reason: "x".repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("writes exactly one append-only history row with actor and reason", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const rafiq = await passengerContext(pool, db, "Rafiq");

    await request(app)
      .post(`/api/v1/admin/users/${rafiq.userId}/suspend`)
      .set("Cookie", admin.cookie)
      .send({ reason: "abusive messages to driver" });

    const { rows } = await pool.query(
      `SELECT from_status, to_status, actor_user_id, reason FROM account_status_history WHERE user_id = $1`,
      [rafiq.userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      from_status: "ACTIVE",
      to_status: "SUSPENDED",
      actor_user_id: admin.userId,
      reason: "abusive messages to driver",
    });
  });
});

describe("POST /admin/users/:id/reactivate", () => {
  it("rejects an unauthenticated request", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app).post(`/api/v1/admin/users/${randomUUID()}/reactivate`).send({});
    expect(res.status).toBe(401);
  });

  it("reactivates a suspended account, and a fresh session then resolves", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const rafiq = await passengerContext(pool, db, "Rafiq");
    await request(app)
      .post(`/api/v1/admin/users/${rafiq.userId}/suspend`)
      .set("Cookie", admin.cookie)
      .send({});

    const res = await request(app)
      .post(`/api/v1/admin/users/${rafiq.userId}/reactivate`)
      .set("Cookie", admin.cookie)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ACTIVE");

    // Simulates logging back in: a brand-new session for the now-active account.
    const { token } = await createSession(db, rafiq.userId, 1);
    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `${SESSION_COOKIE_NAME}=${token}`);
    expect(meRes.status).toBe(200);
  });

  it("does not revive the session that was revoked at suspension", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const rafiq = await passengerContext(pool, db, "Rafiq");
    await request(app)
      .post(`/api/v1/admin/users/${rafiq.userId}/suspend`)
      .set("Cookie", admin.cookie)
      .send({});
    await request(app)
      .post(`/api/v1/admin/users/${rafiq.userId}/reactivate`)
      .set("Cookie", admin.cookie)
      .send({});

    const meRes = await request(app).get("/api/v1/auth/me").set("Cookie", rafiq.cookie);
    expect(meRes.status).toBe(401);
  });

  it("rejects reactivating an already-active account", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const rafiq = await passengerContext(pool, db, "Rafiq");

    const res = await request(app)
      .post(`/api/v1/admin/users/${rafiq.userId}/reactivate`)
      .set("Cookie", admin.cookie)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });
});
