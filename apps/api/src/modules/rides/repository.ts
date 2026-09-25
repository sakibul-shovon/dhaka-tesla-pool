import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { Db, Tx } from "../../db/client.js";
import { RIDE_REQUESTS_ACTIVE_PER_PASSENGER_INDEX, rideRequests, rideStatusHistory } from "../../db/schema.js";
import { ACTIVE_RIDE_STATUSES, type RideStatus } from "../../domain/ride-state-machine.js";
import { markLocked, type Locked } from "../../domain-writes/locked.js";
import type { LockOrderGuard } from "../../lib/lock-order.js";

export { RIDE_REQUESTS_ACTIVE_PER_PASSENGER_INDEX };

// Explicit column list, not `select *` (plan §13.1 API3 mass-assignment
// defence, matching the auth repository's precedent).
const RIDE_REQUEST_COLUMNS = {
  id: rideRequests.id,
  passengerId: rideRequests.passengerId,
  pickupZone: rideRequests.pickupZone,
  dropoffZone: rideRequests.dropoffZone,
  seats: rideRequests.seats,
  distanceDkm: rideRequests.distanceDkm,
  soloFarePaisa: rideRequests.soloFarePaisa,
  pooledFarePaisa: rideRequests.pooledFarePaisa,
  paymentMethod: rideRequests.paymentMethod,
  status: rideRequests.status,
  cancelReason: rideRequests.cancelReason,
  cancelledBy: rideRequests.cancelledBy,
  createdAt: rideRequests.createdAt,
  matchedAt: rideRequests.matchedAt,
  startedAt: rideRequests.startedAt,
  completedAt: rideRequests.completedAt,
  cancelledAt: rideRequests.cancelledAt,
} as const;

export type RideRequestRow = typeof rideRequests.$inferSelect;

export function toRideRequestDTO(row: RideRequestRow) {
  return {
    id: row.id,
    pickupZone: row.pickupZone,
    dropoffZone: row.dropoffZone,
    seats: row.seats,
    distanceDkm: row.distanceDkm,
    soloFarePaisa: row.soloFarePaisa,
    pooledFarePaisa: row.pooledFarePaisa,
    paymentMethod: row.paymentMethod,
    status: row.status,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
    matchedAt: row.matchedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

export async function findActiveRideRequestId(tx: Tx, passengerId: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ id: rideRequests.id })
    .from(rideRequests)
    .where(and(eq(rideRequests.passengerId, passengerId), inArray(rideRequests.status, [...ACTIVE_RIDE_STATUSES])))
    .limit(1);
  return row?.id;
}

export interface NewRideRequestInput {
  passengerId: string;
  pickupZone: string;
  dropoffZone: string;
  seats: number;
  distanceDkm: number;
  soloFarePaisa: number;
  pooledFarePaisa: number;
  paymentMethod: "CASH" | "TESLAPAY";
}

export async function insertRideRequest(tx: Tx, input: NewRideRequestInput): Promise<RideRequestRow> {
  const [row] = await tx.insert(rideRequests).values(input).returning();
  return row!;
}

// Not routed through applyRideTransition: there is no locked "from" row to
// transition — this *is* the row's first row. Writing the REQUESTED history
// entry here, in the same transaction as the insert, is what keeps "a
// history row for every transition" true from the very first one.
export async function insertCreationHistory(tx: Tx, rideRequestId: string, actorUserId: string): Promise<void> {
  await tx.insert(rideStatusHistory).values({
    rideRequestId,
    fromStatus: null,
    toStatus: "REQUESTED",
    actorUserId,
  });
}

export async function findRideRequestByOwner(
  db: Db | Tx,
  id: string,
  passengerId: string,
): Promise<RideRequestRow | undefined> {
  const [row] = await db
    .select(RIDE_REQUEST_COLUMNS)
    .from(rideRequests)
    .where(and(eq(rideRequests.id, id), eq(rideRequests.passengerId, passengerId)))
    .limit(1);
  return row;
}

// Scoped by owner in the same WHERE as the lookup (CLAUDE.md: "every query
// on user-owned data is scoped by the caller") — a non-owner's cancel finds
// no row and gets the same 404 as a ride that doesn't exist.
export async function lockRideRequestForOwner(
  tx: Tx,
  id: string,
  passengerId: string,
  guard: LockOrderGuard,
): Promise<Locked<{ id: string; status: RideStatus; seats: number }> | undefined> {
  guard.assert("requests");
  const [row] = await tx
    .select({ id: rideRequests.id, status: rideRequests.status, seats: rideRequests.seats })
    .from(rideRequests)
    .where(and(eq(rideRequests.id, id), eq(rideRequests.passengerId, passengerId)))
    .for("update");
  return row ? markLocked(row) : undefined;
}

export interface ListRideRequestsParams {
  passengerId: string;
  status?: RideStatus;
  cursor?: { createdAt: Date; id: string };
  limit: number;
}

// `limit + 1` rows are fetched so the caller can tell "there is a next page"
// without a separate COUNT query — plan §12.1 keyset pagination.
export async function listRideRequestsForPassenger(
  db: Db,
  params: ListRideRequestsParams,
): Promise<RideRequestRow[]> {
  const conditions = [eq(rideRequests.passengerId, params.passengerId)];
  if (params.status) {
    conditions.push(eq(rideRequests.status, params.status));
  }
  if (params.cursor) {
    conditions.push(
      or(
        lt(rideRequests.createdAt, params.cursor.createdAt),
        and(eq(rideRequests.createdAt, params.cursor.createdAt), lt(rideRequests.id, params.cursor.id))!,
      )!,
    );
  }

  return db
    .select(RIDE_REQUEST_COLUMNS)
    .from(rideRequests)
    .where(and(...conditions))
    .orderBy(desc(rideRequests.createdAt), desc(rideRequests.id))
    .limit(params.limit + 1);
}

export interface RideStatusHistoryRow {
  id: number;
  fromStatus: RideStatus | null;
  toStatus: RideStatus;
  actorUserId: string | null;
  reason: string | null;
  createdAt: Date;
}

export async function listRideStatusHistory(db: Db, rideRequestId: string): Promise<RideStatusHistoryRow[]> {
  return db
    .select({
      id: rideStatusHistory.id,
      fromStatus: rideStatusHistory.fromStatus,
      toStatus: rideStatusHistory.toStatus,
      actorUserId: rideStatusHistory.actorUserId,
      reason: rideStatusHistory.reason,
      createdAt: rideStatusHistory.createdAt,
    })
    .from(rideStatusHistory)
    .where(eq(rideStatusHistory.rideRequestId, rideRequestId))
    .orderBy(asc(rideStatusHistory.createdAt), asc(rideStatusHistory.id));
}

export function toHistoryDTO(row: RideStatusHistoryRow) {
  return {
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actorUserId: row.actorUserId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}
