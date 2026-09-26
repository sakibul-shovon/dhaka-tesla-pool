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

type App = ReturnType<typeof buildTestApp>;

async function createRideRequest(app: App, cookie: string, pickupZone: string, dropoffZone: string) {
  const res = await request(app)
    .post("/api/v1/ride-requests")
    .set("Cookie", cookie)
    .set("Idempotency-Key", randomUUID())
    .send({ pickupZone, dropoffZone, seats: 1, paymentMethod: "CASH" });
  return res.body.data.id as string;
}

function accept(app: App, cookie: string, rideRequestId: string) {
  return request(app)
    .post(`/api/v1/driver/requests/${rideRequestId}/accept`)
    .set("Cookie", cookie)
    .set("Idempotency-Key", randomUUID())
    .send({});
}

function join(app: App, cookie: string, poolId: string, rideRequestId: string, key = randomUUID()) {
  return request(app)
    .post(`/api/v1/pools/${poolId}/join`)
    .set("Cookie", cookie)
    .set("Idempotency-Key", key)
    .send({ rideRequestId });
}

describe("POST /pools/:id/join", () => {
  it("lets Rafiq join Nusrat's pool and share Bullet with her", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");

    const nusratRide = await createRideRequest(app, nusrat.cookie, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, nusratRide);
    const poolId = accepted.body.data.pool.id as string;
    const rafiqRide = await createRideRequest(app, rafiq.cookie, "BANANI", "GULSHAN_1");

    const res = await join(app, rafiq.cookie, poolId, rafiqRide);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("MATCHED");
    expect(res.body.data.pool).toMatchObject({
      poolId,
      vehicleName: "Bullet",
      driverFirstName: "Jashim",
      seatsReserved: 2,
      sharedWithCount: 1,
    });

    const arrive = await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);
    expect(arrive.status).toBe(200);
    const start = await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set("Cookie", jashim.cookie);
    expect(start.status).toBe(200);

    const view = await request(app).get(`/api/v1/driver/pools/${poolId}`).set("Cookie", jashim.cookie);
    const fares = view.body.data.members
      .map((m: { finalFarePaisa: number }) => m.finalFarePaisa)
      .sort((a: number, b: number) => a - b);
    expect(fares).toEqual([5400, 6000]); // Nusrat 67.50 -> 54.00 pooled, Rafiq 75.00 -> 60.00 pooled
    expect(view.body.data.members.every((m: { sharedRide: boolean }) => m.sharedRide)).toBe(true);
  });

  it("rejects joining a pool that's already full", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 1,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const nusratRide = await createRideRequest(app, nusrat.cookie, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, nusratRide);
    const poolId = accepted.body.data.pool.id as string;
    const rafiqRide = await createRideRequest(app, rafiq.cookie, "BANANI", "GULSHAN_1");

    const res = await join(app, rafiq.cookie, poolId, rafiqRide);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("POOL_CAPACITY_EXCEEDED");
  });

  it("rejects a drop-off outside the pool's 3.5km spread", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const shirin = await passengerContext(pool, db, "Shirin");
    const nusratRide = await createRideRequest(app, nusrat.cookie, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, nusratRide);
    const poolId = accepted.body.data.pool.id as string;
    const shirinRide = await createRideRequest(app, shirin.cookie, "BANANI", "GULSHAN_2");

    const res = await join(app, shirin.cookie, poolId, shirinRide);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("POOL_INCOMPATIBLE");
  });

  it("rejects joining once the pool is no longer OPEN", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const nusratRide = await createRideRequest(app, nusrat.cookie, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, nusratRide);
    const poolId = accepted.body.data.pool.id as string;
    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);
    const rafiqRide = await createRideRequest(app, rafiq.cookie, "BANANI", "GULSHAN_1");

    const res = await join(app, rafiq.cookie, poolId, rafiqRide);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("POOL_NOT_ACCEPTING");
  });

  it("404s a pool that doesn't exist", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const nusratRide = await createRideRequest(app, nusrat.cookie, "BANANI", "MOHAKHALI");

    const res = await join(app, nusrat.cookie, randomUUID(), nusratRide);
    expect(res.status).toBe(404);
  });

  it("404s a ride request that doesn't belong to the caller", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const nusratRide = await createRideRequest(app, nusrat.cookie, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, nusratRide);
    const poolId = accepted.body.data.pool.id as string;

    // Rafiq's cookie, but Nusrat's own ride request id.
    const res = await join(app, rafiq.cookie, poolId, nusratRide);
    expect(res.status).toBe(404);
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
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const nusratRide = await createRideRequest(app, nusrat.cookie, "BANANI", "MOHAKHALI");
    const accepted = await accept(app, jashim.cookie, nusratRide);
    const poolId = accepted.body.data.pool.id as string;
    const rafiqRide = await createRideRequest(app, rafiq.cookie, "BANANI", "GULSHAN_1");
    const key = randomUUID();

    const first = await join(app, rafiq.cookie, poolId, rafiqRide, key);
    const second = await join(app, rafiq.cookie, poolId, rafiqRide, key);

    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(second.headers["idempotent-replayed"]).toBe("true");

    const { rows } = await pool.query(`SELECT * FROM pool_memberships`);
    expect(rows).toHaveLength(2);
  });
});
