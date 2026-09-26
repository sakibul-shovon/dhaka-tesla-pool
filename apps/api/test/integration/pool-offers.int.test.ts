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

describe("GET /ride-requests/:id/pool-offers", () => {
  it("lists an OPEN pool in the same zone with a compatible drop-off", async () => {
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
    await accept(app, jashim.cookie, nusratRide);
    const rafiqRide = await createRideRequest(app, rafiq.cookie, "BANANI", "GULSHAN_1");

    const res = await request(app).get(`/api/v1/ride-requests/${rafiqRide}/pool-offers`).set("Cookie", rafiq.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      vehicleName: "Bullet",
      driverFirstName: "Jashim",
      seatsLeft: 2,
      sharedWithCount: 1,
    });
    expect(typeof res.body.data[0].poolId).toBe("string");
    expect(typeof res.body.data[0].soloFarePaisa).toBe("number");
  });

  it("omits a pool whose drop-off spread is too wide", async () => {
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
    await accept(app, jashim.cookie, nusratRide);
    const shirinRide = await createRideRequest(app, shirin.cookie, "BANANI", "GULSHAN_2");

    const res = await request(app).get(`/api/v1/ride-requests/${shirinRide}/pool-offers`).set("Cookie", shirin.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("omits a pool in a different pickup zone", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "MOHAKHALI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");

    const nusratRide = await createRideRequest(app, nusrat.cookie, "MOHAKHALI", "GULSHAN_1");
    await accept(app, jashim.cookie, nusratRide);
    const rafiqRide = await createRideRequest(app, rafiq.cookie, "BANANI", "GULSHAN_1");

    const res = await request(app).get(`/api/v1/ride-requests/${rafiqRide}/pool-offers`).set("Cookie", rafiq.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("404s a ride request that doesn't belong to the caller", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const rafiq = await passengerContext(pool, db, "Rafiq");
    const nusratRide = await createRideRequest(app, nusrat.cookie, "BANANI", "MOHAKHALI");

    const res = await request(app).get(`/api/v1/ride-requests/${nusratRide}/pool-offers`).set("Cookie", rafiq.cookie);
    expect(res.status).toBe(404);
  });

  it("rejects once the request itself has already been matched", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const nusratRide = await createRideRequest(app, nusrat.cookie, "BANANI", "MOHAKHALI");
    await accept(app, jashim.cookie, nusratRide);

    const res = await request(app).get(`/api/v1/ride-requests/${nusratRide}/pool-offers`).set("Cookie", nusrat.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REQUEST_NOT_OPEN");
  });
});
