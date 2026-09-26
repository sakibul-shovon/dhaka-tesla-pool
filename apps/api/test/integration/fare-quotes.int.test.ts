import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import type { Pool } from "pg";
import { createTestPool, testDatabaseUrl } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { buildTestApp } from "../support/build-test-app.js";
import { runSeed } from "../../src/db/seed/index.js";

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

async function registerAndLogin(app: ReturnType<typeof buildTestApp>) {
  const agent = request.agent(app);
  const email = uniqueEmail();
  await agent.post("/api/v1/auth/register").send({ name: "Nusrat", email, password: "correct horse battery" });
  await agent.post("/api/v1/auth/login").send({ email, password: "correct horse battery" });
  return agent;
}

describe("GET /zones (plan §7.1, public)", () => {
  it("lists all 10 zones without authentication", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app).get("/api/v1/zones");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data).toContainEqual({ code: "BANANI", name: expect.any(String), xDkm: 0, yDkm: 0 });
  });
});

describe("POST /fare-quotes (plan §8, §12.2)", () => {
  it("rejects an anonymous caller", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app)
      .post("/api/v1/fare-quotes")
      .send({ pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1 });

    expect(res.status).toBe(401);
  });

  it("rejects a driver caller", async () => {
    const demoPassword = "dhaka-tesla-demo-test";
    await runSeed(testDatabaseUrl(), demoPassword);
    const app = buildTestApp(pool, logger);
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/login").send({ email: "jashim@dhakateslapool.test", password: demoPassword });

    const res = await agent
      .post("/api/v1/fare-quotes")
      .send({ pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1 });

    expect(res.status).toBe(403);
  });

  it("quotes Nusrat's Banani -> Mohakhali trip at ৳67.50 solo / ৳54.00 pooled (plan §8.3)", async () => {
    const app = buildTestApp(pool, logger);
    const agent = await registerAndLogin(app);

    const res = await agent
      .post("/api/v1/fare-quotes")
      .send({ pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.distanceDkm).toBe(25);
    expect(res.body.data.soloFarePaisa).toBe(6750);
    expect(res.body.data.pooledFarePaisa).toBe(5400);
  });

  it("rejects a quote with the same pickup and drop-off zone", async () => {
    const app = buildTestApp(pool, logger);
    const agent = await registerAndLogin(app);

    const res = await agent
      .post("/api/v1/fare-quotes")
      .send({ pickupZone: "BANANI", dropoffZone: "BANANI", seats: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a quote for an unknown zone", async () => {
    const app = buildTestApp(pool, logger);
    const agent = await registerAndLogin(app);

    const res = await agent
      .post("/api/v1/fare-quotes")
      .send({ pickupZone: "BANANI", dropoffZone: "ATLANTIS", seats: 1 });

    expect(res.status).toBe(400);
  });

  it("rejects more than 3 seats — the product cap, not the DB's wider physical range (plan A23)", async () => {
    const app = buildTestApp(pool, logger);
    const agent = await registerAndLogin(app);

    const res = await agent
      .post("/api/v1/fare-quotes")
      .send({ pickupZone: "BANANI", dropoffZone: "MOHAKHALI", seats: 4 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});
