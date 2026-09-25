import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { originGuard } from "../../../src/http/middleware/origin-guard.js";
import { errorMapper } from "../../../src/http/error-mapper.js";

function appWithGuard() {
  const app = express();
  app.use(originGuard(["https://app.example.test"]));
  app.post("/thing", (_req, res) => res.status(200).json({ ok: true }));
  app.get("/thing", (_req, res) => res.status(200).json({ ok: true }));
  app.use(errorMapper);
  return app;
}

describe("originGuard", () => {
  it("allows a mutating request from an allow-listed origin", async () => {
    const res = await request(appWithGuard()).post("/thing").set("Origin", "https://app.example.test");
    expect(res.status).toBe(200);
  });

  it("rejects a mutating request from a different origin", async () => {
    const res = await request(appWithGuard()).post("/thing").set("Origin", "https://evil.test");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("allows a mutating request with no Origin header", async () => {
    const res = await request(appWithGuard()).post("/thing");
    expect(res.status).toBe(200);
  });

  it("never checks Origin on a GET", async () => {
    const res = await request(appWithGuard()).get("/thing").set("Origin", "https://evil.test");
    expect(res.status).toBe(200);
  });
});
