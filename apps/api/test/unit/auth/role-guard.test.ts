import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { requireRole } from "../../../src/http/middleware/role-guard.js";
import { errorMapper } from "../../../src/http/error-mapper.js";
import type { AuthenticatedUser } from "../../../src/modules/auth/session-service.js";

function appAsUser(user: AuthenticatedUser | undefined) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.get("/driver-only", requireRole("DRIVER"), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorMapper);
  return app;
}

const driver: AuthenticatedUser = {
  id: "1",
  name: "Jashim",
  email: "jashim@dhakateslapool.test",
  role: "DRIVER",
  status: "ACTIVE",
};
const passenger: AuthenticatedUser = { ...driver, id: "2", role: "PASSENGER" };

describe("requireRole", () => {
  it("allows a matching role through", async () => {
    const res = await request(appAsUser(driver)).get("/driver-only");
    expect(res.status).toBe(200);
  });

  it("rejects a passenger on a driver-only route", async () => {
    const res = await request(appAsUser(passenger)).get("/driver-only");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(appAsUser(undefined)).get("/driver-only");
    expect(res.status).toBe(403);
  });
});
