# ADR-012 — Integration tests run against a real Postgres, not a fake

- **Status:** Accepted
- **Date:** 2026-09-25
- **Branch:** feature/database-schema

## Context

PRD §12 explicitly requires proof that "two concurrent requests can't corrupt pool capacity." That claim
is only true of the actual lock/constraint mechanism, not of a mock.

## Decision

Vitest for both layers. Unit tests run against pure functions with no I/O. Integration tests
(`*.int.test.ts`) run against a real PostgreSQL reachable at `DATABASE_URL` — locally via Docker, in CI via
a `postgres:17-alpine` service container (`.github/workflows/ci.yml`). A Vitest `globalSetup`
(`test/support/global-setup.ts`) runs migrations once before the suite; each integration test truncates
the business tables afterward (`test/support/truncate.ts`) and leaves the migration-seeded `zones` table
alone. Test files run without file-level parallelism (`vitest.config.ts`) because they share one database
and truncate between tests — running two files at once would let them truncate each other's fixtures.

## Alternatives considered

- **pg-mem (in-memory Postgres emulator)** — fast, but doesn't implement row locking semantics, so the
  concurrency tests this project is graded on (plan §16.5's own "naive join" control, added in
  `feature/concurrency-safety`) would pass against the mock for the wrong reason: the mock, not the code,
  would prevent the race.
- **SQLite for tests, Postgres in production** — the constraint types this schema depends on (partial
  unique indexes, multi-column `CHECK`, `FOR UPDATE`) don't all exist in SQLite; a passing test suite
  would not prove the production constraints work.

## Why this fits Dhaka Tesla Pool

This session's own tests are the first proof the decision is right: `db-constraints.int.test.ts` inserts
invalid rows via raw SQL and asserts Postgres itself rejects them — a mock has no CHECK constraint to
violate. `assertInvariants` (plan §16.4) queries real rows with real `JOIN`s.

## Trade-offs and consequences

Integration tests are slower than an in-memory suite (seconds, not milliseconds) and need Docker or a
reachable Postgres to run at all — acceptable given what they're proving. No test can run standalone
without that dependency; documented in `CLAUDE.md`'s Commands section.

## Revisit when

Suite runtime becomes a real bottleneck — then split "needs a lock, must be real" tests from
"needs a schema, could be faked" tests instead of reaching for a mock across the board.
