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
