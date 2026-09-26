import { Router } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { computeFare } from "../../domain/fare.js";
import { manhattanDistanceDkm } from "../../domain/geography.js";
import { canJoin } from "../../domain/matching.js";
import { applyRideTransition } from "../../domain-writes/ride-transitions.js";
import { HttpError } from "../../http/error-mapper.js";
import { authenticate } from "../../http/middleware/authenticate.js";
import { requireRole } from "../../http/middleware/role-guard.js";
import { decodeCursor, encodeCursor } from "../../http/pagination.js";
import { sendData, sendPage } from "../../http/response.js";
import { firstNameOf } from "../../lib/names.js";
import { logBusinessEvent } from "../../lib/business-events.js";
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
import { createLockOrderGuard, lockPoolById } from "../../lib/lock-order.js";
import { applyPoolTransition } from "../../domain-writes/pool-transitions.js";
import { findWalletBalance } from "../wallet/repository.js";
import {
  findMembershipByRideRequestId,
  findPoolSummaryForRideRequest,
  listOpenPoolsInZone,
  releaseMembership,
  toPoolSummaryDTO,
  updatePoolSeatsReserved,
  listUnreleasedMembers,
} from "../pools/repository.js";
import {
  RIDE_REQUESTS_ACTIVE_PER_PASSENGER_INDEX,
  findActiveRideRequestId,
  findRideRequestByOwner,
  insertCreationHistory,
  insertRideRequest,
  listRideRequestsForPassenger,
  listRideStatusHistory,
  lockRideRequestForOwner,
  toHistoryDTO,
  toRideRequestDTO,
} from "./repository.js";
import { cancelRideRequestSchema, createRideRequestSchema, listRideRequestsQuerySchema } from "./schemas.js";

// Signals "the membership situation changed between the unlocked read and
// the lock" (plan §10.4) — caught only inside the cancel handler's own retry
// loop below, never surfaced past it.
class StaleCancelMembershipError extends Error {}
const MAX_CANCEL_ATTEMPTS = 3;

const ROUTE = {
  create: "/api/v1/ride-requests",
  cancel: "/api/v1/ride-requests/:id/cancel",
} as const;

function validationError(details: Record<string, unknown>): HttpError {
  return new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request.", details);
}

function activeRideExistsError(rideRequestId: string | undefined): HttpError {
  return new HttpError(409, ERROR_CODES.ACTIVE_RIDE_EXISTS, "You already have a ride in progress.", {
    rideRequestId,
  });
}

// Express 5's ParamsDictionary types every param as `string | string[]`
// (path-to-regexp v8 allows repeated segments); none of our routes do that,
// so a non-string here means the path genuinely didn't match — same 404 a
// missing ride gets, no existence oracle either way.
function requireIdParam(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that ride.");
  }
  return value;
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

        // Gated against the solo fare — the ceiling, since the eventual
        // pooled fare can only be lower (plan §8.4). A plain read is safe
        // here: a passenger can have at most one active request at a time
        // (RIDE_REQUESTS_ACTIVE_PER_PASSENGER_INDEX), so there's no way for
        // two of these checks to race each other for the same balance.
        if (paymentMethod === "TESLAPAY") {
          const balancePaisa = await findWalletBalance(tx, passengerId);
          if (balancePaisa < fare.soloFarePaisa) {
            throw new HttpError(409, ERROR_CODES.INSUFFICIENT_BALANCE, "Not enough TeslaPay balance for this trip.", {
              balancePaisa,
              requiredPaisa: fare.soloFarePaisa,
            });
          }
        }

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
      } else {
        logBusinessEvent(req.log, "ride.requested", { rideRequestId: (body as { id: string }).id });
      }
      sendData(res, status, body);
    } catch (err) {
      next(err);
    }
  });

  router.get("/", requireAuth, requirePassenger, async (req, res, next) => {
    try {
      const parsed = listRideRequestsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        next(validationError({ fields: parsed.error.flatten().fieldErrors }));
        return;
      }
      const { status, cursor, limit } = parsed.data;

      let decodedCursor: { createdAt: Date; id: string } | undefined;
      if (cursor) {
        const raw = decodeCursor(cursor);
        if (!raw) {
          next(validationError({ fields: { cursor: ["Malformed cursor."] } }));
          return;
        }
        decodedCursor = { createdAt: new Date(raw.createdAt), id: raw.id };
      }

      const rows = await listRideRequestsForPassenger(db, {
        passengerId: req.user!.id,
        limit,
        ...(status ? { status } : {}),
        ...(decodedCursor ? { cursor: decodedCursor } : {}),
      });

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

      sendPage(res, page.map(toRideRequestDTO), { limit, nextCursor });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", requireAuth, requirePassenger, async (req, res, next) => {
    try {
      const ride = await findRideRequestByOwner(db, requireIdParam(req.params.id), req.user!.id);
      if (!ride) {
        next(new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that ride."));
        return;
      }
      const poolSummary = await findPoolSummaryForRideRequest(db, ride.id);
      sendData(res, 200, { ...toRideRequestDTO(ride), pool: poolSummary ? toPoolSummaryDTO(poolSummary) : null });
    } catch (err) {
      next(err);
    }
  });

  // Compatible OPEN pools for this request (plan §12.2's pool-offers, §7.2's
  // matching rule) — not locked, since this is a read-only preview: the real
  // check happens under lock at join time, and a stale offer just becomes a
  // 409 the client refetches from (plan's C-table "offer disappears before
  // Join").
  router.get("/:id/pool-offers", requireAuth, requirePassenger, async (req, res, next) => {
    try {
      const ride = await findRideRequestByOwner(db, requireIdParam(req.params.id), req.user!.id);
      if (!ride) {
        next(new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that ride."));
        return;
      }
      if (ride.status !== "REQUESTED") {
        next(new HttpError(409, ERROR_CODES.REQUEST_NOT_OPEN, "This ride was already matched or cancelled."));
        return;
      }

      const candidates = await listOpenPoolsInZone(db, ride.pickupZone);
      const offers = [];
      for (const candidate of candidates) {
        const members = await listUnreleasedMembers(db, candidate.poolId);
        const capacityRemaining = candidate.capacitySnapshot - candidate.seatsReserved;
        const match = canJoin(
          { status: "OPEN", pickupZone: candidate.pickupZone, capacityRemaining },
          { status: ride.status, seats: ride.seats, pickupZone: ride.pickupZone, dropoffZone: ride.dropoffZone },
          members.map((m) => ({ dropoffZone: m.dropoffZone })),
        );
        if (match.compatible) {
          offers.push({
            poolId: candidate.poolId,
            vehicleName: candidate.vehicleName,
            driverFirstName: firstNameOf(candidate.driverName),
            seatsLeft: capacityRemaining,
            sharedWithCount: members.length,
            soloFarePaisa: ride.soloFarePaisa,
            pooledFarePaisa: ride.pooledFarePaisa,
          });
        }
      }
      sendData(res, 200, offers);
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/history", requireAuth, requirePassenger, async (req, res, next) => {
    try {
      const ride = await findRideRequestByOwner(db, requireIdParam(req.params.id), req.user!.id);
      if (!ride) {
        next(new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that ride."));
        return;
      }
      const history = await listRideStatusHistory(db, ride.id);
      sendData(res, 200, history.map(toHistoryDTO));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/cancel", requireAuth, requirePassenger, async (req, res, next) => {
    try {
      const idempotencyKey = requireIdempotencyKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
      const parsed = cancelRideRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        next(validationError({ fields: parsed.error.flatten().fieldErrors }));
        return;
      }

      const passengerId = req.user!.id;
      const rideRequestId = requireIdParam(req.params.id);
      const fingerprint = fingerprintRequest("POST", ROUTE.cancel, parsed.data);

      let replayed = false;
      let status = 0;
      let body: unknown;

      for (let attempt = 1; ; attempt++) {
        try {
          ({ replayed, status, body } = await runInTransaction(db, async (tx) => {
            const claim = await claimIdempotencyKey(tx, passengerId, {
              key: idempotencyKey,
              operation: "cancelRideRequest",
              fingerprint,
            });
            if (claim.replayed) {
              return { replayed: true, status: claim.responseStatus, body: claim.responseBody };
            }

            // Plan §10.4's cancelRideRequest script: read the (unlocked)
            // membership first only to learn whether a pool needs locking,
            // then lock pool -> requests, respecting the global order (plan
            // §10.2) — never the other way around.
            const membership = await findMembershipByRideRequestId(tx, rideRequestId);
            const guard = createLockOrderGuard();
            const lockedPool =
              membership && !membership.releasedAt ? await lockPoolById(tx, membership.poolId, guard) : undefined;

            const locked = await lockRideRequestForOwner(tx, rideRequestId, passengerId, guard);
            if (!locked) {
              throw new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that ride.");
            }

            // Re-verify under lock (plan §10.4: "if its membership != poolId
            // read earlier -> ROLLBACK, restart"). A concurrent accept/join
            // can create a membership for this exact ride in the gap
            // between the unlocked read above and this point, or a
            // concurrent driver action can release the one we saw — either
            // way, `lockedPool`/`membership` would then be stale, and acting
            // on them would skip the cleanup a newly matched (or newly
            // freed) seat needs. Once we hold the ride request's own lock,
            // no other transaction can change its membership further, so
            // this second read is the true, stable answer.
            const freshMembership = await findMembershipByRideRequestId(tx, rideRequestId);
            const expectedPoolId = membership && !membership.releasedAt ? membership.poolId : undefined;
            const actualPoolId = freshMembership && !freshMembership.releasedAt ? freshMembership.poolId : undefined;
            if (expectedPoolId !== actualPoolId) {
              throw new StaleCancelMembershipError();
            }

            const updated = await applyRideTransition(tx, locked, "cancel", passengerId, parsed.data.reason);

            if (lockedPool && membership) {
              await releaseMembership(tx, membership.id);
              await updatePoolSeatsReserved(tx, lockedPool.id, lockedPool.seatsReserved - locked.seats);
              const stillUnreleased = await listUnreleasedMembers(tx, lockedPool.id);
              if (stillUnreleased.length === 0 && lockedPool.status !== "STARTED") {
                await applyPoolTransition(tx, lockedPool, "emptyCancel", passengerId, "EMPTY");
              }
            }

            const dto = toRideRequestDTO(updated);
            await finalizeIdempotencyKey(tx, passengerId, idempotencyKey, 200, dto);
            return { replayed: false, status: 200, body: dto };
          }));
          break;
        } catch (err) {
          if (err instanceof StaleCancelMembershipError) {
            if (attempt < MAX_CANCEL_ATTEMPTS) {
              continue;
            }
            throw new HttpError(503, ERROR_CODES.SERVICE_BUSY, "Busy right now — try again in a moment.", undefined, 1);
          }
          throw err;
        }
      }

      if (replayed) {
        res.setHeader(IDEMPOTENT_REPLAYED_HEADER, "true");
      } else {
        logBusinessEvent(req.log, "ride.cancelled", { rideRequestId });
      }
      sendData(res, status, body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
