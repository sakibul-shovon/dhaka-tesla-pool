import { Router } from "express";
import type { Pool } from "pg";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import { sendData } from "../../http/response.js";

const READY_TIMEOUT_MS = 1000;

// /healthz = process is up, no DB (what Render pings — plan §18.3 K13/K6).
// /readyz = DB reachable (what Compose and humans use to gate startup).
export function healthRouter(pool: Pool): Router {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    sendData(res, 200, { status: "ok" });
  });

  router.get("/readyz", async (req, res) => {
    // Readiness must answer fast (Compose's healthcheck gives it 3s), but the
    // pool now waits up to 10s for a connection, so cap the check itself.
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        pool.query("SELECT 1"),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("readiness check timed out")), READY_TIMEOUT_MS);
        }),
      ]);
      sendData(res, 200, { status: "ready" });
    } catch {
      res.status(503).json({
        error: {
          code: ERROR_CODES.SERVICE_UNAVAILABLE,
          message: "Database is unreachable.",
          requestId: req.id,
        },
      });
    } finally {
      clearTimeout(timer);
    }
  });

  return router;
}
