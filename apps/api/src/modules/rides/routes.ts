import { Router } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { computeFare } from "../../domain/fare.js";
import { manhattanDistanceDkm } from "../../domain/geography.js";
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
import {
  RIDE_REQUESTS_ACTIVE_PER_PASSENGER_INDEX,
  findActiveRideRequestId,
  insertCreationHistory,
  insertRideRequest,
  toRideRequestDTO,
} from "./repository.js";
import { createRideRequestSchema } from "./schemas.js";

const ROUTE = {
  create: "/api/v1/ride-requests",
} as const;

function validationError(details: Record<string, unknown>): HttpError {
  return new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request.", details);
}

function activeRideExistsError(rideRequestId: string | undefined): HttpError {
  return new HttpError(409, ERROR_CODES.ACTIVE_RIDE_EXISTS, "You already have a ride in progress.", {
    rideRequestId,
  });
}

export function ridesRouter(db: Db): Router {
  const router = Router();
  const requireAuth = authenticate(db);
  const requirePassenger = requireRole("PASSENGER");

  router.post("/", requireAuth, requirePassenger, async (req, res, next) => {
    try {
      const idempotencyKey = requireIdempotencyKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
      const parsed = createRideRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        next(validationError({ fields: parsed.error.flatten().fieldErrors }));
        return;
      }

      const passengerId = req.user!.id;
      const fingerprint = fingerprintRequest("POST", ROUTE.create, parsed.data);

      const { replayed, status, body } = await runInTransaction(db, async (tx) => {
        const claim = await claimIdempotencyKey(tx, passengerId, {
          key: idempotencyKey,
          operation: "createRideRequest",
          fingerprint,
        });
        if (claim.replayed) {
          return { replayed: true, status: claim.responseStatus, body: claim.responseBody };
        }

        const existingId = await findActiveRideRequestId(tx, passengerId);
        if (existingId) {
          throw activeRideExistsError(existingId);
        }

        const { pickupZone, dropoffZone, seats, paymentMethod } = parsed.data;
        const distanceDkm = manhattanDistanceDkm(pickupZone, dropoffZone);
        const fare = computeFare(distanceDkm, seats);

        let created;
        try {
          created = await insertRideRequest(tx, {
            passengerId,
            pickupZone,
            dropoffZone,
            seats,
            distanceDkm,
            soloFarePaisa: fare.soloFarePaisa,
            pooledFarePaisa: fare.pooledFarePaisa,
            paymentMethod,
          });
        } catch (err) {
          if (isUniqueViolation(err, RIDE_REQUESTS_ACTIVE_PER_PASSENGER_INDEX)) {
            throw activeRideExistsError(await findActiveRideRequestId(tx, passengerId));
          }
          throw err;
        }

        await insertCreationHistory(tx, created.id, passengerId);

        const dto = toRideRequestDTO(created);
        await finalizeIdempotencyKey(tx, passengerId, idempotencyKey, 201, dto);
        return { replayed: false, status: 201, body: dto };
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
