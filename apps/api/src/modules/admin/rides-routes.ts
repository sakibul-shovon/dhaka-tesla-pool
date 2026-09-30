import { Router } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { HttpError } from "../../http/error-mapper.js";
import { sendData, sendPage } from "../../http/response.js";
import { decodeCursor, encodeCursor } from "../../http/pagination.js";
import { authenticate } from "../../http/middleware/authenticate.js";
import { requireRole } from "../../http/middleware/role-guard.js";
import { listRideRequestsQuerySchema } from "../rides/schemas.js";
import {
  findRideRequestForAdmin,
  listAllRideRequests,
  listRideStatusHistory,
  toAdminRideRequestDTO,
  toHistoryDTO,
} from "../rides/repository.js";
import {
  findPoolSummaryForRideRequest,
  listAllMembers,
  toMemberDTO,
  toPoolSummaryDTO,
} from "../pools/repository.js";

// Express 5 types every param as `string | string[]` (path-to-regexp v8
// allows repeated segments); none of our routes do that, so a non-string
// here means the path didn't match — same 404 a missing ride gets.
function requireIdParam(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that ride.");
  }
  return value;
}

// Read-only, across every passenger (ADR-019) — the passenger's own
// GET /ride-requests only ever sees their own rows; this is the same table,
// unscoped, with the rider's identity attached rather than hidden.
export function adminRidesRouter(db: Db): Router {
  const router = Router();
  const requireAuth = authenticate(db);
  const requireAdmin = requireRole("ADMIN");

  router.get("/", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const parsed = listRideRequestsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        next(
          new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request.", {
            fields: parsed.error.flatten().fieldErrors,
          }),
        );
        return;
      }
      const { status, cursor, limit } = parsed.data;

      let decodedCursor: { createdAt: Date; id: string } | undefined;
      if (cursor) {
        const raw = decodeCursor(cursor);
        if (!raw) {
          next(
            new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request.", {
              fields: { cursor: ["Malformed cursor."] },
            }),
          );
          return;
        }
        decodedCursor = { createdAt: new Date(raw.createdAt), id: raw.id };
      }

      const rows = await listAllRideRequests(db, {
        limit,
        ...(status ? { status } : {}),
        ...(decodedCursor ? { cursor: decodedCursor } : {}),
      });

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

      sendPage(res, page.map(toAdminRideRequestDTO), { limit, nextCursor });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const id = requireIdParam(req.params.id);
      const ride = await findRideRequestForAdmin(db, id);
      if (!ride) {
        next(new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that ride."));
        return;
      }

      const [poolSummary, history] = await Promise.all([
        findPoolSummaryForRideRequest(db, id),
        listRideStatusHistory(db, id),
      ]);

      let pool = null;
      if (poolSummary) {
        const members = await listAllMembers(db, poolSummary.poolId);
        pool = { ...toPoolSummaryDTO(poolSummary), members: members.map(toMemberDTO) };
      }

      sendData(res, 200, {
        ...toAdminRideRequestDTO(ride),
        pool,
        history: history.map(toHistoryDTO),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
