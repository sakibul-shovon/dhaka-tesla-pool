# Assumptions

Every ambiguity in the PRD was resolved by picking one concrete behavior rather than building
something configurable "to be safe." Each row below is a real design decision with a real
consequence — not a footnote.

| # | Assumption | Why | If it changes |
|---|---|---|---|
| A1 | Geography = 10 zones on a km grid, Manhattan distance | PRD §4: don't fight maps; must be hand-checkable | Replace `geography.ts` / `matching.ts`; schema unchanged |
| A2 | One vehicle per driver | Story has one Tesla per driver | Drop unique on `vehicles.driver_id`; add "active vehicle" selection |
| A3 | Public registration creates passengers only; drivers are provisioned (seed) | Prevents role escalation; driver onboarding/KYC out of scope | Add driver onboarding with review state |
| A4 | ≤ 1 active ride per passenger | Real-world norm; kills a class of duplicates | Drop partial unique; rely on idempotency only |
| A5 | A pool has one pickup zone | Makes "driver arrived" meaningful for all members | Multi-stop pickups need per-member arrival |
| A6 | Joining only while OPEN | Boarding shouldn't change seats | Allow DRIVER_ARRIVED joins with per-member arrival |
| A7 | Fares snapshotted at request; discount decided at START; never above quote | Fair to first passenger; fare immutable once riding | Upfront pooled pricing would fix fare at join |
| A8 | Discount needs ≥ 2 distinct bookings | Sharing means strangers, not your own extra seat | Change predicate in one function |
| A9 | Per-seat pricing | Simple, hand-checkable | Add group pricing rule |
| A10 | Completion is per passenger (drop-off); pool completes after the last | Different destinations | — |
| A11 | Passenger may cancel until STARTED, no fee | MVP simplicity | Add fee after arrival |
| A12 | Driver may mark no-show only after arrival | Otherwise no evidence of no-show | — |
| A13 | Empty pools auto-cancel | Frees the vehicle's single active slot | — |
| A14 | Driver cancel → member rides cancelled, not re-queued | Scope | Re-queue to REQUESTED with history |
| A15 | Driver can go offline only without an active pool | Avoid orphaned passengers | Add hand-off/cancel flow |
| A16 | Driver declares current zone when going online | No GPS | Replace with location updates |
| A17 | No automatic expiry of REQUESTED rides (P2) | Scope; passenger can cancel | Add lazy expiry on read or a scheduled sweep |
| A18 | Co-riders see a count, not names | "not accidentally make a new friend" | — |
| A19 | Currency BDT, integer paisa | Deterministic arithmetic | — |
| A20 | Cash default; TeslaPay simulated (P2, shipped) | No real gateway (PRD §5) | Payment provider behind an interface |
| A21 | Polling, not WebSockets | Human-paced updates | SSE gateway at scale |
| A22 | Vehicle capacity not mutable via API; pools snapshot capacity | Concurrency matrix C11 | Admin endpoint rejecting change during active pool |
| A23 | Max 3 seats per request (product), DB allows 1..6 (physical) | Bullet has 3 seats | Config value |
| A24 | `EMAIL_TAKEN` is disclosed on registration | Usability; mitigated by rate limit | Switch to email-verification flow with generic response |
| A25 | Timestamps stored UTC, displayed Asia/Dhaka | — | — |
| A26 | Public deployment is preferred, not mandatory (PRD §6/§14); Compose is the guaranteed path | PRD wording | If evaluators require a live URL, the free stack in `docs/DEPLOYMENT.md` already provides one |

## Notes on assumptions that turned out differently than first planned

- **A20** was written as "P2, only if P0/P1 are done" when the plan was drafted before any code
  existed. `feature/teslapay-wallet` (Session 11) shipped it after the full MVP and concurrency-safety
  work — the assumption itself (cash is the default, TeslaPay is simulated, no real payment gateway)
  held throughout; only its scheduling changed.
- **A17** (no automatic expiry of stale `REQUESTED` rides) remains unimplemented — see
  [`docs/LIMITATIONS.md`](LIMITATIONS.md).
