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

type App = ReturnType<typeof buildTestApp>;

function createRide(app: App, cookie: string) {
  return request(app)
    .post("/api/v1/ride-requests")
    .set("Cookie", cookie)
    .set("Idempotency-Key", randomUUID())
    .send({ pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1, paymentMethod: "CASH" });
}

describe("GET /admin/ride-requests", () => {
  it("rejects an unauthenticated request", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app).get("/api/v1/admin/ride-requests");
    expect(res.status).toBe(401);
  });

  it("rejects a passenger", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db);
    const res = await request(app).get("/api/v1/admin/ride-requests").set("Cookie", nusrat.cookie);
    expect(res.status).toBe(403);
  });

  it("lists rides across every passenger, with the rider's identity attached", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");
    await createRide(app, nusrat.cookie);
    await createRide(app, rafiq.cookie);

    const res = await request(app).get("/api/v1/admin/ride-requests").set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const names = res.body.data.map((r: { passengerName: string }) => r.passengerName).sort();
    expect(names).toEqual(["Nusrat", "Rafiq"]);
  });

  it("filters by status", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = (await createRide(app, nusrat.cookie)).body.data.id;
    await request(app)
      .post(`/api/v1/ride-requests/${rideId}/cancel`)
      .set("Cookie", nusrat.cookie)
      .set("Idempotency-Key", randomUUID())
      .send({});

    const res = await request(app)
      .get("/api/v1/admin/ride-requests")
      .query({ status: "CANCELLED" })
      .set("Cookie", admin.cookie);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(rideId);
  });
});

describe("GET /admin/ride-requests/:id", () => {
  it("rejects an unauthenticated request", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app).get(`/api/v1/admin/ride-requests/${randomUUID()}`);
    expect(res.status).toBe(401);
  });

  it("404s for a ride that doesn't exist", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const res = await request(app)
      .get(`/api/v1/admin/ride-requests/${randomUUID()}`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(404);
  });

  it("shows an unmatched ride with pool null and its own creation history", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = (await createRide(app, nusrat.cookie)).body.data.id;

    const res = await request(app)
      .get(`/api/v1/admin/ride-requests/${rideId}`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.pool).toBeNull();
    expect(res.body.data.passengerName).toBe("Nusrat");
    expect(res.body.data.history).toHaveLength(1);
    expect(res.body.data.history[0].toStatus).toBe("REQUESTED");
  });

  it("shows a matched ride's pool with the driver, vehicle, and full member list", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rideId = (await createRide(app, nusrat.cookie)).body.data.id;
    await request(app)
      .post(`/api/v1/driver/requests/${rideId}/accept`)
      .set("Cookie", jashim.cookie)
      .set("Idempotency-Key", randomUUID())
      .send({});

    const res = await request(app)
      .get(`/api/v1/admin/ride-requests/${rideId}`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.pool).toMatchObject({ vehicleName: "Bullet", driverFirstName: "Jashim" });
    expect(res.body.data.pool.members).toHaveLength(1);
    expect(res.body.data.pool.members[0].passengerName).toBe("Nusrat");
    expect(res.body.data.history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      "REQUESTED",
      "MATCHED",
    ]);
  });
});
