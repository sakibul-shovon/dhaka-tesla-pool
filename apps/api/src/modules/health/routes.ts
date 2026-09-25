import { Router } from "express";
import type { Pool } from "pg";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import { sendData } from "../../http/response.js";

// /healthz = process is up, no DB (what Render pings — plan §18.3 K13/K6).
// /readyz = DB reachable (what Compose and humans use to gate startup).
export function healthRouter(pool: Pool): Router {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    sendData(res, 200, { status: "ok" });
  });

  router.get("/readyz", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      sendData(res, 200, { status: "ready" });
    } catch {
      res.status(503).json({
        error: {
          code: ERROR_CODES.SERVICE_UNAVAILABLE,
          message: "Database is unreachable.",
          requestId: req.id,
        },
      });
    }
  });

  return router;
}
