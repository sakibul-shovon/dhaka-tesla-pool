# ADR-016 — Per-passenger drop-off, not a pool-level COMPLETED

- **Status:** Accepted
- **Date:** 2026-09-26
- **Branch:** feature/driver-flow

## Context

Nusrat (Banani -> Mohakhali) and Rafiq (Banani -> Gulshan 1) share Bullet, but Bullet reaches Mohakhali
first. If a ride request only had one terminal "the trip is over" transition tied to the *pool's* own
completion, Nusrat's ride would stay `STARTED` for the extra kilometres to Gulshan 1 even though she was
dropped off and paid minutes earlier — wrong from her point of view and wrong in any report that reads
`ride_requests.status`.

## Decision

`dropOff` is a per-membership command (`POST /driver/pools/:id/memberships/:mid/drop-off`). It transitions
*that one* ride request to `COMPLETED` (`applyRideTransition`) and marks that one membership
`droppedOffAt`. The pool itself only moves to `COMPLETED` when the last still-riding member (not released,
not already dropped off — `listActiveMembers`) has been dropped off; the route checks that count after
every drop-off and calls `applyPoolTransition(..., "complete")` exactly when it reaches zero.

## Alternatives considered

- **Pool-level `COMPLETED` drives every member to `COMPLETED` at once** — the shape the PRD's suggested
  lifecycle (§3) implies before pooling is added, and what `feature/ride-requests` shipped before any
  pool existed. Once two passengers can have different drop-off points, this either completes Nusrat too
  early (before Bullet actually reaches Mohakhali) or holds her `STARTED` too long (until Rafiq is also
  dropped) — neither matches what actually happened to her.
- **A separate "trip leg" entity per passenger, independent of `ride_requests.status`** — more accurate in
  principle, but duplicates state that `ride_requests.status` (plus `pool_memberships.droppedOffAt`) already
  represents; two sources of truth for "is Nusrat's ride over" is exactly the drift plan §10.7's
  single-write-path rule exists to prevent.

## Why this fits Dhaka Tesla Pool

`pool-lifecycle.int.test.ts`'s single-passenger lifecycle test is the degenerate case (one member, so
their drop-off is trivially the last one); the two-member fare test plus `pool-cancel.int.test.ts`'s
"Rafiq unaffected" case are the ones that actually exercise the distinction — Nusrat completing does not
complete Rafiq, and does not complete the pool while he's still aboard.

## Trade-offs and consequences

The route re-queries membership state after every drop-off rather than trusting a counter, which is one
extra `SELECT` per drop-off — negligible, and safer than maintaining a duplicate "remaining count" column
that could drift from the rows it's counting.

## Revisit when

Never, for this shape of trip — this is a direct consequence of the PRD's own premise (different
passengers, different destinations, one vehicle) and doesn't change with scale.
