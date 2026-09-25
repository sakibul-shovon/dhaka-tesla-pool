# ADR-005 — Money as integer paisa, never a float

- **Status:** Accepted
- **Date:** 2026-09-25
- **Branch:** feature/fare-engine

## Context

PRD §5 explicitly asks how money is stored and why ("integer paisa/poysha vs. decimal"). Fares are
computed (base + distance charge), discounted (a basis-point percentage), summed across passengers, and
compared (`pooled <= solo`) — every one of those is a place a float silently loses a fraction of a paisa.

## Decision

`Paisa` is a branded `number` (`packages/shared/src/money.ts`): a plain integer at runtime (cheap, no
library, serializes as a normal JSON number over the API), but a distinct type at compile time so a bare
`number` can't be passed where money is expected without going through `paisa()`, which rejects
non-integers. `formatPaisaAsTaka` is the one place paisa becomes a decimal string, for display only —
computation never touches decimals.

## Alternatives considered

- **Floating-point taka (`number`, e.g. `67.5`)** — `0.1 + 0.2 !== 0.3` in IEEE 754; a discount computed on
  a float total can be off by a fraction of a paisa in a way that's hard to reproduce and easy to get
  wrong in a refund/reconciliation later.
- **A decimal/bignum library (e.g. `decimal.js`)** — correct, but paisa is already an integer unit (no
  smaller denomination exists), so a library adds a dependency and an API surface to solve a problem
  plain integers already solve for free.
- **`bigint`** — also exact, but PostgreSQL's `integer` (used for `*_paisa` columns, plan §5.2) tops out
  at ~21.4 million taka per value, far beyond any single fare; `bigint` would be reaching for safety the
  domain doesn't need and complicates JSON serialization (no native `bigint` in `JSON.stringify`).

## Why this fits Dhaka Tesla Pool

The evaluator can hand-check Nusrat's fare (plan §8.3): `3000 + 150×25 = 6750`, `floor(6750×0.20) = 1350`,
`6750 − 1350 = 5400` — all exact integer arithmetic, matching `fare.unit`'s assertions paisa-for-paisa.
Every `*_paisa` database column is `integer` with a `CHECK ... >= 0` (plan §6); the type and the storage
agree by construction.

## Trade-offs and consequences

Every fare-related test and API response deals in whole paisa, not `67.50` — display formatting is a
required step (`formatPaisaAsTaka`), not implicit. Worth it: the alternative is a class of rounding bugs
that only show up when totals are large or discounts are unusual.

## Revisit when

A currency without an integer-sized smallest unit is added — not a concern for BDT.
