import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { buildTestApp } from "../support/build-test-app.js";
import { createDb, type Db } from "../../src/db/client.js";
import { passengerContext } from "../support/auth-fixtures.js";
import { assertInvariants } from "../support/assert-invariants.js";

let pool: Pool;
let db: Db;
const logger = pino({ level: "silent" });

beforeAll(() => {
  pool = createTestPool({ max: 10 });
  db = createDb(pool);
});

afterEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

const TRIP = { pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1, paymentMethod: "CASH" as const };

// C12 (plan §10.6, §11): the idempotency claim's INSERT is itself the lock —
// a second request for the same (user, key) genuinely blocks on the unique
// index until the first transaction commits, then replays the committed
// response (idempotency.ts's own stated design). Firing both at once through
// real concurrent HTTP calls exercises that lock-wait directly, rather than
// simulating it.
describe("C12 — retry racing the original request (plan §10.6, §11)", () => {
  it("two concurrent identical requests: exactly one real create, the other replays it", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const key = randomUUID();

    const [a, b] = await Promise.all([
      request(app).post("/api/v1/ride-requests").set("Cookie", nusrat.cookie).set("Idempotency-Key", key).send(TRIP),
      request(app).post("/api/v1/ride-requests").set("Cookie", nusrat.cookie).set("Idempotency-Key", key).send(TRIP),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data).toEqual(b.body.data);

    const replayFlags = [a.headers["idempotent-replayed"], b.headers["idempotent-replayed"]];
    expect(replayFlags.filter((f) => f === "true")).toHaveLength(1);
    expect(replayFlags.filter((f) => f === undefined)).toHaveLength(1);

    const { rows } = await pool.query(`SELECT id FROM ride_requests`);
    expect(rows).toHaveLength(1);
    expect(await assertInvariants(pool)).toEqual([]);
  });
});

// C13 (plan §10.6, §11): a client that never saw the first response (timeout,
// dropped connection) retries after the original already committed — the
// replay must still be exact, and still no duplicate row.
describe("C13 — retry after the original already committed (plan §10.6, §11)", () => {
  it("a later identical request replays the committed response instead of creating a second row", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const key = randomUUID();

    const first = await request(app)
      .post("/api/v1/ride-requests")
      .set("Cookie", nusrat.cookie)
      .set("Idempotency-Key", key)
      .send(TRIP);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/v1/ride-requests")
      .set("Cookie", nusrat.cookie)
      .set("Idempotency-Key", key)
      .send(TRIP);

    expect(second.status).toBe(201);
    expect(second.body.data).toEqual(first.body.data);
    expect(second.headers["idempotent-replayed"]).toBe("true");

    const { rows } = await pool.query(`SELECT id FROM ride_requests`);
    expect(rows).toHaveLength(1);
    expect(await assertInvariants(pool)).toEqual([]);
  });
});
