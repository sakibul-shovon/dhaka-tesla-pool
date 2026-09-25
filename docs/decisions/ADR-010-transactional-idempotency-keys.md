# ADR-010 — Idempotency keys claimed inside the business transaction

- **Status:** Accepted
- **Date:** 2026-09-26
- **Branch:** feature/ride-requests

## Context

PRD §14's concurrency scenario is about the last seat, but the same double-submit problem shows up one
step earlier: Nusrat's client times out waiting for `POST /ride-requests`, she taps "Request" again, and
the first attempt may or may not have actually committed. The server needs to answer "have I already done
this?" without a window where two concurrent retries can both believe they're first, and without a stuck
"in-progress" state if the server dies mid-request.

## Decision

`Idempotency-Key` is required on `POST /ride-requests` and `POST /ride-requests/:id/cancel` (plan §11).
The key is claimed with `INSERT INTO idempotency_keys (...) ON CONFLICT (user_id, key) DO NOTHING`, as the
*first* statement inside the same transaction that does the business work, and the row is updated with
the real response *last*, just before commit (`claimIdempotencyKey` / `finalizeIdempotencyKey`,
`lib/idempotency.ts`). Three outcomes fall out of that one INSERT with no extra state machine:

- **No conflict** — this request claimed the key; it proceeds, and its result finalizes the row before
  commit.
- **Conflict, and the other transaction already committed** — the row is now visible with a real stored
  response; this request replays it verbatim (`Idempotent-Replayed: true`) after checking the stored
  fingerprint matches.
- **Conflict, but the other transaction hasn't committed yet** — the INSERT physically blocks on the
  unique index until that transaction resolves, then falls into one of the two cases above. There is no
  third, `IN_PROGRESS` state to poll or get stuck behind.

The fingerprint is `sha256(METHOD ROUTE_TEMPLATE \n canonicalJSON(body))` (`fingerprintRequest`) —
canonical in the sense that object keys are sorted before hashing, so the same logical body always
fingerprints the same way regardless of client-side key order. A key reused for a different fingerprint is
`422 IDEMPOTENCY_KEY_REUSED`, not a silent overwrite.

## Alternatives considered

- **A separate `status: PENDING | DONE` column, set before the work and after it.** This is the textbook
  idempotency-key design, but it reintroduces exactly the stuck state the INSERT-as-lock avoids: if the
  process dies after marking `PENDING`, every retry sees `PENDING` forever (or needs a TTL/reaper to decide
  it's safe to retry, which is itself a race). Postgres's own MVCC visibility rules already do this
  correctly: an uncommitted row is invisible to everyone else, so there's nothing to poll.
- **Application-level locking (e.g. `SELECT ... FOR UPDATE` on a pre-created row, or an advisory lock).**
  Works, but needs the row to exist first (a separate INSERT anyway) or a lock key derived from
  `(user_id, key)` managed by hand — more moving parts than the unique constraint already provides for
  free.
- **Claim outside the transaction, before the business logic runs.** Then a business failure (e.g.
  `ACTIVE_RIDE_EXISTS`) would leave the key claimed with no valid response to replay, permanently blocking
  retries of that key even though nothing was actually created. Claiming inside means a rolled-back
  transaction rolls back the claim too — the key is only ever "spent" together with a real, committed
  result (plan §11: "First attempt failed with a business error → key not stored").

## Why this fits Dhaka Tesla Pool

Nusrat's double-submit on Request is the PRD's own edge-case matrix entry (§17: "Double-click Request").
`ride-requests.int.test.ts` proves both directions: an identical retry returns the same ride id with
`Idempotent-Replayed: true` and creates exactly one row, while a reused key with a different body is
rejected with `422` before anything is written. The natural-key constraint
(`ride_requests_active_per_passenger`) is a second, independent backstop per §11's "defence in depth" — if
a client ever loses its key, it still can't end up with two active rides; the error carries the existing
ride's id so the UI can navigate to it instead of erroring blindly.

## Trade-offs and consequences

Every idempotent endpoint pays one extra INSERT/SELECT/UPDATE against `idempotency_keys` per request, and
every use case has to be structured so its *entire* effect — reads, writes, and the finalize — happens
inside one transaction with no I/O in between. Retention (24 h, plan §11) needs a sweep job, not built in
this session; until then rows simply accumulate, harmless but not free.

## Revisit when

A use case needs to call out to a non-transactional side effect (a real payment gateway, an SMS) as part
of its "done" state — then the finalize step can't simply live inside the same DB transaction, and the
design needs an outbox or a second, explicit `SETTLED` marker written after the external call succeeds.
