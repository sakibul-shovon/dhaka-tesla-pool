import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { Pool } from "pg";
import { buildApp } from "../../src/app.js";

// No listener on this port: connection is refused immediately, so these
// tests are fast and deterministic without depending on DNS or a real DB.
const UNREACHABLE_DB_URL = "postgres://postgres@127.0.0.1:59999/nonexistent";

const logger = pino({ level: "silent" });
let pool: Pool;

afterEach(async () => {
  await pool?.end();
});

describe("health endpoints", () => {
  it("GET /api/v1/healthz is 200 even when the database is unreachable", async () => {
    pool = new Pool({ connectionString: UNREACHABLE_DB_URL, connectionTimeoutMillis: 500 });
    const app = buildApp({ pool, logger });

    const res = await request(app).get("/api/v1/healthz");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: "ok" } });
  });

  it("GET /api/v1/readyz is 503 when the database is unreachable", async () => {
    pool = new Pool({ connectionString: UNREACHABLE_DB_URL, connectionTimeoutMillis: 500 });
    const app = buildApp({ pool, logger });

    const res = await request(app).get("/api/v1/readyz");

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("echoes a valid X-Request-Id and rejects a malformed one by generating its own", async () => {
    pool = new Pool({ connectionString: UNREACHABLE_DB_URL, connectionTimeoutMillis: 500 });
    const app = buildApp({ pool, logger });
    const validId = "11111111-1111-1111-1111-111111111111";

    const echoed = await request(app).get("/api/v1/healthz").set("X-Request-Id", validId);
    const generated = await request(app).get("/api/v1/healthz").set("X-Request-Id", "not-a-uuid");

    expect(echoed.headers["x-request-id"]).toBe(validId);
    expect(generated.headers["x-request-id"]).not.toBe("not-a-uuid");
  });

  it("GET /api/v1/unknown-route is 404 with the shared error shape", async () => {
    pool = new Pool({ connectionString: UNREACHABLE_DB_URL, connectionTimeoutMillis: 500 });
    const app = buildApp({ pool, logger });

    const res = await request(app).get("/api/v1/unknown-route");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
