import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { buildTestApp } from "../support/build-test-app.js";

let pool: Pool;
const logger = pino({ level: "silent" });

beforeAll(() => {
  pool = createTestPool();
});

afterEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

function uniqueEmail(): string {
  return `${randomUUID()}@dhakateslapool.test`;
}

async function registerAndLogin(app: ReturnType<typeof buildTestApp>, name = "Nusrat") {
  const agent = request.agent(app);
  const email = uniqueEmail();
  await agent.post("/api/v1/auth/register").send({ name, email, password: "correct horse battery" });
  await agent.post("/api/v1/auth/login").send({ email, password: "correct horse battery" });
  return agent;
}

const NUSRAT_TRIP = { pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1, paymentMethod: "CASH" as const };

describe("POST /ride-requests (plan §8.2, §11, §12.2)", () => {
  it("creates a ride request with a stored fare snapshot (৳67.50 solo / ৳54.00 pooled)", async () => {
    const app = buildTestApp(pool, logger);
    const agent = await registerAndLogin(app);

    const res = await agent
      .post("/api/v1/ride-requests")
      .set("Idempotency-Key", randomUUID())
      .send(NUSRAT_TRIP);

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
    const agent = await registerAndLogin(app);

    const created = await agent
      .post("/api/v1/ride-requests")
      .set("Idempotency-Key", randomUUID())
      .send(NUSRAT_TRIP);

    const { rows } = await pool.query(
      `SELECT from_status, to_status FROM ride_status_history WHERE ride_request_id = $1`,
      [created.body.data.id],
    );
    expect(rows).toEqual([{ from_status: null, to_status: "REQUESTED" }]);
  });

  it("requires an Idempotency-Key header", async () => {
    const app = buildTestApp(pool, logger);
    const agent = await registerAndLogin(app);

    const res = await agent.post("/api/v1/ride-requests").send(NUSRAT_TRIP);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("rejects a second active ride and reports the existing id (409 ACTIVE_RIDE_EXISTS)", async () => {
    const app = buildTestApp(pool, logger);
    const agent = await registerAndLogin(app);

    const first = await agent
      .post("/api/v1/ride-requests")
      .set("Idempotency-Key", randomUUID())
      .send(NUSRAT_TRIP);
    const second = await agent
      .post("/api/v1/ride-requests")
      .set("Idempotency-Key", randomUUID())
      .send({ ...NUSRAT_TRIP, dropoffZone: "GULSHAN_1" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ACTIVE_RIDE_EXISTS");
    expect(second.body.error.details.rideRequestId).toBe(first.body.data.id);
  });

  it("replays an identical retry of the same intent without creating a second ride", async () => {
    const app = buildTestApp(pool, logger);
    const agent = await registerAndLogin(app);
    const key = randomUUID();

    const first = await agent.post("/api/v1/ride-requests").set("Idempotency-Key", key).send(NUSRAT_TRIP);
    const second = await agent.post("/api/v1/ride-requests").set("Idempotency-Key", key).send(NUSRAT_TRIP);

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
    const agent = await registerAndLogin(app);
    const key = randomUUID();

    const first = await agent.post("/api/v1/ride-requests").set("Idempotency-Key", key).send(NUSRAT_TRIP);
    const second = await agent
      .post("/api/v1/ride-requests")
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
