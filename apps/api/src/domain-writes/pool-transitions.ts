import { and, eq } from "drizzle-orm";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Tx } from "../db/client.js";
import { pools, poolStatusHistory } from "../db/schema.js";
import { poolTransition, type PoolCommand, type PoolStatus } from "../domain/pool-state-machine.js";
import { HttpError } from "../http/error-mapper.js";
import type { Locked } from "./locked.js";

// The *only* function allowed to change `pools.status` (plan §10.7) —
// applyRideTransition's sibling. No repository exposes a generic
// `updateStatus`; every caller goes through here so a pool history row and
// the status change can never drift apart.

const TIMESTAMP_COLUMN: Partial<Record<PoolStatus, "arrivedAt" | "startedAt" | "completedAt" | "cancelledAt">> = {
  DRIVER_ARRIVED: "arrivedAt",
  STARTED: "startedAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
};

export type LockedPoolForTransition = Locked<{ id: string; status: PoolStatus }>;

export async function applyPoolTransition(
  tx: Tx,
  lockedPool: LockedPoolForTransition,
  command: PoolCommand,
  actorUserId: string | null,
  reason?: string,
): Promise<typeof pools.$inferSelect> {
  const result = poolTransition(lockedPool.status, command);
  if (!result.allowed) {
    throw new HttpError(409, ERROR_CODES.INVALID_TRANSITION, "This pool has moved on — refreshing.", {
      currentStatus: lockedPool.status,
      command,
    });
  }

  const timestampColumn = TIMESTAMP_COLUMN[result.to];
  const values: Partial<typeof pools.$inferInsert> = {
    status: result.to,
    ...(timestampColumn ? { [timestampColumn]: new Date() } : {}),
  };

  // Conditional on the from-status the lock actually saw (plan §10.7): under
  // the row lock this can never fail, but it turns any future locking
  // mistake into a clean 409 instead of a silently wrong write.
  const updated = await tx
    .update(pools)
    .set(values)
    .where(and(eq(pools.id, lockedPool.id), eq(pools.status, lockedPool.status)))
    .returning();

  const updatedRow = updated[0];
  if (!updatedRow) {
    throw new HttpError(409, ERROR_CODES.INVALID_TRANSITION, "This pool has moved on — refreshing.", {
      currentStatus: lockedPool.status,
      command,
    });
  }

  await tx.insert(poolStatusHistory).values({
    poolId: lockedPool.id,
    fromStatus: lockedPool.status,
    toStatus: result.to,
    actorUserId,
    reason: reason ?? null,
  });

  return updatedRow;
}
