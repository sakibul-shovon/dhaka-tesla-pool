import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "../../db/client.js";
import { RIDE_REQUESTS_ACTIVE_PER_PASSENGER_INDEX, rideRequests, rideStatusHistory } from "../../db/schema.js";
import { ACTIVE_RIDE_STATUSES } from "../../domain/ride-state-machine.js";

export { RIDE_REQUESTS_ACTIVE_PER_PASSENGER_INDEX };

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
