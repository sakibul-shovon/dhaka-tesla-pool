import { Router } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { manhattanDistanceDkm } from "../../domain/geography.js";
import { computeFare } from "../../domain/fare.js";
import { HttpError } from "../../http/error-mapper.js";
import { sendData } from "../../http/response.js";
import { authenticate } from "../../http/middleware/authenticate.js";
import { requireRole } from "../../http/middleware/role-guard.js";
import { tripInputSchema } from "./schemas.js";

export function faresRouter(db: Db): Router {
  const router = Router();
  const requireAuth = authenticate(db);
  const requirePassenger = requireRole("PASSENGER");

  router.post("/", requireAuth, requirePassenger, (req, res, next) => {
    const parsed = tripInputSchema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request body.", {
          fields: parsed.error.flatten().fieldErrors,
        }),
      );
      return;
    }

    const { pickupZone, dropoffZone, seats } = parsed.data;
    const distanceDkm = manhattanDistanceDkm(pickupZone, dropoffZone);
    const breakdown = computeFare(distanceDkm, seats);

    sendData(res, 200, {
      distanceDkm,
      soloFarePaisa: breakdown.soloFarePaisa,
      pooledFarePaisa: breakdown.pooledFarePaisa,
      breakdown,
    });
  });

  return router;
}
