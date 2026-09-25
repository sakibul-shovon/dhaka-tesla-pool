# ADR-004 — Opaque server-side sessions, not JWT

- **Status:** Accepted
- **Date:** 2026-09-26
- **Branch:** feature/passenger-auth

## Context

PRD §6 leaves auth strategy open ("auth ... justified in README"). The product needs logout and account
suspension to take effect immediately (plan §6 `account_status`, `Session.revokedAt`) — a passenger
Jashim suspends mid-ride can't still be treated as logged in five minutes later just because a token
hasn't expired yet.

## Decision

A session is a random 32-byte token (`node:crypto.randomBytes`, base64url) sent to the browser only as an
httpOnly, `SameSite=Lax` cookie (`dtp_session`); the server stores only its SHA-256 hash
(`sessions.token_hash`), never the token itself. Every authenticated request looks the hash up
(`resolveSession`), and rejects it if revoked, expired, or the owning user is suspended — all three read
from the database on every request, so there is nothing to wait out.

## Alternatives considered

- **JWT (access + refresh tokens)** — no database round-trip to check validity, which is the whole appeal,
  but that's also the problem: a JWT is valid until it expires, full stop. Logging out or suspending
  Jashim would need a denylist anyway (checked on every request) — at which point it costs exactly what a
  session lookup costs, plus refresh-token rotation complexity, plus the token sits in JS-reachable
  storage unless it's *also* in an httpOnly cookie (in which case most of JWT's stated advantage over a
  session cookie disappears).
- **Storing the raw token** — a stolen database row would be directly replayable as a live session;
  hashing costs nothing at write time and means a DB leak alone doesn't leak active sessions.

## Why this fits Dhaka Tesla Pool

The PRD's concurrency scenario and general security bar (§12, §14) care about correctness holding under
adversarial and edge-case conditions, not raw auth throughput — this project doesn't have a JWT-scale
problem (no microservices independently verifying tokens without hitting the DB) to justify JWT's
complexity. `auth.int.test.ts`'s "reject reuse after logout" test is the concrete proof: revocation is
immediate because every request re-checks the database.

## Trade-offs and consequences

One indexed lookup (`sessions.token_hash` is unique-indexed) per authenticated request — negligible at
this scale, and the honest cost of "logout actually logs you out." No cross-service verification without
hitting the same database, which is fine for the modular-monolith shape (ADR-001).

## Revisit when

Multi-region deployment or very high request rates make the per-request session lookup a measurable
bottleneck — then cache session lookups (e.g. short-TTL in-memory cache keyed by token hash) before
reaching for stateless tokens again.
