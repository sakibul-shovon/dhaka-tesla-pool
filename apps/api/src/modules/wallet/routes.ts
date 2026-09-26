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
import { createLockOrderGuard } from "../../lib/lock-order.js";
import {
  findWalletBalance,
  insertWalletTransaction,
  listWalletTransactions,
  lockOrCreateWallet,
  toWalletTransactionDTO,
  updateWalletBalance,
} from "./repository.js";
import { topupWalletSchema } from "./schemas.js";

const ROUTE = { topup: "/api/v1/wallet/topup" } as const;

function validationError(details: Record<string, unknown>): HttpError {
  return new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request.", details);
}

export function walletRouter(db: Db): Router {
  const router = Router();
  const requireAuth = authenticate(db);
  const requirePassenger = requireRole("PASSENGER");

  router.get("/", requireAuth, requirePassenger, async (req, res, next) => {
    try {
      const balancePaisa = await findWalletBalance(db, req.user!.id);
      sendData(res, 200, { balancePaisa });
    } catch (err) {
      next(err);
    }
  });

  router.get("/transactions", requireAuth, requirePassenger, async (req, res, next) => {
    try {
      const rows = await listWalletTransactions(db, req.user!.id, 20);
      sendData(res, 200, rows.map(toWalletTransactionDTO));
    } catch (err) {
      next(err);
    }
  });

  router.post("/topup", requireAuth, requirePassenger, async (req, res, next) => {
    try {
      const idempotencyKey = requireIdempotencyKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
      const parsed = topupWalletSchema.safeParse(req.body);
      if (!parsed.success) {
        next(validationError({ fields: parsed.error.flatten().fieldErrors }));
        return;
      }

      const userId = req.user!.id;
      const fingerprint = fingerprintRequest("POST", ROUTE.topup, parsed.data);

      const { replayed, status, body } = await runInTransaction(db, async (tx) => {
        const claim = await claimIdempotencyKey(tx, userId, {
          key: idempotencyKey,
          operation: "topupWallet",
          fingerprint,
        });
        if (claim.replayed) {
          return { replayed: true, status: claim.responseStatus, body: claim.responseBody };
        }

        const guard = createLockOrderGuard();
        const wallet = await lockOrCreateWallet(tx, userId, guard);
        const balancePaisa = wallet.balancePaisa + parsed.data.amountPaisa;
        await updateWalletBalance(tx, userId, balancePaisa);
        await insertWalletTransaction(tx, {
          walletUserId: userId,
          type: "TOPUP",
          amountPaisa: parsed.data.amountPaisa,
        });

        const dto = { balancePaisa };
        await finalizeIdempotencyKey(tx, userId, idempotencyKey, 200, dto);
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
