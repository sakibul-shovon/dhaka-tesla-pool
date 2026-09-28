# Scalability

This is reasoning, not a build plan — what would actually break first if Dhaka Tesla Pool went from a
handful of interview evaluators to something like 1,000,000 passengers and 100,000 drivers, and what the
honest fix looks like for each. Every "why not now" answer is the same shape: the current design already
handles the load this project is actually built for, and building the scaled version first would mean
guessing at a shape the real bottleneck hasn't revealed yet.

## What breaks first, roughly in order

### 1. Polling load on "active ride" and "driver requests" reads

Every passenger with an active ride polls `GET /ride-requests/:id` every 3–30 seconds (backing off);
every online driver polls `GET /driver/requests` on the same cadence (§15.4). At today's scale this is a
handful of cheap, indexed reads per second. At a million concurrent riders it's a read-traffic pattern
dominated almost entirely by polling, not by anything a user actually did.

**Fix:** replace polling with a push channel — Server-Sent Events for status updates (one-way, fits this
domain exactly: the server pushes exactly the same shape of data the client already polls for) or
WebSockets if bidirectional low-latency features get added later. Pair it with **read replicas** for
whatever reads still happen on demand (history, offers) so the primary only serves writes and the
strongly-consistent reads that need it (the seat-reservation transaction).

**Why not now:** the polling design (ADR-009) was chosen specifically because it works identically on a
free-tier host that scales to zero and wakes on demand — an SSE/WebSocket connection needs a
long-lived process, which is the opposite of what a serverless-friendly free tier rewards. Building the
push infrastructure now would mean paying its operational cost (a stateful gateway, connection
management, reconnection logic) for a scale this deployment will never see.

### 2. Matching by zone scan

`matching.ts`'s compatibility check and the pool-offers listing both work by scanning candidate pools in
one pickup zone and checking each one's members' drop-off distance. With 10 zones and a handful of pools
per zone, this is a few dozen comparisons. With 100,000 drivers spread across a real city, "all open pools
in this zone" stops being a small number.

**Fix:** a geospatial index (PostGIS, or H3/S2 cell-based bucketing) so "nearby compatible pools" is an
index range scan, not a full scan of a zone; likely paired with a dedicated matching service that
consumes ride-request and pool-state *events* rather than being called synchronously inside the request
path, so matching latency is decoupled from API request latency.

**Why not now:** the PRD's own geography model is 10 hand-checkable zones on a grid (A1) precisely so the
matching rule can be read, tested and explained in a live interview without a mapping library. Real
geospatial matching is a materially different system with different tests, different failure modes
(what does "nearby" mean at a city boundary?) and no way to verify it by hand.

### 3. API connection count

Each API instance holds its own Postgres connection pool (`DB_POOL_MAX`, currently 5, tuned for a single
free-tier instance against Neon's connection limits). Horizontally scaling the API to N instances
multiplies that by N — Postgres has a hard ceiling on total connections regardless of how much compute
is thrown at it.

**Fix:** PgBouncer (or Neon's own pooled connection mode) in front of Postgres, in transaction-pooling
mode, before adding a second API instance. Note this is exactly why `18.3`'s deployment decision uses the
**direct (unpooled)** connection string for the single-instance free-tier deployment — transaction-mode
pooling doesn't preserve session-level state like `SET LOCAL lock_timeout`, which the transaction runner
(plan §10.3) relies on for every write.

**Why not now:** one Render instance is the entire free-tier budget (750 instance-hours/month covers
exactly one always-on service); there is nothing to pool connections *for* yet.

### 4. Session lookups

Every authenticated request resolves its session cookie with a database read (`resolveSession`, joining
`sessions` and `users`). At today's traffic this is one indexed lookup per request, effectively free. At
scale, it's a database round trip on every single request, including ones that touch no other data at
all.

**Fix:** a cache in front of session resolution (Redis, or an in-process LRU if session invalidation
latency of a few seconds is acceptable) keyed by token hash, invalidated on logout/revocation.

**Why not now:** opaque server-side sessions were chosen over JWTs specifically so a session could be
revoked immediately (ADR-004) — logout, suspension, and (implicitly) a compromised token all take effect
on the next request, not "whenever the token expires." Adding a cache reintroduces exactly the staleness
window that design was built to avoid, and isn't worth it below the request volume where a database
lookup is actually the bottleneck.

### 5. In-memory rate limits

The login/register rate limiters (`http/middleware/rate-limit.ts`) keep their counters in the API
process's own memory. That's correct for one instance and silently wrong the moment there's more than
one: each instance enforces its own limit independently, so N instances behind a load balancer let an
attacker through at N× the intended rate.

**Fix:** move the counters to a shared store (Redis) or push rate limiting to the edge (a CDN/WAF layer)
before running more than one API instance.

**Why not now:** identical reasoning to #3 — there is exactly one instance, so per-instance memory *is*
global state. This is one of the first things to fix the moment a second instance is added, not before.

### 6. Hot-pool contention

The concurrency design (ADR-006) locks one pool row at a time — contention is bounded by how many
passengers are racing for the *same* pool's last seat, which in this domain is naturally small (a Tesla
seats 3–6 people). This doesn't get worse as the *total* number of pools in the system grows; it only
gets worse if a single pool somehow attracts unusually heavy simultaneous demand (which the domain itself
prevents — a pool stops accepting joins the moment it's full).

**Why this one doesn't actually need a fix:** correctness scales with the *number* of pools, not the size
of any one pool's contention, and the number of pools scales with drivers, which scales with cities. The
practical way this stays healthy at scale is geographic partitioning (zone/city-scoped matching, #2
above) — it's the same fix, not a separate one.

## Supporting infrastructure a real production system would add

Reasoning only — none of these are needed at this project's actual scale, and building them now would be
solving problems that don't exist yet:

- **A durable idempotency store separate from the primary database**, if idempotency keys' write volume
  ever competes meaningfully with business-table writes for the same connections.
- **Outbox-pattern event publishing** for the business events this project already logs
  (`ride.requested`, `pool.seat_reserved`, etc., plan §14) — turning them into a real event stream once
  something downstream (the matching service in #2, analytics, notifications) needs to consume them
  reliably rather than by tailing logs.
- **A real observability stack** (structured log aggregation, metrics, tracing) once there's enough
  request volume that reading logs by hand (this project's actual debugging story — see the interview
  defense sheet) stops being practical.
- **Multi-AZ Postgres with point-in-time recovery**, once a single-region database's downtime window
  becomes an acceptable-loss question rather than a "the interview evaluator waits 30 seconds" question.
- **Blue-green deploys**, once a deploy that briefly drops requests is not acceptable — the current
  design's graceful shutdown (drain in-flight, then exit) already avoids *corrupting* an in-flight
  request during a deploy, which is the correctness-critical half of this problem; the availability half
  (zero dropped requests during a deploy) is the part blue-green would add.
