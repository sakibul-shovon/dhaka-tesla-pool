import type { Query } from "@tanstack/react-query";

// Plan §15.4's policy, exactly: base intervals per screen, doubling backoff
// on consecutive failures (3 -> 6 -> 12 -> 24 -> capped at 30s), stopped
// entirely once the resource is terminal or the browser is offline. Tab
// visibility and window-focus refetch are TanStack Query's own defaults
// (refetchIntervalInBackground/refetchOnWindowFocus) — not reimplemented
// here.
export const POLL_BASE_MS = {
  activeRide: 3_000,
  driverPoll: 4_000,
} as const;

const MAX_BACKOFF_MS = 30_000;

export interface RefetchIntervalOptions<TData> {
  baseMs: number;
  isTerminal: (data: TData) => boolean;
}

// A poll issues at most one immediate retry on failure (query-level
// `retry: 1`, set by the caller) — this function is the *next scheduled
// poll's* delay, which is the real retry mechanism (plan §15.4: "the
// interval itself is the retry mechanism").
export function createRefetchInterval<TData>({
  baseMs,
  isTerminal,
}: RefetchIntervalOptions<TData>): (query: Query<TData>) => number | false {
  return (query) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return false;
    }
    const data = query.state.data;
    if (data !== undefined && isTerminal(data)) {
      return false;
    }
    const failures = query.state.fetchFailureCount;
    if (failures === 0) {
      return baseMs;
    }
    return Math.min(baseMs * 2 ** failures, MAX_BACKOFF_MS);
  };
}

// "Server waking up" (free-tier cold start, plan §15.3/§15.4): true only
// when a query has *never* succeeded and has at least one failure — a query
// that was working and then blipped is a different, ordinary error state.
export function isColdStart(query: Query): boolean {
  return query.state.dataUpdateCount === 0 && query.state.fetchFailureCount > 0;
}
