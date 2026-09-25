import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { buildTestApp } from "../support/build-test-app.js";
import { createDb, type Db } from "../../src/db/client.js";
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

// Sessions are minted directly against the DB (mirrors session-service.int.test.ts)
// rather than through POST /auth/register + /auth/login: those endpoints share a
// module-level rate limiter across every app instance in this process, and this
// file's per-test isolation would otherwise trip it well before 15 minutes pass.
// None of these tests are exercising the auth flow itself.
interface PassengerContext {
  userId: string;
  cookie: string;
}

async function insertPassenger(name = "Nusrat"): Promise<string> {
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', 'PASSENGER') RETURNING id`,
    [name, `${randomUUID()}@dhakateslapool.test`],
  );
  return row!.id;
}

async function passengerContext(name = "Nusrat"): Promise<PassengerContext> {
  const userId = await insertPassenger(name);
  const { token } = await createSession(db, userId, 1);
  return { userId, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function driverContext(name = "Jashim"): Promise<PassengerContext> {
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', 'DRIVER') RETURNING id`,
    [name, `${randomUUID()}@dhakateslapool.test`],
  );
  const { token } = await createSession(db, row!.id, 1);
  return { userId: row!.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

const NUSRAT_TRIP = { pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1, paymentMethod: "CASH" as const };

function createRideRequest(
  app: ReturnType<typeof buildTestApp>,
  cookie: string,
  overrides: Partial<typeof NUSRAT_TRIP> = {},
) {
  return request(app)
    .post("/api/v1/ride-requests")
    .set("Cookie", cookie)
    .set("Idempotency-Key", randomUUID())
    .send({ ...NUSRAT_TRIP, ...overrides });
}

describe("POST /ride-requests (plan §8.2, §11, §12.2)", () => {
  it("creates a ride request with a stored fare snapshot (৳67.50 solo / ৳54.00 pooled)", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();

    const res = await createRideRequest(app, cookie);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      pickupZone: "BANANI",
      dropoffZone: "MOHAKHALI",
      seats: 1,
      distanceDkm: 25,
      soloFarePaisa: 6750,
      pooledFarePaisa: 5400,
      paymentMethod: "CASH",
      status: "REQUESTED",
    });
    expect(res.body.data.id).toBeTruthy();
  });

  it("writes exactly one REQUESTED history row on creation (plan §16.4)", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();

    const created = await createRideRequest(app, cookie);

    const { rows } = await pool.query(
      `SELECT from_status, to_status FROM ride_status_history WHERE ride_request_id = $1`,
      [created.body.data.id],
    );
    expect(rows).toEqual([{ from_status: null, to_status: "REQUESTED" }]);
  });

  it("requires an Idempotency-Key header", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();

    const res = await request(app).post("/api/v1/ride-requests").set("Cookie", cookie).send(NUSRAT_TRIP);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("rejects a second active ride and reports the existing id (409 ACTIVE_RIDE_EXISTS)", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();

    const first = await createRideRequest(app, cookie);
    const second = await createRideRequest(app, cookie, { dropoffZone: "GULSHAN_1" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ACTIVE_RIDE_EXISTS");
    expect(second.body.error.details.rideRequestId).toBe(first.body.data.id);
  });

  it("replays an identical retry of the same intent without creating a second ride", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();
    const key = randomUUID();

    const first = await request(app)
      .post("/api/v1/ride-requests")
      .set("Cookie", cookie)
      .set("Idempotency-Key", key)
      .send(NUSRAT_TRIP);
    const second = await request(app)
      .post("/api/v1/ride-requests")
      .set("Cookie", cookie)
      .set("Idempotency-Key", key)
      .send(NUSRAT_TRIP);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(first.headers["idempotent-replayed"]).toBeUndefined();

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ride_requests`);
    expect(rows[0].n).toBe(1);
  });

  it("rejects reusing the same key for a different request body (422 IDEMPOTENCY_KEY_REUSED)", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();
    const key = randomUUID();

    const first = await request(app)
      .post("/api/v1/ride-requests")
      .set("Cookie", cookie)
      .set("Idempotency-Key", key)
      .send(NUSRAT_TRIP);
    const second = await request(app)
      .post("/api/v1/ride-requests")
      .set("Cookie", cookie)
      .set("Idempotency-Key", key)
      .send({ ...NUSRAT_TRIP, dropoffZone: "GULSHAN_1" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("rejects an unauthenticated caller", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app).post("/api/v1/ride-requests").set("Idempotency-Key", randomUUID()).send(NUSRAT_TRIP);
    expect(res.status).toBe(401);
  });
});

describe("GET /ride-requests/:id and /:id/history (plan §12.2)", () => {
  it("reads back a ride request the caller owns", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();
    const created = await createRideRequest(app, cookie);

    const res = await request(app).get(`/api/v1/ride-requests/${created.body.data.id}`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(created.body.data.id);
    expect(res.body.data.status).toBe("REQUESTED");
  });

  it("returns the REQUESTED history row written at creation", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();
    const created = await createRideRequest(app, cookie);

    const res = await request(app)
      .get(`/api/v1/ride-requests/${created.body.data.id}/history`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ fromStatus: null, toStatus: "REQUESTED" });
  });

  it("404s for an id that does not exist", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();

    const res = await request(app).get(`/api/v1/ride-requests/${randomUUID()}`).set("Cookie", cookie);

    expect(res.status).toBe(404);
  });
});

// Seeds rows directly with explicit, spaced-out `created_at` values so
// ordering in the pagination tests is deterministic, and so more than one
// row can exist for a passenger without going through the (not yet built)
// cancel endpoint or violating the one-active-ride rule.
async function seedRideRequest(passengerId: string, status: string, createdAt: Date): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests
       (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method, status, created_at)
     VALUES ($1, 'BANANI', 'MOHAKHALI', 1, 25, 6750, 5400, 'CASH', $2, $3) RETURNING id`,
    [passengerId, status, createdAt],
  );
  return rows[0]!.id;
}

describe("GET /ride-requests (keyset pagination, plan §12.1)", () => {
  it("lists only the caller's own requests, newest first", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();
    await createRideRequest(app, cookie);

    const res = await request(app).get("/api/v1/ride-requests").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.page).toEqual({ limit: 20, nextCursor: null });
  });

  it("does not list another passenger's requests", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();
    const other = await passengerContext("Rafiq");
    await createRideRequest(app, other.cookie);

    const res = await request(app).get("/api/v1/ride-requests").set("Cookie", cookie);

    expect(res.body.data).toHaveLength(0);
  });

  it("pages through results with a cursor, most recent first", async () => {
    const app = buildTestApp(pool, logger);
    const { userId, cookie } = await passengerContext();
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    const ids = [
      await seedRideRequest(userId, "CANCELLED", new Date(base)),
      await seedRideRequest(userId, "CANCELLED", new Date(base + 1000)),
      await seedRideRequest(userId, "CANCELLED", new Date(base + 2000)),
    ];

    const firstPage = await request(app).get("/api/v1/ride-requests?limit=2").set("Cookie", cookie);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.data.map((r: { id: string }) => r.id)).toEqual([ids[2], ids[1]]);
    expect(firstPage.body.page.nextCursor).not.toBeNull();

    const secondPage = await request(app)
      .get(`/api/v1/ride-requests?limit=2&cursor=${firstPage.body.page.nextCursor}`)
      .set("Cookie", cookie);
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.data[0].id).toBe(ids[0]);
    expect(secondPage.body.page.nextCursor).toBeNull();
  });

  it("rejects a limit above 50 instead of clamping it", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();

    const res = await request(app).get("/api/v1/ride-requests?limit=51").set("Cookie", cookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a limit of zero", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();

    const res = await request(app).get("/api/v1/ride-requests?limit=0").set("Cookie", cookie);

    expect(res.status).toBe(400);
  });

  it("rejects a malformed cursor", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();

    const res = await request(app).get("/api/v1/ride-requests?cursor=not-base64url-json").set("Cookie", cookie);

    expect(res.status).toBe(400);
  });

  it("filters by status", async () => {
    const app = buildTestApp(pool, logger);
    const { userId, cookie } = await passengerContext();
    await seedRideRequest(userId, "CANCELLED", new Date());

    const requested = await request(app).get("/api/v1/ride-requests?status=REQUESTED").set("Cookie", cookie);
    const cancelled = await request(app).get("/api/v1/ride-requests?status=CANCELLED").set("Cookie", cookie);

    expect(requested.body.data).toHaveLength(0);
    expect(cancelled.body.data).toHaveLength(1);
  });
});

describe("POST /ride-requests/:id/cancel (plan §9.1, §10.7)", () => {
  it("cancels a REQUESTED ride and frees up the active-ride slot", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();
    const created = await createRideRequest(app, cookie);

    const res = await request(app)
      .post(`/api/v1/ride-requests/${created.body.data.id}/cancel`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "Changed my mind" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
    expect(res.body.data.cancelReason).toBe("Changed my mind");

    // The active-ride slot is free again (plan §9.1: only REQUESTED/MATCHED/
    // DRIVER_ARRIVED/STARTED hold it).
    const again = await createRideRequest(app, cookie);
    expect(again.status).toBe(201);
  });

  it("writes a CANCELLED history row alongside the REQUESTED one", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();
    const created = await createRideRequest(app, cookie);

    await request(app)
      .post(`/api/v1/ride-requests/${created.body.data.id}/cancel`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", randomUUID())
      .send({});

    const res = await request(app)
      .get(`/api/v1/ride-requests/${created.body.data.id}/history`)
      .set("Cookie", cookie);

    expect(res.body.data.map((h: { toStatus: string }) => h.toStatus)).toEqual(["REQUESTED", "CANCELLED"]);
  });

  it("rejects cancelling an already-cancelled ride (409 INVALID_TRANSITION)", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();
    const created = await createRideRequest(app, cookie);
    await request(app)
      .post(`/api/v1/ride-requests/${created.body.data.id}/cancel`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", randomUUID())
      .send({});

    const res = await request(app)
      .post(`/api/v1/ride-requests/${created.body.data.id}/cancel`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", randomUUID())
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("replays an identical retry with the same Idempotency-Key", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();
    const created = await createRideRequest(app, cookie);
    const key = randomUUID();

    const first = await request(app)
      .post(`/api/v1/ride-requests/${created.body.data.id}/cancel`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", key)
      .send({});
    const second = await request(app)
      .post(`/api/v1/ride-requests/${created.body.data.id}/cancel`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", key)
      .send({});

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
  });

  it("404s cancelling a ride id that does not exist", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await passengerContext();

    const res = await request(app)
      .post(`/api/v1/ride-requests/${randomUUID()}/cancel`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", randomUUID())
      .send({});

    expect(res.status).toBe(404);
  });
});

describe("ownership and role authorization (plan §13.1 BOLA/BFLA, §13.2)", () => {
  it("404s Rafiq reading Nusrat's ride (not 403 — no existence oracle)", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext("Nusrat");
    const rafiq = await passengerContext("Rafiq");
    const nusratsRide = await createRideRequest(app, nusrat.cookie);

    const res = await request(app)
      .get(`/api/v1/ride-requests/${nusratsRide.body.data.id}`)
      .set("Cookie", rafiq.cookie);

    expect(res.status).toBe(404);
  });

  it("404s Rafiq reading Nusrat's ride history", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext("Nusrat");
    const rafiq = await passengerContext("Rafiq");
    const nusratsRide = await createRideRequest(app, nusrat.cookie);

    const res = await request(app)
      .get(`/api/v1/ride-requests/${nusratsRide.body.data.id}/history`)
      .set("Cookie", rafiq.cookie);

    expect(res.status).toBe(404);
  });

  it("404s Rafiq cancelling Nusrat's ride, which stays REQUESTED", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext("Nusrat");
    const rafiq = await passengerContext("Rafiq");
    const nusratsRide = await createRideRequest(app, nusrat.cookie);

    const res = await request(app)
      .post(`/api/v1/ride-requests/${nusratsRide.body.data.id}/cancel`)
      .set("Cookie", rafiq.cookie)
      .set("Idempotency-Key", randomUUID())
      .send({});

    expect(res.status).toBe(404);

    const stillThere = await request(app)
      .get(`/api/v1/ride-requests/${nusratsRide.body.data.id}`)
      .set("Cookie", nusrat.cookie);
    expect(stillThere.body.data.status).toBe("REQUESTED");
  });

  it("403s a driver creating a ride request (BFLA — passenger-only)", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await driverContext();

    const res = await request(app)
      .post("/api/v1/ride-requests")
      .set("Cookie", cookie)
      .set("Idempotency-Key", randomUUID())
      .send(NUSRAT_TRIP);

    expect(res.status).toBe(403);
  });

  it("403s a driver listing ride requests", async () => {
    const app = buildTestApp(pool, logger);
    const { cookie } = await driverContext();

    const res = await request(app).get("/api/v1/ride-requests").set("Cookie", cookie);

    expect(res.status).toBe(403);
  });
});
