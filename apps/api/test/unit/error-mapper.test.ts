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

  it("hides internals for an unexpected error", async () => {
    const res = await request(appThatThrows(new Error("internal db field value: hunter2"))).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
    expect(res.body.error).not.toHaveProperty("stack");
  });
});
