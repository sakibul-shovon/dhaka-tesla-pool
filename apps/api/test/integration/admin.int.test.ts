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

function newDriverBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "New Driver",
    email: `${randomUUID()}@dhakateslapool.test`,
    password: "correct horse battery",
    vehicleName: "Model 3",
    capacity: 4,
    ...overrides,
  };
}

describe("POST /admin/drivers", () => {
  it("rejects an unauthenticated request", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app).post("/api/v1/admin/drivers").send(newDriverBody());
    expect(res.status).toBe(401);
  });

  it("rejects a passenger", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db);
    const res = await request(app)
      .post("/api/v1/admin/drivers")
      .set("Cookie", nusrat.cookie)
      .send(newDriverBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects a driver", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db);
    const res = await request(app)
      .post("/api/v1/admin/drivers")
      .set("Cookie", jashim.cookie)
      .send(newDriverBody());
    expect(res.status).toBe(403);
  });

  it("creates a driver with a vehicle, and the new driver can log in", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const email = `${randomUUID()}@dhakateslapool.test`;

    const res = await request(app)
      .post("/api/v1/admin/drivers")
      .set("Cookie", admin.cookie)
      .send(newDriverBody({ name: "Karim", email, password: "correct horse battery", vehicleName: "Bolt", capacity: 4, zone: "MIRPUR" }));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "Karim",
      email,
      status: "ACTIVE",
      vehicle: { name: "Bolt", capacity: 4, isOnline: false, currentZone: "MIRPUR" },
    });
    expect(res.body.data).not.toHaveProperty("passwordHash");

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "correct horse battery" });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.role).toBe("DRIVER");
  });

  it("rejects a duplicate email", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const body = newDriverBody();

    await request(app).post("/api/v1/admin/drivers").set("Cookie", admin.cookie).send(body);
    const second = await request(app).post("/api/v1/admin/drivers").set("Cookie", admin.cookie).send(body);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects a capacity outside the vehicle's 1..6 range", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const res = await request(app)
      .post("/api/v1/admin/drivers")
      .set("Cookie", admin.cookie)
      .send(newDriverBody({ capacity: 7 }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an unknown field instead of silently ignoring it", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    const res = await request(app)
      .post("/api/v1/admin/drivers")
      .set("Cookie", admin.cookie)
      .send(newDriverBody({ role: "ADMIN" }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("GET /admin/drivers", () => {
  it("rejects a non-admin", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db);
    const res = await request(app).get("/api/v1/admin/drivers").set("Cookie", jashim.cookie);
    expect(res.status).toBe(403);
  });

  it("lists created drivers, newest first", async () => {
    const app = buildTestApp(pool, logger);
    const admin = await adminContext(pool, db);
    await request(app)
      .post("/api/v1/admin/drivers")
      .set("Cookie", admin.cookie)
      .send(newDriverBody({ name: "First" }));
    await request(app)
      .post("/api/v1/admin/drivers")
      .set("Cookie", admin.cookie)
      .send(newDriverBody({ name: "Second" }));

    const res = await request(app).get("/api/v1/admin/drivers").set("Cookie", admin.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ name: "Second" });
    expect(res.body.data[1]).toMatchObject({ name: "First" });
  });
});
