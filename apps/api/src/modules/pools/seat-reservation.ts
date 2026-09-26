import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Tx } from "../../db/client.js";
import { poolMemberships } from "../../db/schema.js";
import { canJoin, type MatchIncompatibleReason, type PoolMemberForMatching } from "../../domain/matching.js";
import { applyRideTransition, type LockedRideRequestForTransition } from "../../domain-writes/ride-transitions.js";
import { HttpError } from "../../http/error-mapper.js";
import type { LockedOwnedPool } from "./repository.js";
import { updatePoolSeatsReserved } from "./repository.js";

const MATCH_ERROR_MESSAGES: Record<MatchIncompatibleReason, string> = {
  POOL_NOT_ACCEPTING: "This Tesla is no longer taking passengers.",
  REQUEST_NOT_OPEN: "This ride was already matched or cancelled.",
  POOL_CAPACITY_EXCEEDED: "That seat was just taken. Here are the current options.",
  POOL_INCOMPATIBLE: "This Tesla's route no longer suits your trip.",
};

function matchError(reason: MatchIncompatibleReason): HttpError {
  return new HttpError(409, ERROR_CODES[reason], MATCH_ERROR_MESSAGES[reason]);
}

export interface ReserveSeatInput {
  lockedPool: LockedOwnedPool;
  lockedRequest: LockedRideRequestForTransition & { pickupZone: string; dropoffZone: string; seats: number };
  members: readonly PoolMemberForMatching[];
  command: "join" | "accept";
  actorUserId: string;
}

// The join-side half of pooling (plan §7.2, §10.4): under both row locks
// (caller acquired them, in lock order), check `canJoin`, bump the pool's
// seat counter, insert the membership, and move the request to MATCHED —
// all in the same transaction so a failure anywhere rolls the whole thing
// back rather than leaving a seat reserved with no membership.
export async function reserveSeat(tx: Tx, input: ReserveSeatInput): Promise<{ membershipId: string }> {
  const { lockedPool, lockedRequest, members, command, actorUserId } = input;
  const capacityRemaining = lockedPool.capacitySnapshot - lockedPool.seatsReserved;

  const match = canJoin(
    { status: lockedPool.status, pickupZone: lockedPool.pickupZone, capacityRemaining },
    {
      status: lockedRequest.status,
      seats: lockedRequest.seats,
      pickupZone: lockedRequest.pickupZone,
      dropoffZone: lockedRequest.dropoffZone,
    },
    members,
  );
  if (!match.compatible) {
    throw matchError(match.reason);
  }

  await updatePoolSeatsReserved(tx, lockedPool.id, lockedPool.seatsReserved + lockedRequest.seats);

  const [membership] = await tx
    .insert(poolMemberships)
    .values({ poolId: lockedPool.id, rideRequestId: lockedRequest.id, seats: lockedRequest.seats })
    .returning({ id: poolMemberships.id });

  await applyRideTransition(tx, lockedRequest, command, actorUserId);

  return { membershipId: membership!.id };
}
