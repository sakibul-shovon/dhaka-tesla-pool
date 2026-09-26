# ADR-015 — Fare snapshotted at request, finalized at trip start

- **Status:** Accepted
- **Date:** 2026-09-25
- **Branch:** feature/ride-requests

## Context

A passenger sees a quote before a driver has even accepted them, and the pooled discount only applies
once a second passenger genuinely shares the vehicle. Something has to decide, and freeze, which number
the passenger actually owes — and it has to do it without ever letting the answer move against them
between the quote and the charge.

## Decision

`solo_fare_paisa` and `pooled_fare_paisa` are computed once, from server-side inputs only, and stored on
the `ride_requests` row at **creation**. The client's own numbers are never read for anything but display.
The fare stays *unfixed* (shown as a range: "৳67.50 — drops to ৳54.00 if someone shares your Tesla")
until the pool actually **starts**. At that moment, under the pool's row lock, every unreleased
membership gets `final_fare_paisa` set to `pooled_fare_paisa` if the pool has two or more unreleased
bookings at that instant, otherwise `solo_fare_paisa` — and `shared_ride` records which happened. Both
columns are immutable from then on.

## Alternatives considered

- **Fix the fare at match/join time.** Simpler to reason about in isolation, but wrong for the PRD's own
  story: if Nusrat is accepted first and Rafiq joins two minutes later, fixing Nusrat's fare at her own
  match moment would either charge her solo (denying her the discount she's about to actually get) or
  require rewriting an already-fixed fare later, which reopens exactly the "can this number move" question
  this decision exists to close.
- **Fix the fare at pool creation** (whatever the first passenger's fare situation is, freeze it for
  everyone who joins after). Punishes or rewards passengers based on unrelated timing — the first
  passenger into a pool has no way to know whether anyone else will ever join.
- **Never finalize — always compute the discount live from current membership count, even after
  drop-off.** Makes "how much did Nusrat pay" a moving target answerable only by re-deriving it from
  history, and directly conflicts with plan §10.7's atomicity guarantee that a completed record stays
  completed.

## Why this fits Dhaka Tesla Pool

This is the concurrency-safety story and the fare story colliding on purpose: fixing the fare *inside*
the same locked transaction that moves the pool to `STARTED` (plan §10.4's `start` transaction script)
means there is no window where the pool's membership count and the fare it produces could be read
inconsistently. `pool-lifecycle.int.test.ts`'s "pooled fares fixed at start" test is the direct proof —
Nusrat and Rafiq both land on their pooled fare only once they're genuinely both aboard when the driver
starts, not before.

## Trade-offs and consequences

- The fare can only ever move **down** from the original quote, never up — a passenger who saw ৳67.50
  can be pleasantly surprised by ৳54.00 later, never the reverse. This is a deliberate fairness
  guarantee, not an incidental property.
- A co-rider cancelling before `START` correctly removes the discount for whoever's left, since the
  membership count that decides `shared_ride` is read fresh at that moment, not carried over from an
  earlier snapshot.
- Once `STARTED`, cancellation is illegal (plan's ride state machine), which is exactly what keeps the
  fare truly immutable — there's no later mutation path that would need to touch it again.

## Revisit when

If the product ever needs a passenger to see their real final fare (not a range) before the trip starts —
for example, a "confirm and pay upfront" flow — this decision would need to move fare-fixing earlier,
which reopens the punished-for-being-first problem above and would need its own resolution (e.g., an
upfront pooled-price guarantee with the platform absorbing the gap if no one else joins).
