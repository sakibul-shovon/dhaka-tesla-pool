import { and, eq } from "drizzle-orm";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Tx } from "../db/client.js";
import { users, accountStatusHistory } from "../db/schema.js";
import { accountTransition, type AccountCommand } from "../domain/account-state-machine.js";
import { HttpError } from "../http/error-mapper.js";
import type { LockedUser } from "../lib/lock-order.js";

// The *only* function allowed to change `users.status` (plan §10.7, ADR-019)
// — mirrors applyRideTransition/applyPoolTransition exactly, so a history row
// and the status change can never drift apart here either.

function transitionError(currentStatus: LockedUser["status"], command: AccountCommand): HttpError {
  const message =
    currentStatus === "SUSPENDED"
      ? "This account is already suspended."
      : "This account is already active.";
  return new HttpError(409, ERROR_CODES.INVALID_TRANSITION, message, { currentStatus, command });
}

export interface AccountAfterTransition {
  id: string;
  name: string;
  email: string;
  role: "PASSENGER" | "DRIVER" | "ADMIN";
  status: LockedUser["status"];
  createdAt: Date;
}

const RETURN_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  status: users.status,
  createdAt: users.createdAt,
} as const;

export async function applyAccountTransition(
  tx: Tx,
  lockedUser: LockedUser,
  command: AccountCommand,
  actorUserId: string,
  reason?: string | undefined,
): Promise<AccountAfterTransition> {
  const result = accountTransition(lockedUser.status, command);
  if (!result.allowed) {
    throw transitionError(lockedUser.status, command);
  }

  // Conditional on the from-status the lock actually saw (plan §10.7): under
  // the row lock this can never fail, but it turns any future locking
  // mistake into a clean 409 instead of a silently wrong write.
  const updated = await tx
    .update(users)
    .set({ status: result.to, updatedAt: new Date() })
    .where(and(eq(users.id, lockedUser.id), eq(users.status, lockedUser.status)))
    .returning(RETURN_COLUMNS);

  const updatedRow = updated[0];
  if (!updatedRow) {
    throw transitionError(lockedUser.status, command);
  }

  await tx.insert(accountStatusHistory).values({
    userId: lockedUser.id,
    fromStatus: lockedUser.status,
    toStatus: result.to,
    actorUserId,
    reason: reason ?? null,
  });

  return updatedRow;
}
