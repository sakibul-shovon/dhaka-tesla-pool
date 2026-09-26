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

function topup(app: App, cookie: string, amountPaisa: number, key = randomUUID()) {
  return request(app).post("/api/v1/wallet/topup").set("Cookie", cookie).set("Idempotency-Key", key).send({ amountPaisa });
}

describe("POST /ride-requests with paymentMethod TESLAPAY (plan §8.4)", () => {
  it("rejects a trip the wallet can't cover", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db, "Nusrat");
    await topup(app, nusrat.cookie, 1_000); // far less than any real fare

    const res = await request(app)
      .post("/api/v1/ride-requests")
      .set("Cookie", nusrat.cookie)
      .set("Idempotency-Key", randomUUID())
      .send({ pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1, paymentMethod: "TESLAPAY" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("accepts a trip the wallet can cover, without debiting yet", async () => {
    const app = buildTestApp(pool, logger);
    const nusrat = await passengerContext(pool, db, "Nusrat");
    await topup(app, nusrat.cookie, 100_000);

    const res = await request(app)
      .post("/api/v1/ride-requests")
      .set("Cookie", nusrat.cookie)
      .set("Idempotency-Key", randomUUID())
      .send({ pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1, paymentMethod: "TESLAPAY" });

    expect(res.status).toBe(201);

    const wallet = await request(app).get("/api/v1/wallet").set("Cookie", nusrat.cookie);
    expect(wallet.body.data.balancePaisa).toBe(100_000);
  });
});

describe("TeslaPay debit at drop-off (plan §8.4)", () => {
  it("debits exactly the fixed final fare, once, on drop-off", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");
    await topup(app, nusrat.cookie, 100_000);

    const created = await request(app)
      .post("/api/v1/ride-requests")
      .set("Cookie", nusrat.cookie)
      .set("Idempotency-Key", randomUUID())
      .send({ pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1, paymentMethod: "TESLAPAY" });
    const rideId = created.body.data.id as string;

    const accepted = await request(app)
      .post(`/api/v1/driver/requests/${rideId}/accept`)
      .set("Cookie", jashim.cookie)
      .set("Idempotency-Key", randomUUID())
      .send({});
    const poolId = accepted.body.data.pool.id as string;
    const membershipId = accepted.body.data.membershipId as string;

    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set("Cookie", jashim.cookie);

    const walletBeforeDropoff = await request(app).get("/api/v1/wallet").set("Cookie", nusrat.cookie);
    expect(walletBeforeDropoff.body.data.balancePaisa).toBe(100_000); // not yet debited

    await request(app)
      .post(`/api/v1/driver/pools/${poolId}/memberships/${membershipId}/drop-off`)
      .set("Cookie", jashim.cookie);

    // Solo fare for BANANI -> MOHAKHALI (25 dkm, 1 seat) is ৳67.50 = 6750 paisa.
    const walletAfter = await request(app).get("/api/v1/wallet").set("Cookie", nusrat.cookie);
    expect(walletAfter.body.data.balancePaisa).toBe(100_000 - 6_750);

    const { rows } = await pool.query<{ type: string; amount_paisa: number; ride_request_id: string }>(
      `SELECT type, amount_paisa, ride_request_id FROM wallet_transactions WHERE wallet_user_id = $1`,
      [nusrat.userId],
    );
    const debits = rows.filter((r) => r.type === "DEBIT");
    expect(debits).toHaveLength(1);
    expect(debits[0]!.amount_paisa).toBe(6_750);
    expect(debits[0]!.ride_request_id).toBe(rideId);
  });

  it("never debits a CASH rider's wallet", async () => {
    const app = buildTestApp(pool, logger);
    const jashim = await driverContext(pool, db, "Jashim", {
      name: "Bullet",
      capacity: 3,
      isOnline: true,
      currentZone: "BANANI",
    });
    const nusrat = await passengerContext(pool, db, "Nusrat");

    const created = await request(app)
      .post("/api/v1/ride-requests")
      .set("Cookie", nusrat.cookie)
      .set("Idempotency-Key", randomUUID())
      .send({ pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1, paymentMethod: "CASH" });
    const rideId = created.body.data.id as string;
    const accepted = await request(app)
      .post(`/api/v1/driver/requests/${rideId}/accept`)
      .set("Cookie", jashim.cookie)
      .set("Idempotency-Key", randomUUID())
      .send({});
    const poolId = accepted.body.data.pool.id as string;
    const membershipId = accepted.body.data.membershipId as string;
    await request(app).post(`/api/v1/driver/pools/${poolId}/arrive`).set("Cookie", jashim.cookie);
    await request(app).post(`/api/v1/driver/pools/${poolId}/start`).set("Cookie", jashim.cookie);
    await request(app)
      .post(`/api/v1/driver/pools/${poolId}/memberships/${membershipId}/drop-off`)
      .set("Cookie", jashim.cookie);

    const { rows } = await pool.query(`SELECT * FROM wallet_transactions`);
    expect(rows).toHaveLength(0);
  });
});
