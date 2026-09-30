import { asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { rideRequests, pools, vehicles, users } from "../db/schema.js";
import type { RideStatus } from "../domain/ride-state-machine.js";
import type { PoolStatus } from "../domain/pool-state-machine.js";
import type { AccountStatus } from "../domain/account-state-machine.js";
import { markLocked, type Locked } from "../domain-writes/locked.js";

// Global lock order (plan §10.2): vehicle -> pool -> ride_requests (ascending
// id) -> wallet -> user. Every write path that touches more than one of these
// acquires a prefix-respecting subsequence of this order; `LockOrderGuard`
// makes a mistake fail loudly in dev/test instead of silently risking a
// deadlock. `wallet` is last of the original four: the only write path that
// locks it alongside anything else is drop-off's TeslaPay debit (plan §8.4),
// which locks the pool and the ride request first and the wallet only as its
// final step — top-up locks the wallet alone, so there is no path that could
// ever want the reverse order. `user` is newer (ADR-019, account
// suspension) and sits last for the same reason: nothing else ever locks a
// user row, so its position only has to be internally consistent with
// itself — suspending a driver locks their vehicle first, then the user.
const STAGE_RANK = { vehicle: 0, pool: 1, requests: 2, wallet: 3, user: 4 } as const;
type LockStage = keyof typeof STAGE_RANK;

export class LockOrderGuard {
  #maxRank = -1;

  assert(stage: LockStage): void {
    const rank = STAGE_RANK[stage];
    if (rank < this.#maxRank) {
      throw new Error(
        `Lock order violation: tried to lock '${stage}' after a later stage was already locked (plan §10.2).`,
      );
    }
    this.#maxRank = Math.max(this.#maxRank, rank);
  }
}

export function createLockOrderGuard(): LockOrderGuard {
  return new LockOrderGuard();
}

export type LockedVehicle = Locked<{
  id: string;
  driverId: string;
  capacity: number;
  isOnline: boolean;
  currentZone: string | null;
}>;

export async function lockVehicleByDriverId(
  tx: Tx,
  driverId: string,
  guard: LockOrderGuard,
): Promise<LockedVehicle | undefined> {
  guard.assert("vehicle");
  const [row] = await tx
    .select({
      id: vehicles.id,
      driverId: vehicles.driverId,
      capacity: vehicles.capacity,
      isOnline: vehicles.isOnline,
      currentZone: vehicles.currentZone,
    })
    .from(vehicles)
    .where(eq(vehicles.driverId, driverId))
    .for("update");
  return row ? markLocked(row) : undefined;
}

export type LockedPool = Locked<{
  id: string;
  vehicleId: string;
  driverId: string;
  pickupZone: string;
  status: PoolStatus;
  capacitySnapshot: number;
  seatsReserved: number;
}>;

export async function lockPoolById(
  tx: Tx,
  id: string,
  guard: LockOrderGuard,
): Promise<LockedPool | undefined> {
  guard.assert("pool");
  const [row] = await tx
    .select({
      id: pools.id,
      vehicleId: pools.vehicleId,
      driverId: pools.driverId,
      pickupZone: pools.pickupZone,
      status: pools.status,
      capacitySnapshot: pools.capacitySnapshot,
      seatsReserved: pools.seatsReserved,
    })
    .from(pools)
    .where(eq(pools.id, id))
    .for("update");
  return row ? markLocked(row) : undefined;
}

export type LockedRideRequest = Locked<{
  id: string;
  passengerId: string;
  status: RideStatus;
  pickupZone: string;
  dropoffZone: string;
  seats: number;
}>;

// Ordered ascending by id (plan §10.2) regardless of the order `ids` was
// passed in, so two transactions locking the same set of requests can never
// form a lock-order cycle between each other.
export async function lockRideRequestsByIds(
  tx: Tx,
  ids: readonly string[],
  guard: LockOrderGuard,
): Promise<LockedRideRequest[]> {
  guard.assert("requests");
  if (ids.length === 0) {
    return [];
  }
  const rows = await tx
    .select({
      id: rideRequests.id,
      passengerId: rideRequests.passengerId,
      status: rideRequests.status,
      pickupZone: rideRequests.pickupZone,
      dropoffZone: rideRequests.dropoffZone,
      seats: rideRequests.seats,
    })
    .from(rideRequests)
    .where(inArray(rideRequests.id, [...ids]))
    .orderBy(asc(rideRequests.id))
    .for("update");
  return rows.map(markLocked);
}

export type LockedUser = Locked<{
  id: string;
  name: string;
  email: string;
  role: "PASSENGER" | "DRIVER" | "ADMIN";
  status: AccountStatus;
  createdAt: Date;
}>;

export async function lockUserById(
  tx: Tx,
  id: string,
  guard: LockOrderGuard,
): Promise<LockedUser | undefined> {
  guard.assert("user");
  const [row] = await tx
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .for("update");
  return row ? markLocked(row) : undefined;
}
