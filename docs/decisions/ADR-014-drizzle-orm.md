# ADR-014 — Drizzle ORM for schema and migrations

- **Status:** Accepted
- **Date:** 2026-09-25
- **Branch:** feature/database-schema

## Context

The schema's hardest constraints are exactly the ones a typical ORM makes awkward: partial (filtered)
unique indexes, table-level `CHECK` constraints referencing multiple columns, and — in later sessions —
`SELECT ... FOR UPDATE` row locks inside a hand-controlled transaction.

## Decision

Drizzle ORM (`drizzle-orm` + `drizzle-kit`). The schema is TypeScript (`src/db/schema.ts`); `drizzle-kit
generate` diffs it into plain, reviewable SQL migration files (`src/db/migrations/*.sql`), and
`drizzle-orm/node-postgres/migrator` applies them (`src/db/migrate.ts`). Two migrations are hand-written
rather than generated: the history-immutability trigger and the zones seed data, because triggers and
one-off data aren't part of the table shape Drizzle diffs.

## Alternatives considered

- **Prisma** — best-in-class DX, but as of this decision has no query-builder API for `SELECT ... FOR
  UPDATE`; the seat-reservation transaction (plan §10.4) would need to drop to raw SQL anyway, at which
  point the ORM is only helping with the easy 90% of the code.
- **Knex / Kysely** — Kysely's type safety is excellent but it's a query builder, not a migration tool;
  would need a second tool (e.g. node-pg-migrate) just for schema evolution, splitting the source of truth
  across two files instead of one.

## Why this fits Dhaka Tesla Pool

`schema.ts` declares `check()` and `.where()` on `uniqueIndex()` directly next to the columns they
constrain — the same file an evaluator reads to understand the table also proves the constraint is real
(the generated SQL in `0000_initial_schema.sql` is the artifact that actually runs). Later sessions'
locking code (plan §10) uses `db.execute(sql\`...\`)` / the node-postgres driver directly for the same
reason: no ORM abstraction sits between the code and the lock.

## Trade-offs and consequences

Two sources of truth in spirit (TypeScript schema, generated SQL) but one in practice — the SQL is
generated, never hand-edited except the two custom migrations, which are commented to say so. Drizzle's
migration story is younger than Prisma's; mitigated by keeping migrations as plain SQL, which is portable
if the tooling is ever swapped.

## Revisit when

A query pattern needs relational-mapping conveniences (nested includes, computed fields) that raw
SQL/Drizzle's query API make genuinely painful — not before.
