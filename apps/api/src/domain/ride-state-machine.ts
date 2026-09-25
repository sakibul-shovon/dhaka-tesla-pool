// Ride request lifecycle (plan §9.1, ADR-007). There is no `PATCH { status }`
// anywhere — every transition is one of these named commands, checked
// against this table. The table is *data*, not a chain of `if`s, so the
// unit test can iterate every (state × command) pair against the doc's
// matrix and the two cannot silently drift apart.
export const RIDE_STATUSES = [
  "REQUESTED",
  "MATCHED",
  "DRIVER_ARRIVED",
  "STARTED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

// "seat" in the plan's table covers both `join` (passenger joins an existing
// pool) and `accept` (driver's first passenger, which creates the pool) —
// both have the identical effect on a ride request: REQUESTED -> MATCHED.
export const RIDE_COMMANDS = [
  "join",
  "accept",
  "arrive",
  "start",
  "dropOff",
  "cancel",
  "markNoShow",
  "cancelPool",
] as const;
export type RideCommand = (typeof RIDE_COMMANDS)[number];

export type RideTransitionErrorCode = "INVALID_TRANSITION" | "REQUEST_NOT_OPEN" | "CANCELLATION_NOT_ALLOWED";

export type RideTransitionResult =
  | { readonly allowed: true; readonly to: RideStatus }
  | { readonly allowed: false; readonly error: RideTransitionErrorCode };

const STATUS_SET = new Set<string>(RIDE_STATUSES);
function isRideStatus(value: string): value is RideStatus {
  return STATUS_SET.has(value);
}

// One row per state; unlisted commands fall through to the default
// INVALID_TRANSITION in `rideTransition` below. Values are either the
// destination status, or the specific error the plan calls out instead of
// the generic one ("—" in the doc, i.e. "not reachable", also falls through
// to the generic INVALID_TRANSITION — nothing reaches this table with a
// request that was never in a pool).
const TRANSITION_TABLE: Record<RideStatus, Partial<Record<RideCommand, RideStatus | RideTransitionErrorCode>>> = {
  REQUESTED: {
    join: "MATCHED",
    accept: "MATCHED",
    cancel: "CANCELLED",
  },
  MATCHED: {
    join: "REQUEST_NOT_OPEN",
    accept: "REQUEST_NOT_OPEN",
    arrive: "DRIVER_ARRIVED",
    cancel: "CANCELLED",
    cancelPool: "CANCELLED",
  },
  DRIVER_ARRIVED: {
    start: "STARTED",
    cancel: "CANCELLED",
    markNoShow: "CANCELLED",
    cancelPool: "CANCELLED",
  },
  STARTED: {
    dropOff: "COMPLETED",
    cancel: "CANCELLATION_NOT_ALLOWED",
  },
  COMPLETED: {},
  CANCELLED: {},
};

export function rideTransition(current: RideStatus, command: RideCommand): RideTransitionResult {
  const entry = TRANSITION_TABLE[current][command];
  if (entry === undefined) {
    return { allowed: false, error: "INVALID_TRANSITION" };
  }
  if (isRideStatus(entry)) {
    return { allowed: true, to: entry };
  }
  return { allowed: false, error: entry };
}
