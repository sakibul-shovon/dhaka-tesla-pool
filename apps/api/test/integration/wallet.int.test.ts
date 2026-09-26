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

function topup(app: App, cookie: string, amountPaisa: number, key = randomUUID()) {
  return request(app).post("/api/v1/wallet/topup").set("Cookie", cookie).set("Idempotency-Key", key).send({ amountPaisa });
}

describe("GET /wallet", () => {
  it("returns a zero balance for a passenger who has never used TeslaPay", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db, "Nusrat");

    const res = await request(app).get("/api/v1/wallet").set("Cookie", nusrat.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ balancePaisa: 0 });
  });
});

describe("POST /wallet/topup (plan §8.4)", () => {
  it("increases the balance and records a TOPUP transaction", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db, "Nusrat");

    const res = await topup(app, nusrat.cookie, 50_000);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ balancePaisa: 50_000 });

    const second = await topup(app, nusrat.cookie, 30_000);
    expect(second.body.data).toEqual({ balancePaisa: 80_000 });

    const list = await request(app).get("/api/v1/wallet/transactions").set("Cookie", nusrat.cookie);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.every((t: { type: string }) => t.type === "TOPUP")).toBe(true);
  });

  it("rejects a top-up over the ৳2,000 cap", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db, "Nusrat");

    const res = await topup(app, nusrat.cookie, 200_001);
    expect(res.status).toBe(400);
  });

  it("rejects a zero or negative top-up", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db, "Nusrat");

    expect((await topup(app, nusrat.cookie, 0)).status).toBe(400);
    expect((await topup(app, nusrat.cookie, -100)).status).toBe(400);
  });

  it("replays the same response for a repeated idempotency key", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db, "Nusrat");
    const key = randomUUID();

    const first = await topup(app, nusrat.cookie, 50_000, key);
    const second = await topup(app, nusrat.cookie, 50_000, key);

    expect(second.body.data).toEqual(first.body.data);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body.data.balancePaisa).toBe(50_000);
  });
});
