import { Router } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { HttpError } from "../../http/error-mapper.js";
import { sendData } from "../../http/response.js";
import { authenticate } from "../../http/middleware/authenticate.js";
import { requireRole } from "../../http/middleware/role-guard.js";
import { hashPassword } from "../auth/password-service.js";
import { findUserByEmail } from "../auth/repository.js";
import { createDriverWithVehicle, listDrivers, type DriverSummary } from "./repository.js";
import { createDriverSchema } from "./schemas.js";

function toDriverDTO(row: DriverSummary) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    vehicle: {
      id: row.vehicleId,
      name: row.vehicleName,
      capacity: row.capacity,
      isOnline: row.isOnline,
      currentZone: row.currentZone,
    },
  };
}

// Admin-only: create/list driver accounts (plan A3 reversal — see
// IMPLEMENTATION_PLAN.md's authorization matrix). No idempotency key, same
// as /auth/register — a low-frequency admin action, not a concurrency-
// sensitive booking path.
export function adminDriversRouter(db: Db): Router {
  const router = Router();
  const requireAuth = authenticate(db);
  const requireAdmin = requireRole("ADMIN");

  router.get("/", requireAuth, requireAdmin, async (_req, res, next) => {
    try {
      const drivers = await listDrivers(db);
      sendData(res, 200, drivers.map(toDriverDTO));
    } catch (err) {
      next(err);
    }
  });

  router.post("/", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const parsed = createDriverSchema.safeParse(req.body);
      if (!parsed.success) {
        next(
          new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request body.", {
            fields: parsed.error.flatten().fieldErrors,
          }),
        );
        return;
      }

      const existing = await findUserByEmail(db, parsed.data.email);
      if (existing) {
        next(new HttpError(409, ERROR_CODES.EMAIL_TAKEN, "That email already has an account."));
        return;
      }

      const passwordHash = await hashPassword(parsed.data.password);
      const driver = await createDriverWithVehicle(db, {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        vehicleName: parsed.data.vehicleName,
        capacity: parsed.data.capacity,
        zone: parsed.data.zone,
      });
      sendData(res, 201, toDriverDTO(driver));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
