# ADR-006 — Pessimistic row locking over optimistic versioning or SERIALIZABLE

- **Status:** Accepted
- **Date:** 2026-09-26
- **Branch:** feature/concurrency-safety

## Context

Bullet has a fixed number of seats. Two passengers can see "1 seat left" at the same instant and both try
to take it (plan §10.5's Nusrat/Shirin race) — this is the PRD's central concurrency requirement, not an
edge case. Whatever mechanism resolves it has to also cover the driver accepting the same request twice,
a driver starting the trip while a passenger cancels, and a client retrying a timed-out request without
double-booking anyone. This decision was made — and the locking/lock-order/idempotency machinery built —
starting in `feature/driver-flow` and `feature/ride-requests`; this ADR was written retroactively in
`feature/concurrency-safety`, the session that adds the timeout/retry wrapper and the test suite that
actually proves the design holds under concurrent load (`test/concurrency/*`).

## Decision

**Pessimistic row locks (`SELECT ... FOR UPDATE`) inside short READ COMMITTED transactions**, with a
documented global lock order (`vehicles → pools → ride_requests`, ascending id within a batch) to prevent
deadlock cycles, database CHECK/unique constraints as a backstop if a bug slips past the app-level check,
and idempotency keys (ADR-010) so a client's retry never repeats a write. A thin transaction runner
(`lib/transaction.ts`) sets `lock_timeout = 3s` / `statement_timeout = 5s` on every transaction and retries
only `40P01` (deadlock) / `40001` (serialization failure) up to 3 times with jittered backoff; a lock or
statement timeout maps to `503 SERVICE_BUSY` instead of retrying, since retrying a system that's already
backed up just waits again.

## Alternatives considered

- **Optimistic concurrency (a `version` column, retry on conflict)** — contention here is concentrated on
  exactly one hot row (the pool with one seat left), not spread across many rows that rarely collide, which
  is optimistic locking's good case. Every loser would still have to retry just to read the same "seat's
  gone" outcome a lock gives them immediately; a lock makes losers wait a few milliseconds instead of
  round-tripping the whole request again.
- **A single atomic `UPDATE pools SET seats_reserved = seats_reserved + $n WHERE seats_reserved + $n <=
  capacity_snapshot`** — this alone correctly serializes the seat *count*, but joining a pool is not just a
  counter increment: it also has to check the pool is still `OPEN`, check the new passenger's drop-off
  against every current member's (plan §7.2's 3.5 km rule), and insert the membership consistently with
  whatever member list was actually read. Locking the pool row turns that whole multi-step decision into
  one serialized critical section that's easy to point at in code; a bare atomic `UPDATE` would still need
  a separate mechanism for the compatibility check anyway.
- **`SERIALIZABLE` isolation everywhere** — correct, but it turns "which operations can conflict" into an
  implicit property of the whole transaction graph instead of something visible at the call site, and it
  means *any* write path can get a serialization failure and needs retry logic, not just the two or three
  that actually touch contended rows. Explicit locks keep the critical sections visible — which also matters
  for being able to explain the design, not just have it work.

## Why this fits Dhaka Tesla Pool

The whole design leans on one PostgreSQL guarantee, cited directly in plan §10.5: under READ COMMITTED, a
transaction blocked on `SELECT ... FOR UPDATE` re-reads the row *after* the lock holder commits, so the
loser's capacity check always runs against the committed truth, never a stale snapshot. `test/concurrency/
last-seat-race.test.ts` (C1) proves exactly this for 2-way and 10-way contention; `start-vs-cancel.test.ts`
(C4) and `double-cancel.test.ts` (C10) prove the same lock-the-pool-first convention correctly serializes a
driver's `start` against a passenger's `cancel`, and two passengers cancelling at once, without ever leaving
`seats_reserved` inconsistent with the memberships behind it. `test/concurrency/naive-join-control.test.ts`
(plan §16.5) runs a deliberately unlocked read-sleep-write join through the same harness to prove the
harness itself would have caught the bug this design prevents — if it couldn't catch the naive version, the
passing tests for the real version would prove nothing.

## Trade-offs and consequences

- A blocked transaction holds a connection from the pg connection pool for the duration of the wait, not
  just its own work; under real contention this needs enough pool headroom
  (`test/concurrency` sizes its pg `Pool` at `N + 2` connections for an N-way race), and at production scale
  would need the lock windows kept short, which the 3s `lock_timeout` already forces.
- The global lock order is a convention enforced at runtime by `LockOrderGuard.assert()`, not by the type
  system — a new write path that acquires locks out of order fails loudly in dev/test (a thrown "lock order
  violation" error) rather than silently risking a deadlock in production, but it does depend on every new
  write path actually using the shared locking helpers instead of a raw query.
- `SERVICE_BUSY` on a timeout, rather than retrying, means a genuinely overloaded moment surfaces to the
  client as "try again" instead of the server quietly queuing more work behind an already-slow transaction.

## Revisit when

If seat contention moves from "one hot pool row, occasionally" to "many passengers hammering the same pool
continuously" (a viral pickup zone, say), short lock waits stop being enough and the design would need to
move toward a queue (accept join requests, process them one at a time) rather than having every request
race for the same row lock.
