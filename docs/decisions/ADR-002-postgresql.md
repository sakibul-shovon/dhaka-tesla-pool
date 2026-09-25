# ADR-002 — PostgreSQL as the database

- **Status:** Accepted
- **Date:** 2026-09-25
- **Branch:** feature/database-schema

## Context

PRD §6 asks for a relational store and leaves the specific engine to the candidate, justified. The
hardest requirement in the whole brief (PRD §14: Bullet's last seat, two passengers, one winner) is a
data-consistency problem, not a query-language problem.

## Decision

PostgreSQL 17. The schema (`apps/api/src/db/schema.ts`) leans on row locks (`SELECT ... FOR UPDATE`,
added when the write paths land in later sessions), `CHECK` constraints, partial unique indexes, and a
trigger that makes the two history tables append-only at the database level.

## Alternatives considered

- **MySQL** — capable of the same locking pattern, but partial (filtered) unique indexes — the mechanism
  behind "one active ride per passenger" and "one active pool per vehicle" — aren't native; they'd need a
  generated-column workaround.
- **SQLite** — fine for a single-writer toy, but the concurrency problem this PRD is graded on (§14) is
  exactly what SQLite's single-writer lock hides rather than exercises; the plan's own naive-join test
  (§16.5) would pass for the wrong reason.

## Why this fits Dhaka Tesla Pool

Every hard invariant in §6 of the plan (`vehicles_capacity_range`, `pools_seats_within_capacity`,
`ride_requests_active_per_passenger`, the history-immutability trigger — all in this branch's migrations)
maps directly onto a Postgres feature, not application code the evaluator has to trust blindly.

## Trade-offs and consequences

One more moving part to run locally (a real Postgres, not a file) — mitigated by Docker Compose and a
free-tier managed instance (Neon) for deployment (plan §18.3). Schema changes need migrations instead of
just editing a file, which is the discipline the PRD is grading in the first place.

## Revisit when

Geospatial matching at real scale needs PostGIS — that's an extension on the same database, not a new one.
