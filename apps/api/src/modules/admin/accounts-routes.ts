import { Router } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { HttpError } from "../../http/error-mapper.js";
import { sendData, sendPage } from "../../http/response.js";
import { decodeCursor, encodeCursor } from "../../http/pagination.js";
import { authenticate } from "../../http/middleware/authenticate.js";
import { requireRole } from "../../http/middleware/role-guard.js";
import { changeAccountStatus } from "./account-status.js";
import { accountStatusChangeSchema, listUsersQuerySchema } from "./schemas.js";
import {
  findAccountById,
  listAccounts,
  listAccountStatusHistory,
  toAccountStatusHistoryDTO,
} from "./repository.js";
import { findVehicleByDriverId } from "../driver/repository.js";
import { listPoolsForDriver, sumEarningsPaisa, toPoolDTO } from "../pools/repository.js";
import { listRideRequestsForPassenger, toRideRequestDTO } from "../rides/repository.js";
import {
  findWalletBalance,
  listWalletTransactions,
  toWalletTransactionDTO,
} from "../wallet/repository.js";

// The two write actions and the read-only directory/detail share this
// shape (id/name/email/role/status/createdAt) — never `password_hash`
// (plan §13.1 API8) — regardless of which repository or domain-writes
// function produced the row.
function toAccountDTO(row: {
  id: string;
  name: string;
  email: string;
  role: "PASSENGER" | "DRIVER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function validationError(fields: Record<string, string[] | undefined>): HttpError {
  return new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request body.", { fields });
}

// Express 5 types every param as `string | string[]` (path-to-regexp v8
// allows repeated segments); none of our routes do that, so a non-string
// here means the path didn't match — same 404 a missing user gets.
function requireIdParam(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that user.");
  }
  return value;
}

function notFoundError(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that user.");
}

export function adminAccountsRouter(db: Db): Router {
  const router = Router();
  const requireAuth = authenticate(db);
  const requireAdmin = requireRole("ADMIN");

  router.get("/", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const parsed = listUsersQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        next(validationError(parsed.error.flatten().fieldErrors));
        return;
      }
      const { role, status, q, cursor, limit } = parsed.data;

      let decodedCursor: { createdAt: Date; id: string } | undefined;
      if (cursor) {
        const raw = decodeCursor(cursor);
        if (!raw) {
          next(validationError({ cursor: ["Malformed cursor."] }));
          return;
        }
        decodedCursor = { createdAt: new Date(raw.createdAt), id: raw.id };
      }

      const rows = await listAccounts(db, {
        limit,
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
        ...(q ? { q } : {}),
        ...(decodedCursor ? { cursor: decodedCursor } : {}),
      });

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

      sendPage(res, page.map(toAccountDTO), { limit, nextCursor });
    } catch (err) {
      next(err);
    }
  });

  // Role-specific detail, read-only (ADR-019): recent rides + wallet for a
  // passenger, vehicle + recent pools with earnings for a driver, the
  // account's own status history for either. An admin viewing another admin
  // gets just the base profile — there's nothing else to show.
  router.get("/:id", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const userId = requireIdParam(req.params.id);
      const account = await findAccountById(db, userId);
      if (!account) {
        next(notFoundError());
        return;
      }

      const statusHistory = await listAccountStatusHistory(db, userId);

      let passenger = null;
      let driver = null;

      if (account.role === "PASSENGER") {
        const [rides, balancePaisa, transactions] = await Promise.all([
          listRideRequestsForPassenger(db, { passengerId: userId, limit: 10 }),
          findWalletBalance(db, userId),
          listWalletTransactions(db, userId, 10),
        ]);
        passenger = {
          recentRides: rides.map(toRideRequestDTO),
          wallet: { balancePaisa, transactions: transactions.map(toWalletTransactionDTO) },
        };
      } else if (account.role === "DRIVER") {
        const vehicle = await findVehicleByDriverId(db, userId);
        const pools = await listPoolsForDriver(db, { driverId: userId, limit: 10 });
        const recentPools = await Promise.all(
          pools.map(async (row) => ({
            ...toPoolDTO(row),
            earningsPaisa: await sumEarningsPaisa(db, row.id),
          })),
        );
        driver = {
          vehicle: vehicle
            ? {
                id: vehicle.id,
                name: vehicle.name,
                capacity: vehicle.capacity,
                isOnline: vehicle.isOnline,
                currentZone: vehicle.currentZone,
              }
            : null,
          recentPools,
        };
      }

      sendData(res, 200, {
        ...toAccountDTO(account),
        statusHistory: statusHistory.map(toAccountStatusHistoryDTO),
        passenger,
        driver,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/suspend", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const parsed = accountStatusChangeSchema.safeParse(req.body);
      if (!parsed.success) {
        next(validationError(parsed.error.flatten().fieldErrors));
        return;
      }
      const updated = await changeAccountStatus(db, {
        targetUserId: requireIdParam(req.params.id),
        actorUserId: req.user!.id,
        command: "suspend",
        reason: parsed.data.reason,
      });
      sendData(res, 200, toAccountDTO(updated));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/reactivate", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const parsed = accountStatusChangeSchema.safeParse(req.body);
      if (!parsed.success) {
        next(validationError(parsed.error.flatten().fieldErrors));
        return;
      }
      const updated = await changeAccountStatus(db, {
        targetUserId: requireIdParam(req.params.id),
        actorUserId: req.user!.id,
        command: "reactivate",
        reason: parsed.data.reason,
      });
      sendData(res, 200, toAccountDTO(updated));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
