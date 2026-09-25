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

describe("auth happy path", () => {
  it("registers, logs in, reads /me and logs out", async () => {
    const app = buildTestApp(pool, logger);
    const agent = request.agent(app);
    const email = uniqueEmail();

    const registerRes = await agent
      .post("/api/v1/auth/register")
      .send({ name: "Test Passenger", email, password: "correct horse battery" });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.data).toMatchObject({ name: "Test Passenger", email, role: "PASSENGER" });
    expect(registerRes.body.data).not.toHaveProperty("passwordHash");

    const loginRes = await agent
      .post("/api/v1/auth/login")
      .send({ email, password: "correct horse battery" });
    expect(loginRes.status).toBe(200);
    expect(loginRes.headers["set-cookie"]?.[0]).toContain("dtp_session=");

    const meRes = await agent.get("/api/v1/auth/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.email).toBe(email);

    const logoutRes = await agent.post("/api/v1/auth/logout");
    expect(logoutRes.status).toBe(204);
  });

  it("rejects /me without a session", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects /logout without a session", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app).post("/api/v1/auth/logout");
    expect(res.status).toBe(401);
  });
});
