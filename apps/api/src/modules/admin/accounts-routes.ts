import { Router } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { HttpError } from "../../http/error-mapper.js";
import { sendData } from "../../http/response.js";
import { authenticate } from "../../http/middleware/authenticate.js";
import { requireRole } from "../../http/middleware/role-guard.js";
import { changeAccountStatus } from "./account-status.js";
import { accountStatusChangeSchema } from "./schemas.js";
import type { AccountAfterTransition } from "../../domain-writes/account-transitions.js";

function toAccountDTO(row: AccountAfterTransition) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
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

// The user directory and detail views (GET /admin/users, GET /admin/users/:id)
// land in a later commit; this router starts with the one write action
// ADR-019 scopes the panel to.
export function adminAccountsRouter(db: Db): Router {
  const router = Router();
  const requireAuth = authenticate(db);
  const requireAdmin = requireRole("ADMIN");

  router.post("/:id/suspend", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const parsed = accountStatusChangeSchema.safeParse(req.body);
      if (!parsed.success) {
        next(
          new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request body.", {
            fields: parsed.error.flatten().fieldErrors,
          }),
        );
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
        next(
          new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request body.", {
            fields: parsed.error.flatten().fieldErrors,
          }),
        );
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
