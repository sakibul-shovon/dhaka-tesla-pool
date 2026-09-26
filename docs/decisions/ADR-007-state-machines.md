# ADR-007 — Centralised state machines, not a database trigger

- **Status:** Accepted
- **Date:** 2026-09-26
- **Branch:** feature/driver-flow

## Context

Both `ride_requests.status` and `pools.status` have a small set of legal transitions (plan §9.1, §9.2).
Something has to be the single place that decides whether `MATCHED -> STARTED` is legal, and reject it
the same way every time it's attempted — from a passenger's cancel, a driver's arrive, or (later) a retry
after a dropped connection.

## Decision

A plain TypeScript function per aggregate — `rideTransition` (`domain/ride-state-machine.ts`) and
`poolTransition` (`domain/pool-state-machine.ts`) — each backed by a transition table that's *data*, not
a chain of `if`s, so a unit test can walk every `(state, command)` pair and assert it against the plan's
own table (plan §9.1/§9.2) by eye. The only code allowed to write a `status` column calls through
`applyRideTransition` / `applyPoolTransition` (`domain-writes/`), which re-checks the transition, writes
the row with `WHERE status = $lockedFromStatus` as a backstop, and inserts the matching history row —
all three in one place, so they can't drift apart (plan §10.7). An ESLint rule
(`no-restricted-syntax` in `eslint.config.js`) makes it a lint error to `.set({ status: ... })` anywhere
outside `domain-writes/`, so this isn't just a convention — mimicking the transition function without
going through the write path fails CI.

## Alternatives considered

- **A Postgres trigger validating transitions** (distinct from the append-only history trigger already in
  place) — would enforce the same rule at the database level, but the specific rejection reason
  (`REQUEST_NOT_OPEN` vs `CANCELLATION_NOT_ALLOWED` vs the generic `INVALID_TRANSITION`) needs to become a
  specific HTTP status and error code the frontend switches on (plan §12.3). A trigger can only raise one
  generic exception; recovering the distinct reason would mean parsing an error message string in
  application code — more fragile than the reason already being a typed return value. It would also move
  the rule the PRD explicitly wants explained ("improve it if you can explain why", §3) out of the
  language the rest of the codebase, and the interview, is in.
- **Inline `if` chains at each call site** — what every call site had before this session's transaction
  scripts existed; the ride side already tried this shape in Session 5 and abandoned it for the same
  table-as-data reason once the pool side needed an identical structure — duplicating the pattern by hand
  a second time was the sign it belonged in one place.

## Why this fits Dhaka Tesla Pool

The PRD's own suggested lifecycle (§3) is exactly `RIDE_STATUSES` before pooling exists; ADR-016 explains
where it had to change. `ride-state-machine.test.ts` and `pool-state-machine.test.ts` each assert the
**complete** matrix (every status × every command), so the fixture and the table can't silently diverge —
the standard this ADR is judged against in the interview.

## Trade-offs and consequences

Every write path takes on a `Locked<T>` row (plan §10.7) instead of a bare id, and must have gone through
a `lockXForY` function first — more ceremony than a direct `UPDATE`, in exchange for it being structurally
impossible to change a status without a history row and without the transition being legal.

## Revisit when

A transition needs to depend on something outside the current row and command (e.g. a time-based rule) —
the table-as-data shape stops being a good fit once transitions aren't a pure function of `(state,
command)`.
