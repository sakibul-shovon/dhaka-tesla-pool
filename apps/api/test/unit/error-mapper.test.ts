import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { errorMapper, HttpError } from "../../src/http/error-mapper.js";

function appThatThrows(err: unknown) {
  const app = express();
  app.get("/boom", () => {
    throw err;
  });
  app.use(errorMapper);
  return app;
}

describe("errorMapper", () => {
  it("maps a known HttpError to its status and code", async () => {
    const res = await request(appThatThrows(new HttpError(404, "NOT_FOUND", "ride not found"))).get("/boom");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "NOT_FOUND", message: "ride not found" });
  });

  it("answers 503 with Retry-After when the database can't be reached", async () => {
    // What pg-pool throws when no connection is free within
    // connectionTimeoutMillis: a Neon database that is still waking up.
    const res = await request(
      appThatThrows(new Error("timeout exceeded when trying to connect to 10.0.0.7:5432")),
    ).get("/boom");

    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(JSON.stringify(res.body)).not.toContain("10.0.0.7");
  });

  it("recognises a refused connection wrapped as the cause of another error", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const res = await request(appThatThrows(new Error("Failed query", { cause: refused }))).get("/boom");

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("hides internals for an unexpected error", async () => {
    const res = await request(appThatThrows(new Error("internal db field value: hunter2"))).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
    expect(res.body.error).not.toHaveProperty("stack");
  });
});
