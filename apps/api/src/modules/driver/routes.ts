import { Router } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { HttpError } from "../../http/error-mapper.js";
import { authenticate } from "../../http/middleware/authenticate.js";
import { requireRole } from "../../http/middleware/role-guard.js";
import { sendData } from "../../http/response.js";
import { runInTransaction } from "../../lib/transaction.js";
import { createLockOrderGuard, lockVehicleByDriverId } from "../../lib/lock-order.js";
import {
  findActivePoolForVehicle,
  findVehicleByDriverId,
  listRelevantRequestsForDriver,
  listUnreleasedMemberDropoffs,
  setVehicleOffline,
  setVehicleOnline,
  type VehicleRow,
} from "./repository.js";
import { goOnlineSchema } from "./schemas.js";

function noVehicleError(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, "No Tesla is registered for this driver.");
}

function toVehicleStatusDTO(vehicle: VehicleRow, activePoolId: string | null) {
  return {
    vehicleId: vehicle.id,
    name: vehicle.name,
    capacity: vehicle.capacity,
    isOnline: vehicle.isOnline,
    currentZone: vehicle.currentZone,
    activePoolId,
  };
}

function toRequestSummaryDTO(row: {
  id: string;
  pickupZone: string;
  dropoffZone: string;
  seats: number;
  distanceDkm: number;
  soloFarePaisa: number;
  pooledFarePaisa: number;
  createdAt: Date;
}) {
  return {
    id: row.id,
    pickupZone: row.pickupZone,
    dropoffZone: row.dropoffZone,
    seats: row.seats,
    distanceDkm: row.distanceDkm,
    soloFarePaisa: row.soloFarePaisa,
    pooledFarePaisa: row.pooledFarePaisa,
    createdAt: row.createdAt.toISOString(),
  };
}

export function driverRouter(db: Db): Router {
  const router = Router();
  const requireAuth = authenticate(db);
  const requireDriver = requireRole("DRIVER");

  router.get("/status", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const vehicle = await findVehicleByDriverId(db, req.user!.id);
      if (!vehicle) {
        next(noVehicleError());
        return;
      }
      const activePool = await findActivePoolForVehicle(db, vehicle.id);
      sendData(res, 200, toVehicleStatusDTO(vehicle, activePool?.id ?? null));
    } catch (err) {
      next(err);
    }
  });

  router.post("/go-online", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const parsed = goOnlineSchema.safeParse(req.body);
      if (!parsed.success) {
        next(
          new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request body.", {
            fields: parsed.error.flatten().fieldErrors,
          }),
        );
        return;
      }

      const driverId = req.user!.id;
      const updated = await runInTransaction(db, async (tx) => {
        const guard = createLockOrderGuard();
        const locked = await lockVehicleByDriverId(tx, driverId, guard);
        if (!locked) {
          throw noVehicleError();
        }
        return setVehicleOnline(tx, locked.id, parsed.data.zone);
      });

      sendData(res, 200, toVehicleStatusDTO(updated, null));
    } catch (err) {
      next(err);
    }
  });

  router.post("/go-offline", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const driverId = req.user!.id;
      const updated = await runInTransaction(db, async (tx) => {
        const guard = createLockOrderGuard();
        const locked = await lockVehicleByDriverId(tx, driverId, guard);
        if (!locked) {
          throw noVehicleError();
        }
        const activePool = await findActivePoolForVehicle(tx, locked.id);
        if (activePool) {
          throw new HttpError(
            409,
            ERROR_CODES.DRIVER_HAS_ACTIVE_POOL,
            "Finish or cancel the active pool before going offline.",
            { poolId: activePool.id },
          );
        }
        return setVehicleOffline(tx, locked.id);
      });

      sendData(res, 200, toVehicleStatusDTO(updated, null));
    } catch (err) {
      next(err);
    }
  });

  router.get("/requests", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const vehicle = await findVehicleByDriverId(db, req.user!.id);
      if (!vehicle) {
        next(noVehicleError());
        return;
      }
      if (!vehicle.isOnline || !vehicle.currentZone) {
        next(new HttpError(409, ERROR_CODES.DRIVER_OFFLINE, "Go online to see nearby requests."));
        return;
      }

      const activePool = await findActivePoolForVehicle(db, vehicle.id);
      const openPool = activePool
        ? { ...activePool, members: await listUnreleasedMemberDropoffs(db, activePool.id) }
        : undefined;

      const relevant = await listRelevantRequestsForDriver(db, vehicle.currentZone, openPool);
      sendData(res, 200, relevant.map(toRequestSummaryDTO));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
