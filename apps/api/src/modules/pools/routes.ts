import { Router } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { applyPoolTransition } from "../../domain-writes/pool-transitions.js";
import { applyRideTransition } from "../../domain-writes/ride-transitions.js";
import { HttpError } from "../../http/error-mapper.js";
import { authenticate } from "../../http/middleware/authenticate.js";
import { requireRole } from "../../http/middleware/role-guard.js";
import { decodeCursor, encodeCursor } from "../../http/pagination.js";
import { sendData, sendPage } from "../../http/response.js";
import { createLockOrderGuard, lockRideRequestsByIds } from "../../lib/lock-order.js";
import { runInTransaction } from "../../lib/transaction.js";
import {
  findActivePoolForDriver,
  findMembershipInPool,
  findPoolByIdForDriver,
  listActiveMembers,
  listAllMembers,
  listPoolsForDriver,
  listPoolStatusHistory,
  listUnreleasedMembers,
  lockPoolForDriver,
  markMembershipDroppedOff,
  releaseMembership,
  setMembershipFinalFare,
  sumEarningsPaisa,
  toMemberDTO,
  toPoolDTO,
  toPoolHistoryDTO,
  updatePoolSeatsReserved,
  type PoolRow,
} from "./repository.js";
import { cancelPoolSchema } from "./schemas.js";
import { insertWalletTransaction, lockOrCreateWallet, updateWalletBalance } from "../wallet/repository.js";

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

async function refetchPoolDTO(db: Db, poolId: string, driverId: string) {
  const fresh = await findPoolByIdForDriver(db, poolId, driverId);
  return toPoolDTO(fresh as PoolRow);
}

export function poolsRouter(db: Db): Router {
  const router = Router();
  const requireAuth = authenticate(db);
  const requireDriver = requireRole("DRIVER");

  router.get("/active", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const active = await findActivePoolForDriver(db, req.user!.id);
      if (!active) {
        sendData(res, 200, null);
        return;
      }
      const members = await listAllMembers(db, active.id);
      sendData(res, 200, { pool: toPoolDTO(active), members: members.map(toMemberDTO) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
      const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 50 ? limitRaw : 20;

      let cursor: { createdAt: Date; id: string } | undefined;
      if (typeof req.query.cursor === "string") {
        const raw = decodeCursor(req.query.cursor);
        if (!raw) {
          next(validationError({ fields: { cursor: ["Malformed cursor."] } }));
          return;
        }
        cursor = { createdAt: new Date(raw.createdAt), id: raw.id };
      }

      const rows = await listPoolsForDriver(db, { driverId: req.user!.id, limit, ...(cursor ? { cursor } : {}) });
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

      const withEarnings = await Promise.all(
        page.map(async (row) => ({ ...toPoolDTO(row), earningsPaisa: await sumEarningsPaisa(db, row.id) })),
      );
      sendPage(res, withEarnings, { limit, nextCursor });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const poolId = requireIdParam(req.params.id);
      const poolRow = await findPoolByIdForDriver(db, poolId, req.user!.id);
      if (!poolRow) {
        next(poolNotFoundError());
        return;
      }
      const members = await listAllMembers(db, poolRow.id);
      sendData(res, 200, { pool: toPoolDTO(poolRow), members: members.map(toMemberDTO) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/history", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const poolId = requireIdParam(req.params.id);
      const poolRow = await findPoolByIdForDriver(db, poolId, req.user!.id);
      if (!poolRow) {
        next(poolNotFoundError());
        return;
      }
      const history = await listPoolStatusHistory(db, poolRow.id);
      sendData(res, 200, history.map(toPoolHistoryDTO));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/arrive", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const poolId = requireIdParam(req.params.id);
      const driverId = req.user!.id;

      await runInTransaction(db, async (tx) => {
        const guard = createLockOrderGuard();
        const lockedPool = await lockPoolForDriver(tx, poolId, driverId, guard);
        if (!lockedPool) {
          throw poolNotFoundError();
        }
        const members = await listUnreleasedMembers(tx, lockedPool.id);
        if (members.length === 0) {
          throw new HttpError(409, ERROR_CODES.POOL_EMPTY, "No passengers on board.");
        }
        const lockedRequests = await lockRideRequestsByIds(tx, members.map((m) => m.rideRequestId), guard);
        await applyPoolTransition(tx, lockedPool, "arrive", driverId);
        for (const lockedRequest of lockedRequests) {
          await applyRideTransition(tx, lockedRequest, "arrive", driverId);
        }
      });

      sendData(res, 200, await refetchPoolDTO(db, poolId, driverId));
    } catch (err) {
      next(err);
    }
  });

  // Fares fix here (plan §8.2): each unreleased member gets pooledFare if
  // there are >= 2 of them, else soloFare — decided once, under the same
  // lock that moves the pool to STARTED, and never revisited.
  router.post("/:id/start", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const poolId = requireIdParam(req.params.id);
      const driverId = req.user!.id;

      await runInTransaction(db, async (tx) => {
        const guard = createLockOrderGuard();
        const lockedPool = await lockPoolForDriver(tx, poolId, driverId, guard);
        if (!lockedPool) {
          throw poolNotFoundError();
        }
        const members = await listUnreleasedMembers(tx, lockedPool.id);
        if (members.length === 0) {
          throw new HttpError(409, ERROR_CODES.POOL_EMPTY, "No passengers on board.");
        }
        const lockedRequests = await lockRideRequestsByIds(tx, members.map((m) => m.rideRequestId), guard);
        await applyPoolTransition(tx, lockedPool, "start", driverId);

        const shared = members.length >= 2;
        for (const member of members) {
          await setMembershipFinalFare(
            tx,
            member.membershipId,
            shared ? member.pooledFarePaisa : member.soloFarePaisa,
            shared,
          );
        }
        for (const lockedRequest of lockedRequests) {
          await applyRideTransition(tx, lockedRequest, "start", driverId);
        }
      });

      sendData(res, 200, await refetchPoolDTO(db, poolId, driverId));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/memberships/:mid/drop-off", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const poolId = requireIdParam(req.params.id);
      const membershipId = requireIdParam(req.params.mid);
      const driverId = req.user!.id;

      await runInTransaction(db, async (tx) => {
        const guard = createLockOrderGuard();
        const lockedPool = await lockPoolForDriver(tx, poolId, driverId, guard);
        if (!lockedPool) {
          throw poolNotFoundError();
        }
        const membership = await findMembershipInPool(tx, poolId, membershipId);
        if (!membership || membership.releasedAt) {
          throw poolNotFoundError();
        }
        const [lockedRequest] = await lockRideRequestsByIds(tx, [membership.rideRequestId], guard);
        if (!lockedRequest) {
          throw poolNotFoundError();
        }

        // `dropOff` is only legal from STARTED in the ride table itself, so
        // "drop-off before start" and "drop-off twice" both 409 here with
        // no extra pool-status check needed (C8).
        await applyRideTransition(tx, lockedRequest, "dropOff", driverId);
        await markMembershipDroppedOff(tx, membershipId);

        // TeslaPay debit (plan §8.4) — wallet locked last, after pool and
        // request, per the global lock order. finalFarePaisa is guaranteed
        // set: dropOff is only reachable from STARTED, and start is what
        // fixes it. WALLET_TRANSACTIONS_RIDE_REQUEST_TYPE_UNIQUE is the
        // backstop against a double debit; dropOff's own one-shot state
        // transition already makes a second attempt unreachable in practice.
        if (membership.paymentMethod === "TESLAPAY") {
          const wallet = await lockOrCreateWallet(tx, lockedRequest.passengerId, guard);
          await updateWalletBalance(tx, lockedRequest.passengerId, wallet.balancePaisa - membership.finalFarePaisa!);
          await insertWalletTransaction(tx, {
            walletUserId: lockedRequest.passengerId,
            type: "DEBIT",
            amountPaisa: membership.finalFarePaisa!,
            rideRequestId: membership.rideRequestId,
          });
        }

        const stillRiding = await listActiveMembers(tx, lockedPool.id);
        if (stillRiding.length === 0) {
          await applyPoolTransition(tx, lockedPool, "complete", driverId);
        }
      });

      sendData(res, 200, await refetchPoolDTO(db, poolId, driverId));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/memberships/:mid/no-show", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const poolId = requireIdParam(req.params.id);
      const membershipId = requireIdParam(req.params.mid);
      const driverId = req.user!.id;

      await runInTransaction(db, async (tx) => {
        const guard = createLockOrderGuard();
        const lockedPool = await lockPoolForDriver(tx, poolId, driverId, guard);
        if (!lockedPool) {
          throw poolNotFoundError();
        }
        const membership = await findMembershipInPool(tx, poolId, membershipId);
        if (!membership || membership.releasedAt) {
          throw poolNotFoundError();
        }
        const [lockedRequest] = await lockRideRequestsByIds(tx, [membership.rideRequestId], guard);
        if (!lockedRequest) {
          throw poolNotFoundError();
        }

        // Only legal from DRIVER_ARRIVED in the ride table (plan A12: "only
        // after arrival") — no separate pool-status check needed either.
        await applyRideTransition(tx, lockedRequest, "markNoShow", driverId);
        await releaseMembership(tx, membershipId);
        await updatePoolSeatsReserved(tx, lockedPool.id, lockedPool.seatsReserved - membership.seats);

        const stillUnreleased = await listUnreleasedMembers(tx, lockedPool.id);
        if (stillUnreleased.length === 0) {
          await applyPoolTransition(tx, lockedPool, "emptyCancel", driverId, "EMPTY");
        }
      });

      sendData(res, 200, await refetchPoolDTO(db, poolId, driverId));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/cancel", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const poolId = requireIdParam(req.params.id);
      const driverId = req.user!.id;
      const parsed = cancelPoolSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        next(validationError({ fields: parsed.error.flatten().fieldErrors }));
        return;
      }

      await runInTransaction(db, async (tx) => {
        const guard = createLockOrderGuard();
        const lockedPool = await lockPoolForDriver(tx, poolId, driverId, guard);
        if (!lockedPool) {
          throw poolNotFoundError();
        }
        const members = await listUnreleasedMembers(tx, lockedPool.id);
        const lockedRequests =
          members.length > 0 ? await lockRideRequestsByIds(tx, members.map((m) => m.rideRequestId), guard) : [];

        await applyPoolTransition(tx, lockedPool, "cancelPool", driverId, parsed.data.reason);
        for (const lockedRequest of lockedRequests) {
          await applyRideTransition(tx, lockedRequest, "cancelPool", driverId, parsed.data.reason ?? "DRIVER_CANCELLED");
        }
        for (const member of members) {
          await releaseMembership(tx, member.membershipId);
        }
        if (members.length > 0) {
          await updatePoolSeatsReserved(tx, lockedPool.id, 0);
        }
      });

      sendData(res, 200, await refetchPoolDTO(db, poolId, driverId));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
