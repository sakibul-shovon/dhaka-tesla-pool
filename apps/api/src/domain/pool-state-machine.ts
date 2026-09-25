// Pool lifecycle (plan §9.2, ADR-007/ADR-016). Same shape as
// ride-state-machine.ts on purpose — one write path per aggregate (plan
// §10.7), table-as-data so the unit test can walk every pair.
export const POOL_STATUSES = ["OPEN", "DRIVER_ARRIVED", "STARTED", "COMPLETED", "CANCELLED"] as const;
export type PoolStatus = (typeof POOL_STATUSES)[number];

// "seat" (join/accept) does not change the pool's own status — it changes
// seatsReserved and inserts a membership (modules/pools/seat-reservation.ts).
// "complete" fires when the last unreleased member is dropped off; "emptyCancel"
// fires when the last unreleased member leaves before the pool starts —
// both are derived from membership counts, not from pool status alone, so
// callers decide *when* to send them; this table only decides whether the
// resulting status change is legal.
export const POOL_COMMANDS = ["arrive", "start", "complete", "cancelPool", "emptyCancel"] as const;
export type PoolCommand = (typeof POOL_COMMANDS)[number];

export type PoolTransitionResult =
  | { readonly allowed: true; readonly to: PoolStatus }
  | { readonly allowed: false; readonly error: "INVALID_TRANSITION" };

const STATUS_SET = new Set<string>(POOL_STATUSES);
function isPoolStatus(value: string): value is PoolStatus {
  return STATUS_SET.has(value);
}

const TRANSITION_TABLE: Record<PoolStatus, Partial<Record<PoolCommand, PoolStatus>>> = {
  OPEN: {
    arrive: "DRIVER_ARRIVED",
    cancelPool: "CANCELLED",
    emptyCancel: "CANCELLED",
  },
  DRIVER_ARRIVED: {
    start: "STARTED",
    cancelPool: "CANCELLED",
    emptyCancel: "CANCELLED",
  },
  STARTED: {
    complete: "COMPLETED",
  },
  COMPLETED: {},
  CANCELLED: {},
};

export function poolTransition(current: PoolStatus, command: PoolCommand): PoolTransitionResult {
  const entry = TRANSITION_TABLE[current][command];
  if (entry === undefined || !isPoolStatus(entry)) {
    return { allowed: false, error: "INVALID_TRANSITION" };
  }
  return { allowed: true, to: entry };
}
