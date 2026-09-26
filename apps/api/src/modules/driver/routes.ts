import { Router } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { HttpError } from "../../http/error-mapper.js";
import { authenticate } from "../../http/middleware/authenticate.js";
import { requireRole } from "../../http/middleware/role-guard.js";
import { sendData } from "../../http/response.js";
import {
  claimIdempotencyKey,
  finalizeIdempotencyKey,
  fingerprintRequest,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  requireIdempotencyKey,
} from "../../lib/idempotency.js";
import { isUniqueViolation } from "../../lib/pg-errors.js";
import { runInTransaction } from "../../lib/transaction.js";
import { createLockOrderGuard, lockRideRequestsByIds, lockVehicleByDriverId } from "../../lib/lock-order.js";
import { markLocked } from "../../domain-writes/locked.js";
import {
  findOpenPoolForVehicle,
  findPoolByIdForDriver,
  insertPool,
  insertPoolCreationHistory,
  listUnreleasedMembers,
  lockPoolForDriver,
  toPoolDTO,
} from "../pools/repository.js";
import { reserveSeat } from "../pools/seat-reservation.js";
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

const ROUTE = {
  accept: "/api/v1/driver/requests/:id/accept",
} as const;

// Express 5 types every param as `string | string[]` (path-to-regexp v8
// allows repeated segments); none of our routes do that, so a non-string
// here means the path genuinely didn't match — same 404 a missing row gets
// (mirrors modules/rides/routes.ts's requireIdParam).
function requireIdParam(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that ride.");
  }
  return value;
}

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

  // Creates the driver's pool on the first accept, extends it on later ones
  // (plan §10.4's acceptRideRequest script) — always under the vehicle lock,
  // which is what actually serializes two accepts from the same driver.
  router.post("/requests/:id/accept", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const idempotencyKey = requireIdempotencyKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
      const rideRequestId = requireIdParam(req.params.id);
      const driverId = req.user!.id;
      const fingerprint = fingerprintRequest("POST", ROUTE.accept, {});

      const { replayed, status, body } = await runInTransaction(db, async (tx) => {
        const claim = await claimIdempotencyKey(tx, driverId, {
          key: idempotencyKey,
          operation: "acceptRideRequest",
          fingerprint,
        });
        if (claim.replayed) {
          return { replayed: true, status: claim.responseStatus, body: claim.responseBody };
        }

        const guard = createLockOrderGuard();
        const lockedVehicle = await lockVehicleByDriverId(tx, driverId, guard);
        if (!lockedVehicle) {
          throw noVehicleError();
        }
        if (!lockedVehicle.isOnline || !lockedVehicle.currentZone) {
          throw new HttpError(409, ERROR_CODES.DRIVER_OFFLINE, "Go online before accepting a ride.");
        }

        const existingOpen = await findOpenPoolForVehicle(tx, lockedVehicle.id);
        const lockedPool = existingOpen
          ? await lockPoolForDriver(tx, existingOpen.id, driverId, guard)
          : await (async () => {
              guard.assert("pool");
              try {
                const created = await insertPool(tx, {
                  vehicleId: lockedVehicle.id,
                  driverId,
                  pickupZone: lockedVehicle.currentZone!,
                  capacitySnapshot: lockedVehicle.capacity,
                });
                await insertPoolCreationHistory(tx, created.id, driverId);
                return markLocked(created);
              } catch (err) {
                if (isUniqueViolation(err, "pools_active_per_vehicle")) {
                  throw new HttpError(409, ERROR_CODES.POOL_NOT_ACCEPTING, "This Tesla is no longer taking passengers.");
                }
                throw err;
              }
            })();
        if (!lockedPool) {
          throw new HttpError(409, ERROR_CODES.POOL_NOT_ACCEPTING, "This Tesla is no longer taking passengers.");
        }

        const [lockedRequest] = await lockRideRequestsByIds(tx, [rideRequestId], guard);
        if (!lockedRequest) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that ride.");
        }
        if (lockedRequest.pickupZone !== lockedVehicle.currentZone) {
          throw new HttpError(409, ERROR_CODES.ZONE_MISMATCH, "That request isn't in your current zone.");
        }

        const existingMembers = await listUnreleasedMembers(tx, lockedPool.id);
        const { membershipId } = await reserveSeat(tx, {
          lockedPool,
          lockedRequest,
          members: existingMembers.map((m) => ({ dropoffZone: m.dropoffZone })),
          command: "accept",
          actorUserId: driverId,
        });

        // A plain read-back for the response, not a lock: the mutation
        // already happened under the lock above; re-locking here would
        // violate the guard (we've since locked the later "requests" stage).
        const freshPool = await findPoolByIdForDriver(tx, lockedPool.id, driverId);
        const dto = { pool: toPoolDTO(freshPool!), membershipId };
        await finalizeIdempotencyKey(tx, driverId, idempotencyKey, 200, dto);
        return { replayed: false, status: 200, body: dto };
      });

      if (replayed) {
        res.setHeader(IDEMPOTENT_REPLAYED_HEADER, "true");
      }
      sendData(res, status, body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
