# ADR-013 — Vite + React Router, not Next.js

- **Status:** Accepted
- **Date:** 2026-09-26
- **Branch:** feature/web-passenger

## Context

PRD §6 recommends Next.js "for routing/SSR" but explicitly allows "plain React + a router." Every screen
in this app (login, request a ride, watch it live, history) is behind authentication and driven by
client-side state that changes on its own (polling) — none of it needs to be rendered on a server or
indexed by a search engine.

## Decision

Vite + React + TypeScript + React Router + TanStack Query. The API is served same-origin behind nginx in
production (`/api/*` proxy, plan §18.3) and behind Vite's own dev proxy locally (`vite.config.ts`), so the
app never talks cross-origin regardless of framework choice.

## Alternatives considered

- **Next.js (App Router)** — its main advantages are server rendering and file-based routing for
  content that benefits from being crawlable or fast-on-first-paint without JS. Nothing here is public
  content: every route requires a session cookie, so SSR would either have to skip rendering the real page
  (defeating the purpose) or forward the cookie server-side just to fetch the same data the client would
  fetch anyway — extra runtime complexity (a Node server process, not just static files) for no user-facing
  benefit.
- **Client-side Next.js (`"use client"` everywhere, no SSR)** — technically possible, but then it's Next's
  routing conventions and build system without using the feature that justifies picking it over Vite.

## Why this fits Dhaka Tesla Pool

One fewer server runtime to run, monitor, and fit into the free-tier deployment (plan §18.3: the web
service is a static build served by nginx, not a Node process) — directly simplifies the "does this run
reliably elsewhere" question the Docker/Deploy scoring criterion (PRD §15) asks about. `vite build`
produces the exact static output `apps/web/Dockerfile`'s nginx stage serves.

## Trade-offs and consequences

No server-rendered first paint (a brief blank screen while the JS bundle loads and `/auth/me` resolves) —
acceptable for an authenticated tool nobody reaches from a cold search-engine link. If a public, crawlable
page is ever needed (marketing page, public status page), it can be a separate static page or a different
tool entirely rather than pulling the whole authenticated app into SSR.

## Revisit when

A genuinely public, SEO-relevant page is needed, or first-paint latency on a slow connection becomes a
measured problem this dataset's users actually hit.
