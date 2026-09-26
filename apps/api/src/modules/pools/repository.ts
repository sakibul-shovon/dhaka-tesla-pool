import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db, Tx } from "../../db/client.js";
import { pools, poolMemberships, poolStatusHistory, rideRequests, users, vehicles } from "../../db/schema.js";
import { ACTIVE_POOL_STATUSES, type PoolStatus } from "../../domain/pool-state-machine.js";
import { markLocked, type Locked } from "../../domain-writes/locked.js";
import { firstNameOf } from "../../lib/names.js";
import { type LockOrderGuard } from "../../lib/lock-order.js";

export type PoolRow = typeof pools.$inferSelect;

export function toPoolDTO(row: PoolRow) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    driverId: row.driverId,
    pickupZone: row.pickupZone,
    status: row.status,
    capacitySnapshot: row.capacitySnapshot,
    seatsReserved: row.seatsReserved,
    createdAt: row.createdAt.toISOString(),
    arrivedAt: row.arrivedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

export async function findOpenPoolForVehicle(db: Db | Tx, vehicleId: string): Promise<PoolRow | undefined> {
  const [row] = await db
    .select()
    .from(pools)
    .where(and(eq(pools.vehicleId, vehicleId), eq(pools.status, "OPEN")))
    .limit(1);
  return row;
}

export async function findActivePoolForDriver(db: Db, driverId: string): Promise<PoolRow | undefined> {
  const [row] = await db
    .select()
    .from(pools)
    .where(and(eq(pools.driverId, driverId), inArray(pools.status, [...ACTIVE_POOL_STATUSES])))
    .limit(1);
  return row;
}

export async function insertPool(
  tx: Tx,
  input: { vehicleId: string; driverId: string; pickupZone: string; capacitySnapshot: number },
): Promise<PoolRow> {
  const [row] = await tx
    .insert(pools)
    .values({
      vehicleId: input.vehicleId,
      driverId: input.driverId,
      pickupZone: input.pickupZone,
      capacitySnapshot: input.capacitySnapshot,
    })
    .returning();
  return row!;
}

// Not routed through applyPoolTransition: there is no locked "from" row to
// transition — this *is* the pool's first row (mirrors rides/repository.ts's
// insertCreationHistory). Without this, I14 (plan §10.7 — "latest history
// row matches current status") would fail for every pool from the moment
// it's created until its first real transition.
export async function insertPoolCreationHistory(tx: Tx, poolId: string, actorUserId: string): Promise<void> {
  await tx.insert(poolStatusHistory).values({
    poolId,
    fromStatus: null,
    toStatus: "OPEN",
    actorUserId,
  });
}

// Scoped by owner in the WHERE clause (CLAUDE.md: "every query on
// user-owned data is scoped by the caller") — Monir locking Jashim's pool
// id finds no row and gets the same 404 as a pool that doesn't exist.
export type LockedOwnedPool = Locked<{
  id: string;
  vehicleId: string;
  driverId: string;
  pickupZone: string;
  status: PoolStatus;
  capacitySnapshot: number;
  seatsReserved: number;
}>;

export async function lockPoolForDriver(
  tx: Tx,
  id: string,
  driverId: string,
  guard: LockOrderGuard,
): Promise<LockedOwnedPool | undefined> {
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
    .where(and(eq(pools.id, id), eq(pools.driverId, driverId)))
    .for("update");
  return row ? markLocked(row) : undefined;
}

export async function findPoolByIdForDriver(db: Db, id: string, driverId: string): Promise<PoolRow | undefined> {
  const [row] = await db
    .select()
    .from(pools)
    .where(and(eq(pools.id, id), eq(pools.driverId, driverId)))
    .limit(1);
  return row;
}

export async function updatePoolSeatsReserved(tx: Tx, poolId: string, seatsReserved: number): Promise<void> {
  await tx.update(pools).set({ seatsReserved }).where(eq(pools.id, poolId));
}

export interface MemberRow {
  membershipId: string;
  rideRequestId: string;
  passengerId: string;
  passengerName: string;
  seats: number;
  dropoffZone: string;
  soloFarePaisa: number;
  pooledFarePaisa: number;
  finalFarePaisa: number | null;
  sharedRide: boolean | null;
  joinedAt: Date;
  releasedAt: Date | null;
  droppedOffAt: Date | null;
}

async function selectMembers(db: Db | Tx, poolId: string, onlyUnreleased: boolean): Promise<MemberRow[]> {
  const conditions = [eq(poolMemberships.poolId, poolId)];
  if (onlyUnreleased) {
    conditions.push(isNull(poolMemberships.releasedAt));
  }
  const rows = await db
    .select({
      membershipId: poolMemberships.id,
      rideRequestId: poolMemberships.rideRequestId,
      passengerId: rideRequests.passengerId,
      passengerName: users.name,
      seats: poolMemberships.seats,
      dropoffZone: rideRequests.dropoffZone,
      soloFarePaisa: rideRequests.soloFarePaisa,
      pooledFarePaisa: rideRequests.pooledFarePaisa,
      finalFarePaisa: poolMemberships.finalFarePaisa,
      sharedRide: poolMemberships.sharedRide,
      joinedAt: poolMemberships.joinedAt,
      releasedAt: poolMemberships.releasedAt,
      droppedOffAt: poolMemberships.droppedOffAt,
    })
    .from(poolMemberships)
    .innerJoin(rideRequests, eq(rideRequests.id, poolMemberships.rideRequestId))
    .innerJoin(users, eq(users.id, rideRequests.passengerId))
    .where(and(...conditions))
    .orderBy(asc(poolMemberships.joinedAt));
  return rows;
}

export function listUnreleasedMembers(db: Db | Tx, poolId: string): Promise<MemberRow[]> {
  return selectMembers(db, poolId, true);
}

export function listAllMembers(db: Db | Tx, poolId: string): Promise<MemberRow[]> {
  return selectMembers(db, poolId, false);
}

// "Still riding" — unlike listUnreleasedMembers, excludes a member who has
// already been dropped off. Used to decide whether a drop-off was the last
// one (pool -> COMPLETED); a completed member is *not* released (plan
// §5.2: released_at is "cancel / no-show" only), so listUnreleasedMembers
// alone would never reach zero on a normal, fully-completed trip.
export async function listActiveMembers(db: Db | Tx, poolId: string): Promise<MemberRow[]> {
  const rows = await selectMembers(db, poolId, true);
  return rows.filter((row) => row.droppedOffAt === null);
}

export async function sumEarningsPaisa(db: Db, poolId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${poolMemberships.finalFarePaisa}), 0)` })
    .from(poolMemberships)
    .where(eq(poolMemberships.poolId, poolId));
  return Number(row?.total ?? 0);
}

export function toMemberDTO(row: MemberRow) {
  return {
    membershipId: row.membershipId,
    rideRequestId: row.rideRequestId,
    passengerName: row.passengerName,
    seats: row.seats,
    dropoffZone: row.dropoffZone,
    finalFarePaisa: row.finalFarePaisa,
    sharedRide: row.sharedRide,
    joinedAt: row.joinedAt.toISOString(),
    releasedAt: row.releasedAt?.toISOString() ?? null,
    droppedOffAt: row.droppedOffAt?.toISOString() ?? null,
  };
}

export async function findMembershipByRideRequestId(
  db: Db | Tx,
  rideRequestId: string,
): Promise<{ id: string; poolId: string; releasedAt: Date | null } | undefined> {
  const [row] = await db
    .select({ id: poolMemberships.id, poolId: poolMemberships.poolId, releasedAt: poolMemberships.releasedAt })
    .from(poolMemberships)
    .where(eq(poolMemberships.rideRequestId, rideRequestId))
    .limit(1);
  return row;
}

export async function findMembershipInPool(
  db: Db | Tx,
  poolId: string,
  membershipId: string,
): Promise<{ id: string; rideRequestId: string; seats: number; releasedAt: Date | null; droppedOffAt: Date | null } | undefined> {
  const [row] = await db
    .select({
      id: poolMemberships.id,
      rideRequestId: poolMemberships.rideRequestId,
      seats: poolMemberships.seats,
      releasedAt: poolMemberships.releasedAt,
      droppedOffAt: poolMemberships.droppedOffAt,
    })
    .from(poolMemberships)
    .where(and(eq(poolMemberships.poolId, poolId), eq(poolMemberships.id, membershipId)))
    .limit(1);
  return row;
}

export async function releaseMembership(tx: Tx, membershipId: string): Promise<void> {
  await tx.update(poolMemberships).set({ releasedAt: new Date() }).where(eq(poolMemberships.id, membershipId));
}

export async function markMembershipDroppedOff(tx: Tx, membershipId: string): Promise<void> {
  await tx.update(poolMemberships).set({ droppedOffAt: new Date() }).where(eq(poolMemberships.id, membershipId));
}

export async function setMembershipFinalFare(
  tx: Tx,
  membershipId: string,
  finalFarePaisa: number,
  sharedRide: boolean,
): Promise<void> {
  await tx.update(poolMemberships).set({ finalFarePaisa, sharedRide }).where(eq(poolMemberships.id, membershipId));
}

export interface PoolHistoryRow {
  id: number;
  fromStatus: PoolStatus | null;
  toStatus: PoolStatus;
  actorUserId: string | null;
  reason: string | null;
  createdAt: Date;
}

export async function listPoolStatusHistory(db: Db, poolId: string): Promise<PoolHistoryRow[]> {
  return db
    .select({
      id: poolStatusHistory.id,
      fromStatus: poolStatusHistory.fromStatus,
      toStatus: poolStatusHistory.toStatus,
      actorUserId: poolStatusHistory.actorUserId,
      reason: poolStatusHistory.reason,
      createdAt: poolStatusHistory.createdAt,
    })
    .from(poolStatusHistory)
    .where(eq(poolStatusHistory.poolId, poolId))
    .orderBy(asc(poolStatusHistory.createdAt), asc(poolStatusHistory.id));
}

export function toPoolHistoryDTO(row: PoolHistoryRow) {
  return {
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actorUserId: row.actorUserId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ListPoolsParams {
  driverId: string;
  cursor?: { createdAt: Date; id: string };
  limit: number;
}

export async function listPoolsForDriver(db: Db, params: ListPoolsParams): Promise<PoolRow[]> {
  const conditions = [eq(pools.driverId, params.driverId)];
  if (params.cursor) {
    conditions.push(
      or(
        lt(pools.createdAt, params.cursor.createdAt),
        and(eq(pools.createdAt, params.cursor.createdAt), lt(pools.id, params.cursor.id))!,
      )!,
    );
  }
  return db
    .select()
    .from(pools)
    .where(and(...conditions))
    .orderBy(desc(pools.createdAt), desc(pools.id))
    .limit(params.limit + 1);
}

// A candidate pool for a passenger's pool-offers listing (plan §12.2's
// `GET /ride-requests/:id/pool-offers`) — deliberately not owner-scoped,
// since any passenger may see any OPEN pool in their pickup zone.
export interface OpenPoolCandidateRow {
  poolId: string;
  pickupZone: string;
  vehicleName: string;
  driverName: string;
  capacitySnapshot: number;
  seatsReserved: number;
}

export async function listOpenPoolsInZone(db: Db, pickupZone: string): Promise<OpenPoolCandidateRow[]> {
  return db
    .select({
      poolId: pools.id,
      pickupZone: pools.pickupZone,
      vehicleName: vehicles.name,
      driverName: users.name,
      capacitySnapshot: pools.capacitySnapshot,
      seatsReserved: pools.seatsReserved,
    })
    .from(pools)
    .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
    .innerJoin(users, eq(users.id, pools.driverId))
    .where(and(eq(pools.status, "OPEN"), eq(pools.pickupZone, pickupZone)));
}

export interface PoolSummaryForRequest {
  poolId: string;
  vehicleName: string;
  driverName: string;
  status: PoolStatus;
  capacitySnapshot: number;
  seatsReserved: number;
  sharedWithCount: number;
}

// The pool summary shown on a passenger's own ride (plan §12.2's
// `GET /ride-requests/:id`, §15.2's pool card) — `undefined` once the
// request was never matched, or its membership has since been released.
export async function findPoolSummaryForRideRequest(
  db: Db | Tx,
  rideRequestId: string,
): Promise<PoolSummaryForRequest | undefined> {
  const [row] = await db
    .select({
      poolId: pools.id,
      vehicleName: vehicles.name,
      driverName: users.name,
      status: pools.status,
      capacitySnapshot: pools.capacitySnapshot,
      seatsReserved: pools.seatsReserved,
    })
    .from(poolMemberships)
    .innerJoin(pools, eq(pools.id, poolMemberships.poolId))
    .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
    .innerJoin(users, eq(users.id, pools.driverId))
    .where(and(eq(poolMemberships.rideRequestId, rideRequestId), isNull(poolMemberships.releasedAt)))
    .limit(1);
  if (!row) {
    return undefined;
  }

  const members = await listUnreleasedMembers(db, row.poolId);
  return { ...row, sharedWithCount: Math.max(0, members.length - 1) };
}

export function toPoolSummaryDTO(row: PoolSummaryForRequest) {
  return {
    poolId: row.poolId,
    vehicleName: row.vehicleName,
    driverFirstName: firstNameOf(row.driverName),
    status: row.status,
    capacitySnapshot: row.capacitySnapshot,
    seatsReserved: row.seatsReserved,
    sharedWithCount: row.sharedWithCount,
  };
}

export { ACTIVE_POOL_STATUSES };
