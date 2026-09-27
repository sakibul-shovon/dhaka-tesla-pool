import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { isSuspendableRole, type AccountCommand } from "../../domain/account-state-machine.js";
import {
  applyAccountTransition,
  type AccountAfterTransition,
} from "../../domain-writes/account-transitions.js";
import { HttpError } from "../../http/error-mapper.js";
import { createLockOrderGuard, lockUserById, lockVehicleByDriverId } from "../../lib/lock-order.js";
import { runInTransaction } from "../../lib/transaction.js";
import { revokeAllSessionsForUser } from "../auth/session-service.js";
import { findActivePoolForVehicle, setVehicleOffline } from "../driver/repository.js";
import { findActiveRideRequestId } from "../rides/repository.js";

export interface AccountStatusChange {
  targetUserId: string;
  actorUserId: string;
  command: AccountCommand;
  reason?: string | undefined;
}

function notFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, "We couldn't find that user.");
}

// The admin panel's one write action (ADR-019). Suspension never changes a
// ride's or pool's state — it is refused while one is active instead, so the
// state machines and their concurrency tests stay untouched (A27).
export async function changeAccountStatus(
  db: Db,
  change: AccountStatusChange,
): Promise<AccountAfterTransition> {
  return runInTransaction(db, async (tx) => {
    const guard = createLockOrderGuard();

    // Vehicle first regardless of role (plan §10.2: vehicle before user) —
    // undefined for a passenger, the driver's own Tesla otherwise. Locking
    // unconditionally means the order is fixed by code shape, not by a
    // branch on a role we haven't looked up yet.
    const vehicle = await lockVehicleByDriverId(tx, change.targetUserId, guard);
    const target = await lockUserById(tx, change.targetUserId, guard);
    if (!target) {
      throw notFound();
    }
    if (!isSuspendableRole(target.role)) {
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        "Admin accounts can't be suspended from the panel.",
      );
    }

    if (change.command === "suspend") {
      if (target.role === "PASSENGER") {
        // A snapshot read, not a lock: a passenger request already past
        // authentication can still create one ride after this commits —
        // the bounded race ADR-019/A28 documents.
        const activeRideId = await findActiveRideRequestId(tx, target.id);
        if (activeRideId) {
          throw new HttpError(
            409,
            ERROR_CODES.ACTIVE_RIDE_EXISTS,
            "This passenger has a ride in progress — suspend once it's finished.",
            { rideRequestId: activeRideId },
          );
        }
      } else if (vehicle) {
        // Race-safe against accept: accept re-checks is_online under this
        // same vehicle lock (driver/routes.ts), so exactly one of
        // {accept, suspend} wins — never a suspended driver holding a pool.
        const activePool = await findActivePoolForVehicle(tx, vehicle.id);
        if (activePool) {
          throw new HttpError(
            409,
            ERROR_CODES.DRIVER_HAS_ACTIVE_POOL,
            "This driver has an active pool — suspend once it's finished.",
            { poolId: activePool.id },
          );
        }
        if (vehicle.isOnline) {
          await setVehicleOffline(tx, vehicle.id);
        }
      }
      await revokeAllSessionsForUser(tx, target.id);
    }

    return applyAccountTransition(tx, target, change.command, change.actorUserId, change.reason);
  });
}
