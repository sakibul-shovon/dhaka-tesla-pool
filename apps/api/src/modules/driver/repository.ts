import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db, Tx } from "../../db/client.js";
import { pools, poolMemberships, rideRequests, vehicles } from "../../db/schema.js";
import { ACTIVE_POOL_STATUSES, type PoolStatus } from "../../domain/pool-state-machine.js";
import { canJoin, type PoolMemberForMatching } from "../../domain/matching.js";

export type VehicleRow = typeof vehicles.$inferSelect;

export async function findVehicleByDriverId(db: Db | Tx, driverId: string): Promise<VehicleRow | undefined> {
  const [row] = await db.select().from(vehicles).where(eq(vehicles.driverId, driverId)).limit(1);
  return row;
}

export interface ActivePoolSummary {
  id: string;
  status: PoolStatus;
  pickupZone: string;
  capacitySnapshot: number;
  seatsReserved: number;
}

export async function findActivePoolForVehicle(
  db: Db | Tx,
  vehicleId: string,
): Promise<ActivePoolSummary | undefined> {
  const [row] = await db
    .select({
      id: pools.id,
      status: pools.status,
      pickupZone: pools.pickupZone,
      capacitySnapshot: pools.capacitySnapshot,
      seatsReserved: pools.seatsReserved,
    })
    .from(pools)
    .where(and(eq(pools.vehicleId, vehicleId), inArray(pools.status, [...ACTIVE_POOL_STATUSES])))
    .limit(1);
  return row;
}

export async function setVehicleOnline(tx: Tx, vehicleId: string, zone: string): Promise<VehicleRow> {
  const [row] = await tx
    .update(vehicles)
    .set({ isOnline: true, currentZone: zone, updatedAt: new Date() })
    .where(eq(vehicles.id, vehicleId))
    .returning();
  return row!;
}

export async function setVehicleOffline(tx: Tx, vehicleId: string): Promise<VehicleRow> {
  const [row] = await tx
    .update(vehicles)
    .set({ isOnline: false, updatedAt: new Date() })
    .where(eq(vehicles.id, vehicleId))
    .returning();
  return row!;
}

export interface RelevantRequestRow {
  id: string;
  pickupZone: string;
  dropoffZone: string;
  seats: number;
  distanceDkm: number;
  soloFarePaisa: number;
  pooledFarePaisa: number;
  createdAt: Date;
}

// REQUESTED rides in the driver's zone (plan §12.2); when the driver already
// has an OPEN pool, narrowed further to requests `canJoin` would actually
// accept — no point showing a request the very next call would reject.
export async function listRelevantRequestsForDriver(
  db: Db,
  zone: string,
  openPool: (ActivePoolSummary & { members: PoolMemberForMatching[] }) | undefined,
): Promise<RelevantRequestRow[]> {
  const candidates = await db
    .select({
      id: rideRequests.id,
      pickupZone: rideRequests.pickupZone,
      dropoffZone: rideRequests.dropoffZone,
      seats: rideRequests.seats,
      distanceDkm: rideRequests.distanceDkm,
      soloFarePaisa: rideRequests.soloFarePaisa,
      pooledFarePaisa: rideRequests.pooledFarePaisa,
      createdAt: rideRequests.createdAt,
    })
    .from(rideRequests)
    .where(and(eq(rideRequests.status, "REQUESTED"), eq(rideRequests.pickupZone, zone)))
    .orderBy(rideRequests.createdAt);

  if (!openPool || openPool.status !== "OPEN") {
    return candidates;
  }

  const capacityRemaining = openPool.capacitySnapshot - openPool.seatsReserved;
  return candidates.filter(
    (candidate) =>
      canJoin(
        { status: "OPEN", pickupZone: openPool.pickupZone, capacityRemaining },
        { status: "REQUESTED", seats: candidate.seats, pickupZone: candidate.pickupZone, dropoffZone: candidate.dropoffZone },
        openPool.members,
      ).compatible,
  );
}

export async function listUnreleasedMemberDropoffs(
  db: Db | Tx,
  poolId: string,
): Promise<PoolMemberForMatching[]> {
  const rows = await db
    .select({ dropoffZone: rideRequests.dropoffZone })
    .from(poolMemberships)
    .innerJoin(rideRequests, eq(rideRequests.id, poolMemberships.rideRequestId))
    .where(and(eq(poolMemberships.poolId, poolId), isNull(poolMemberships.releasedAt)));
  return rows;
}
