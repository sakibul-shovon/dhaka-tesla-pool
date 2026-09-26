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
import { runInTransaction } from "../../lib/transaction.js";
import { createLockOrderGuard, lockPoolById } from "../../lib/lock-order.js";
import { lockRideRequestForOwner, toRideRequestDTO, findRideRequestByOwner } from "../rides/repository.js";
import { reserveSeat } from "./seat-reservation.js";
import { findPoolSummaryForRideRequest, listUnreleasedMembers, toPoolSummaryDTO } from "./repository.js";
import { joinPoolSchema } from "./schemas.js";

const ROUTE = {
  join: "/api/v1/pools/:id/join",
} as const;

function poolNotFoundError(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that pool.");
}

function requireIdParam(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw poolNotFoundError();
  }
  return value;
}

function validationError(details: Record<string, unknown>): HttpError {
  return new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request.", details);
}

// The passenger-initiated half of pooling (plan §9.3, §12.2): a passenger
// joins an *existing* OPEN pool directly, as opposed to a driver accepting
// their request (feature/driver-flow). Both paths converge on the same
// `reserveSeat` (plan §7.2) so a race between the two can never disagree
// about capacity or compatibility.
export function passengerPoolsRouter(db: Db): Router {
  const router = Router();
  const requireAuth = authenticate(db);
  const requirePassenger = requireRole("PASSENGER");

  router.post("/:id/join", requireAuth, requirePassenger, async (req, res, next) => {
    try {
      const idempotencyKey = requireIdempotencyKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
      const poolId = requireIdParam(req.params.id);
      const passengerId = req.user!.id;
      const parsed = joinPoolSchema.safeParse(req.body);
      if (!parsed.success) {
        next(validationError({ fields: parsed.error.flatten().fieldErrors }));
        return;
      }
      const fingerprint = fingerprintRequest("POST", ROUTE.join, parsed.data);

      const { replayed, status, body } = await runInTransaction(db, async (tx) => {
        const claim = await claimIdempotencyKey(tx, passengerId, {
          key: idempotencyKey,
          operation: "joinPool",
          fingerprint,
        });
        if (claim.replayed) {
          return { replayed: true, status: claim.responseStatus, body: claim.responseBody };
        }

        // Lock order (plan §10.2): pool -> requests. No vehicle lock here —
        // unlike accept, joining never creates or resizes a pool.
        const guard = createLockOrderGuard();
        const lockedPool = await lockPoolById(tx, poolId, guard);
        if (!lockedPool) {
          throw poolNotFoundError();
        }

        const lockedRequest = await lockRideRequestForOwner(tx, parsed.data.rideRequestId, passengerId, guard);
        if (!lockedRequest) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that ride.");
        }

        const members = await listUnreleasedMembers(tx, lockedPool.id);
        await reserveSeat(tx, {
          lockedPool,
          lockedRequest,
          members: members.map((m) => ({ dropoffZone: m.dropoffZone })),
          command: "join",
          actorUserId: passengerId,
        });

        const updatedRide = await findRideRequestByOwner(tx, lockedRequest.id, passengerId);
        const poolSummary = await findPoolSummaryForRideRequest(tx, lockedRequest.id);
        const dto = {
          ...toRideRequestDTO(updatedRide!),
          pool: poolSummary ? toPoolSummaryDTO(poolSummary) : null,
        };
        await finalizeIdempotencyKey(tx, passengerId, idempotencyKey, 200, dto);
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
