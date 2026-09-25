import { Router } from "express";
import type { Db } from "../../db/client.js";
import { sendData } from "../../http/response.js";
import { listZones } from "./repository.js";

// Public — no auth (plan §13.2 authorization matrix: zones ✅ for everyone).
export function zonesRouter(db: Db): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const zones = await listZones(db);
      sendData(res, 200, zones);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
