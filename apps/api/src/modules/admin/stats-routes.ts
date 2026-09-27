import { Router } from "express";
import type { Db } from "../../db/client.js";
import { sendData } from "../../http/response.js";
import { authenticate } from "../../http/middleware/authenticate.js";
import { requireRole } from "../../http/middleware/role-guard.js";
import { getAdminStats } from "./repository.js";

export function adminStatsRouter(db: Db): Router {
  const router = Router();
  const requireAuth = authenticate(db);
  const requireAdmin = requireRole("ADMIN");

  router.get("/", requireAuth, requireAdmin, async (_req, res, next) => {
    try {
      const stats = await getAdminStats(db);
      sendData(res, 200, stats);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
