# ADR-009 — Polling, not WebSockets

- **Status:** Accepted
- **Date:** 2026-09-26
- **Branch:** feature/web-passenger

## Context

A passenger's ride status (plan §9.1) changes on a human timescale — a driver accepting, arriving,
starting, dropping someone off — never faster than a few times a minute. The screen watching it needs to
notice a change within a few seconds, not milliseconds.

## Decision

TanStack Query's `refetchInterval`, driven by `lib/polling.ts::createRefetchInterval` (plan §15.4): 3s
for an active ride, stopped entirely once the ride is terminal, paused when the tab is hidden or the
browser is offline (TanStack Query's own defaults), and backed off (3s → 6s → 12s → 24s → capped 30s) on
consecutive failures instead of hammering a struggling or sleeping (free-tier cold-start) server.

## Alternatives considered

- **WebSockets** — push instead of poll, and lower latency in principle, but introduces a connection
  lifecycle (reconnect on drop, auth handshake, an out-of-order-message question) for updates that are
  already fast enough at a 3-second poll. It also doesn't survive this project's free-tier hosting shape
  well: Render's free web service can sleep after 15 idle minutes (plan §18.3) — a held-open WebSocket
  either prevents that sleep (defeating the free tier's cost model) or drops and needs the same
  reconnection logic polling never needed in the first place.
- **Server-Sent Events (SSE)** — simpler than WebSockets (one-way, plain HTTP), and a reasonable middle
  ground, but has the identical free-tier problem: a long-lived connection through a proxy (Netlify) and a
  sleep-capable backend (Render) is exactly the shape those platforms are least suited to hold open
  reliably.

## Why this fits Dhaka Tesla Pool

Polling has no connection lifecycle to reason about or test — `lib/polling.test.ts` and
`lib/polling.integration.test.tsx` test it as plain functions and a plain `useQuery`, not a stateful
socket with reconnect/backoff/heartbeat logic of its own. It also composes for free with everything
TanStack Query already gives every other screen: caching, `refetchOnWindowFocus`, and the same
error/loading states — a WebSocket update would need a separate code path to land in the same cache.

## Trade-offs and consequences

Some redundant requests when nothing has changed — negligible at this scale and explicitly not the
free-tier risk (plan §15.4: "a few demo users polling every 3s is ~1-2 requests/second, trivial for
Express"). Worst case, a change takes up to one poll interval to show up; acceptable for a human watching
a ride, not acceptable for, say, a trading ticker — this isn't one.

## Revisit when

The driver fleet grows enough that polling's read load on "relevant requests" (plan §12.2) becomes the
bottleneck `docs/SCALABILITY.md` already flags — that's a backend fan-out problem an SSE/WebSocket gateway
solves, independent of whether *this* passenger screen keeps polling.
