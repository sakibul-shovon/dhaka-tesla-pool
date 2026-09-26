import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { buildTestApp } from "../support/build-test-app.js";
import { runSeed } from "../../src/db/seed/index.js";
import { testDatabaseUrl } from "../support/db.js";

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

describe("registration validation", () => {
  it("rejects a duplicate email", async () => {
    const app = buildTestApp(pool, logger);
    const email = uniqueEmail();
    const body = { name: "First", email, password: "correct horse battery" };

    await request(app).post("/api/v1/auth/register").send(body);
    const second = await request(app).post("/api/v1/auth/register").send(body);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects a role field instead of silently ignoring it", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Attacker", email: uniqueEmail(), password: "correct horse battery", role: "DRIVER" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a password shorter than 8 characters", async () => {
    const app = buildTestApp(pool, logger);
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Short", email: uniqueEmail(), password: "short" });

    expect(res.status).toBe(400);
  });
});

describe("login failure modes", () => {
  it("gives the same generic error for a wrong password and an unknown email", async () => {
    const app = buildTestApp(pool, logger);
    const email = uniqueEmail();
    await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Real User", email, password: "correct horse battery" });

    const wrongPassword = await request(app).post("/api/v1/auth/login").send({ email, password: "not it" });
    const unknownEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: uniqueEmail(), password: "not it" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it("rejects login for a suspended user", async () => {
    const app = buildTestApp(pool, logger);
    const email = uniqueEmail();
    await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Suspended", email, password: "correct horse battery" });
    await pool.query(`UPDATE users SET status = 'SUSPENDED' WHERE lower(email) = lower($1)`, [email]);

    const res = await request(app).post("/api/v1/auth/login").send({ email, password: "correct horse battery" });

    expect(res.status).toBe(401);
  });

  it("rejects reusing a session after logout", async () => {
    const app = buildTestApp(pool, logger);
    const agent = request.agent(app);
    const email = uniqueEmail();
    await agent
      .post("/api/v1/auth/register")
      .send({ name: "Logout Test", email, password: "correct horse battery" });
    await agent.post("/api/v1/auth/login").send({ email, password: "correct horse battery" });

    await agent.post("/api/v1/auth/logout");
    const meAfterLogout = await agent.get("/api/v1/auth/me");

    expect(meAfterLogout.status).toBe(401);
  });

  it("rate limits repeated login attempts for the same (IP, email)", async () => {
    const app = buildTestApp(pool, logger);
    const email = uniqueEmail();
    await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Rate Limited", email, password: "correct horse battery" });

    const attempts = [];
    for (let i = 0; i < 6; i += 1) {
      attempts.push(await request(app).post("/api/v1/auth/login").send({ email, password: "wrong" }));
    }

    const statuses = attempts.map((res) => res.status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
    expect(attempts[5]!.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("seeded demo cast", () => {
  it("lets Nusrat and Jashim log in with the seeded demo password", async () => {
    const demoPassword = "dhaka-tesla-demo-test";
    await runSeed(testDatabaseUrl(), demoPassword);
    const app = buildTestApp(pool, logger);

    const nusrat = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nusrat@dhakateslapool.test", password: demoPassword });
    const jashim = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "jashim@dhakateslapool.test", password: demoPassword });
    const admin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@dhakateslapool.test", password: demoPassword });

    expect(nusrat.status).toBe(200);
    expect(nusrat.body.data.role).toBe("PASSENGER");
    expect(jashim.status).toBe(200);
    expect(jashim.body.data.role).toBe("DRIVER");
    expect(admin.status).toBe(200);
    expect(admin.body.data.role).toBe("ADMIN");
  });
});
