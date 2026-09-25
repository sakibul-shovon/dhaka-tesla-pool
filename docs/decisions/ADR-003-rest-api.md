# ADR-003 — REST over GraphQL for the API

- **Status:** Accepted
- **Date:** 2026-09-25
- **Branch:** feature/project-foundation

## Context

PRD §6 leaves the API style open ("REST/GraphQL/other — explain your choice") but asks for clear
resource design, validation and error handling that an evaluator can read quickly.

## Decision

Plain REST under `/api/v1`, JSON only. Conventions fixed now so every later session follows the same
shape: success `{ "data": ... }`, paginated `{ "data": [...], "page": { "limit", "nextCursor" } }`, error
`{ "error": { "code", "message", "requestId", "details"? } }`. Errors use a shared, typed error-code
catalog (`packages/shared`) instead of ad-hoc strings. Every response carries `X-Request-Id`.

## Alternatives considered

- **GraphQL** — one endpoint, flexible queries — but this app has a small, fixed set of screens (plan
  §15.2), not varied clients with different data needs. A GraphQL layer would add a schema/resolver layer
  around the same use cases for no read-shape benefit, and makes REST-shaped things like idempotency keys
  and HTTP status codes (409 for a lost race) less natural to express.
- **tRPC** — great when client and server share a language end to end, but couples the web client's types
  directly to server internals in a way that's harder to reason about at review time than an explicit,
  documented HTTP contract.

## Why this fits Dhaka Tesla Pool

Ride/pool state changes map naturally onto HTTP semantics: `POST /ride-requests` (201), `POST
/pools/:id/join` (200 or 409 with a specific code the UI switches on), `GET .../history` (paginated).
The evaluator can `curl` any endpoint and read the error catalog to understand failure modes without
reading resolver code.

## Trade-offs and consequences

Over-fetching/under-fetching is possible on some screens (mitigated by shaping responses per screen, e.g.
`GET /ride-requests/:id` already includes the pool summary it needs). No single introspectable schema —
mitigated by the API contract living in the plan (§12.2) and the shared error-code catalog being the
single source of truth for codes.

## Revisit when

Multiple independent frontends need different shapes from the same resources, or the number of
purpose-built "screen" endpoints starts duplicating logic.
