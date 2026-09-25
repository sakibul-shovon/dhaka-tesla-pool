# ADR-001 — Modular monolith over microservices

- **Status:** Accepted
- **Date:** 2026-09-25
- **Branch:** feature/project-foundation

## Context

PRD §9 explicitly warns against introducing microservices, Kafka, Kubernetes, Redis or queues "just to
look advanced." The system has one write-heavy hot path (seat reservation) and a handful of read paths;
it needs to be explainable end to end in a six-minute video and defensible live in an interview.

## Decision

One API process (Express), one PostgreSQL database, one static frontend. Modules are separated by folder
(`modules/auth`, `modules/rides`, `modules/pools`, `modules/driver`, ...) and by a strict dependency
direction (routes → use cases → domain / repositories), not by network hops.

## Alternatives considered

- **Microservices per domain (auth, rides, pools)** — adds network calls, distributed transactions and
  deployment complexity for a problem (pool capacity) that is fundamentally a single-database locking
  problem. Nothing here needs independent scaling or independent deploy cadence yet.
- **Serverless functions per endpoint** — complicates the exact thing that matters most (holding a
  `SELECT ... FOR UPDATE` lock across a short transaction) and free-tier cold starts would compound with
  function cold starts.

## Why this fits Dhaka Tesla Pool

The hardest requirement (Bullet's capacity can never be exceeded) is solved by row locks and constraints
inside one transaction against one database. Splitting the write path across services would turn a local
lock into a distributed-transaction problem for no product benefit.

## Trade-offs and consequences

Everything scales together — acceptable at MVP/interview scale. The read-heavy paths (driver's relevant
requests, polling) will be the first thing to outgrow this shape; `docs/SCALABILITY.md` (written in
`pre-release`) reasons through the split at 1M passengers / 100k drivers without building it now.

## Revisit when

A specific module needs independent scaling, independent deploys, or a different language/runtime —
not before.
