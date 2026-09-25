import { manhattanDistanceDkm } from "./geography.js";

// Matching rule (plan §7.2): checked in this exact order, because the order
// fixes which error the loser of a race sees (capacity before compatibility).
export const MAX_DROPOFF_SPREAD_DKM = 35;

export type MatchIncompatibleReason =
  | "POOL_NOT_ACCEPTING"
  | "REQUEST_NOT_OPEN"
  | "POOL_CAPACITY_EXCEEDED"
  | "POOL_INCOMPATIBLE";

export type MatchResult = { compatible: true } | { compatible: false; reason: MatchIncompatibleReason };

export interface PoolForMatching {
  readonly status: "OPEN" | "DRIVER_ARRIVED" | "STARTED" | "COMPLETED" | "CANCELLED";
  readonly pickupZone: string;
  /** capacitySnapshot - seatsReserved, computed by the caller under lock. */
  readonly capacityRemaining: number;
}

export interface RequestForMatching {
  readonly status: "REQUESTED" | "MATCHED" | "DRIVER_ARRIVED" | "STARTED" | "COMPLETED" | "CANCELLED";
  readonly seats: number;
  readonly pickupZone: string;
  readonly dropoffZone: string;
}

export interface PoolMemberForMatching {
  readonly dropoffZone: string;
}

// Plain values in, plain result out — no DB, no HTTP. Swapping this for a
// real routing/detour model later changes this one function.
export function canJoin(
  pool: PoolForMatching,
  request: RequestForMatching,
  members: readonly PoolMemberForMatching[],
): MatchResult {
  if (pool.status !== "OPEN") {
    return { compatible: false, reason: "POOL_NOT_ACCEPTING" };
  }
  if (request.status !== "REQUESTED") {
    return { compatible: false, reason: "REQUEST_NOT_OPEN" };
  }
  if (pool.capacityRemaining < request.seats) {
    return { compatible: false, reason: "POOL_CAPACITY_EXCEEDED" };
  }
  if (pool.pickupZone !== request.pickupZone) {
    return { compatible: false, reason: "POOL_INCOMPATIBLE" };
  }
  for (const member of members) {
    if (manhattanDistanceDkm(request.dropoffZone, member.dropoffZone) > MAX_DROPOFF_SPREAD_DKM) {
      return { compatible: false, reason: "POOL_INCOMPATIBLE" };
    }
  }
  return { compatible: true };
}
