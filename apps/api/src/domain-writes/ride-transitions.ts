import { and, eq } from "drizzle-orm";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Tx } from "../db/client.js";
import { rideRequests, rideStatusHistory } from "../db/schema.js";
import { rideTransition, type RideCommand, type RideStatus } from "../domain/ride-state-machine.js";
import { HttpError } from "../http/error-mapper.js";
import type { Locked } from "./locked.js";

// The *only* function allowed to change `ride_requests.status` (plan §10.7).
// No repository in this codebase exposes a generic `updateStatus`; every
// caller — passenger cancel today, pool commands in a later session — goes
// through here so a history row and the status change can never drift apart.

const TIMESTAMP_COLUMN: Partial<Record<RideStatus, "matchedAt" | "startedAt" | "completedAt" | "cancelledAt">> = {
  MATCHED: "matchedAt",
  STARTED: "startedAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
  // DRIVER_ARRIVED has no ride-level timestamp column — it's tracked on the
  // pool (`pools.arrivedAt`); the ride's history row is the record of it.
};

function transitionError(
  error: "INVALID_TRANSITION" | "REQUEST_NOT_OPEN" | "CANCELLATION_NOT_ALLOWED",
  currentStatus: RideStatus,
  command: RideCommand,
): HttpError {
  const messages = {
    INVALID_TRANSITION: "The ride has moved on — refreshing.",
    REQUEST_NOT_OPEN: "This ride was already matched or cancelled.",
    CANCELLATION_NOT_ALLOWED: "Your ride has already started and can't be cancelled.",
  } as const;
  return new HttpError(409, ERROR_CODES[error], messages[error], { currentStatus, command });
}

export type LockedRideRequestForTransition = Locked<{ id: string; status: RideStatus }>;

export async function applyRideTransition(
  tx: Tx,
  lockedRequest: LockedRideRequestForTransition,
  command: RideCommand,
  actorUserId: string | null,
  reason?: string,
): Promise<typeof rideRequests.$inferSelect> {
  const result = rideTransition(lockedRequest.status, command);
  if (!result.allowed) {
    throw transitionError(result.error, lockedRequest.status, command);
  }

  const timestampColumn = TIMESTAMP_COLUMN[result.to];
  const values: Partial<typeof rideRequests.$inferInsert> = {
    status: result.to,
    ...(timestampColumn ? { [timestampColumn]: new Date() } : {}),
    ...(result.to === "CANCELLED" ? { cancelReason: reason ?? null, cancelledBy: actorUserId } : {}),
  };

  // Conditional on the from-status the lock actually saw (plan §10.7): under
  // the row lock this can never fail, but it turns any future locking
  // mistake into a clean 409 instead of a silently wrong write.
  const updated = await tx
    .update(rideRequests)
    .set(values)
    .where(and(eq(rideRequests.id, lockedRequest.id), eq(rideRequests.status, lockedRequest.status)))
    .returning();

  const updatedRow = updated[0];
  if (!updatedRow) {
    throw transitionError("INVALID_TRANSITION", lockedRequest.status, command);
  }

  await tx.insert(rideStatusHistory).values({
    rideRequestId: lockedRequest.id,
    fromStatus: lockedRequest.status,
    toStatus: result.to,
    actorUserId,
    reason: reason ?? null,
  });

  return updatedRow;
}
