# ADR-008 — Zone grid geography and the pool matching rule

- **Status:** Accepted
- **Date:** 2026-09-25
- **Branch:** feature/fare-engine

## Context

PRD §4 explicitly forbids fighting real map APIs for this challenge, but still requires "a matching rule
... applied consistently to Nusrat and Rafiq's overlapping-but-not-identical trip" — the rule has to be
real enough to correctly separate a genuinely compatible pair (Nusrat/Rafiq) from an incompatible one
(Nusrat/Shirin), and simple enough that an evaluator can verify it by hand.

## Decision

Ten Dhaka-area zones placed on a km grid (plan §7.1), coordinates stored in tenths of a km (`dkm`) so
distance is an exact integer. Distance is Manhattan (`|Δx| + |Δy|`), computed in
`domain/geography.ts::manhattanDistanceDkm`. A request may join an open pool
(`domain/matching.ts::canJoin`) only if, checked **in this order**: the pool is `OPEN`, the request is
`REQUESTED`, the pool has enough remaining capacity, the pickup zones match, and every existing member's
drop-off is within `MAX_DROPOFF_SPREAD_DKM = 35` (3.5 km, inclusive) of the new request's drop-off. The
check order is deliberate: it decides which error the loser of a race sees (a full pool is
`POOL_CAPACITY_EXCEEDED` even if the pickup zone also happens to mismatch).

## Alternatives considered

- **A real routing/geocoding API** — explicitly out of scope (PRD §4); also nondeterministic and
  rate-limited, which would make the concurrency and matching tests (plan §16) flaky for reasons that have
  nothing to do with the code under test.
- **Straight-line (Euclidean) distance** — plausible, but Manhattan distance more honestly models a city
  grid and — more importantly for grading — is trivial to verify by hand without a calculator that does
  square roots.
- **Same pickup *and* same drop-off required (no spread)** — simpler, but would make Nusrat
  (→Mohakhali) and Rafiq (→Gulshan 1) — the PRD's own worked example — incompatible, defeating the point
  of the brief.

## Why this fits Dhaka Tesla Pool

Nusrat (→ Mohakhali) and Rafiq (→ Gulshan 1) are 2.5 km apart → compatible; Nusrat and Shirin (→ Gulshan 2)
are 4.5 km apart → incompatible — exactly the outcome PRD §4 asks for, asserted in `matching.unit`
against the real zone grid, not a mock. `canJoin` takes plain values (no DB row shapes), so the function
signature stays stable if the underlying distance model is ever replaced with real routing.

## Trade-offs and consequences

Coordinates are approximate and documented as such (plan §7.1) — nobody should mistake this for routing.
The grid is duplicated as a constant in `domain/geography.ts` and as seed rows in the `zones` migration:
intentional, because the domain layer must stay pure (no DB access, plan §4.2) while the DB copy serves
`GET /zones` and foreign-key integrity. A comment in both places says to keep them in sync; a future
session could add a CI check that diffs them if this becomes a real drift risk.

## Revisit when

Real geospatial matching is needed (PostGIS / H3 cells) — `docs/SCALABILITY.md` reasons through this
without building it now.
