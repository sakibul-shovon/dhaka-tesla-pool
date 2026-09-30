# ADR-019 — Admin panel: read-mostly oversight plus account suspension

- **Status:** Accepted
- **Date:** 2026-09-27
- **Branch:** feature/admin-panel

## Context

The PRD names three actors (passenger, driver/Tesla, ride/pool) and no admin. The admin role exists as a
documented assumption — plan §13.2, the A3 reversal — and until now it could only create and list driver
accounts. Operating the demo raised the obvious next questions: who is using the system, what happened to a
given ride, and how do you stop an abusive account? The PRD's own §2 ("hold onto enough history to explain
exactly what happened, in case anyone asks later") is the requirement an admin view actually serves.

Most of what that needs already exists. `users.status` has been an `ACTIVE | SUSPENDED` enum since migration
`0000`, login rejects any non-`ACTIVE` user, and `resolveSession` re-reads the status on every request — so
suspension was enforced end to end with no way to trigger it. Ride and pool status history already records
every transition with its actor and reason.

## Decision

Extend the admin role with **read-only oversight** (overview counts, a user directory, a ride browser with
the existing status timelines, per-user wallet and history) and exactly **one write action: suspending or
reactivating a passenger or driver account**.

Suspension rules:
- Only `PASSENGER` and `DRIVER` accounts can be suspended; `ADMIN` targets get `403` (which also covers an
  admin suspending themselves).
- A two-state machine in `src/domain/account-status.ts`: `ACTIVE → SUSPENDED`, `SUSPENDED → ACTIVE`; anything
  else is `409 INVALID_TRANSITION`. The write is a compare-and-set (`UPDATE … WHERE status = <from>`), so two
  admins acting at once produce one transition and one `409`, never two history rows.
- Refused with `409 ACTIVE_RIDE_EXISTS` while a passenger has an active ride, and `409 DRIVER_HAS_ACTIVE_POOL`
  while a driver has an active pool — suspension never changes a ride or pool's state.
- Suspending a driver locks their vehicle (normal lock order, vehicle first), re-checks for an active pool
  under that lock, and takes the vehicle offline in the same transaction.
- Every change writes one row to a new append-only `account_status_history` table (same shape and same
  immutability trigger as the ride/pool history tables — invariant I13).

## Alternatives considered

- **Admin force-cancels the blocking ride or pool, then suspends** — a real operator need, but it adds an
  admin actor to the ride and pool state machines, their lock order and the C1–C16 concurrency tests: the most
  heavily graded code in the project, changed for an admin convenience. Refusing and saying why keeps those
  untouched.
- **Delete users** — every foreign key to `users` is `ON DELETE RESTRICT` precisely so ride history survives;
  deleting a rider would destroy the record PRD §2 asks us to keep. Suspension blocks the account and keeps it.
- **Live user location / GPS map** — PRD §4 ("don't spend the challenge fighting map APIs"), plan §1's Won't
  list and A16 (a driver declares a zone; nobody reports coordinates). The admin view shows what actually
  exists: online drivers, open requests and open pools *per zone*.
- **Editing fares, surge or promo codes** — PRD §5 requires the fare to be checkable by hand, and A7 snapshots
  a fare at request time and never charges above it. A runtime-editable price breaks both.
- **Manual wallet credits / refunds** — touches the ledger and its double-debit protection for a wallet the
  PRD only asks us to simulate. The admin view of wallets is read-only.
- **Live admin updates over WebSockets** — ADR-009; the overview polls like every other screen.
- **Idempotency keys on suspend** — a retry of a suspension that already happened is harmlessly rejected by
  the state machine (`409 INVALID_TRANSITION`) and the UI refetches, the same 409→refetch pattern as elsewhere.
  Same reasoning as `POST /admin/drivers`.

## Why this fits Dhaka Tesla Pool

If Rafiq starts abusing the app mid-week, an admin can find him, read exactly what his rides did, and suspend
him — his open session stops working on its very next request. If he is in Bullet right now, the admin is told
to wait until Jashim drops him off, instead of the panel cancelling a ride underneath a moving vehicle.

## Trade-offs and consequences

**Known, bounded race.** A passenger request that was already past authentication when the suspension commits
still completes — at most one ride, because of the one-active-ride unique index, and the passenger can't act on
it afterwards (every later request gets `401`). Closing it means taking a lock on the user's row inside the
ride-creation transaction, i.e. changing the hot booking path; not worth it for an MVP admin action. Drivers
don't have this gap: `accept` re-checks `is_online` under the same vehicle lock the suspension takes, so either
the accept wins (and the suspension is refused) or the suspension wins (and the accept sees an offline vehicle).
A driver's in-flight `go-online` can still flip `is_online` back after the suspension; every online-driver
count therefore also requires `users.status = 'ACTIVE'`.

Admins see passenger names on rides, where co-riders only see a count (A18). That is deliberate — support and
audit need identities — and is recorded in the authorization matrix.

## Revisit when

- Suspensions become routine enough that waiting for a ride to finish is a real operational cost — then add an
  admin actor to the ride/pool state machines, with its own concurrency tests.
- More than one kind of admin action needs an audit trail — then generalise `account_status_history` into an
  `admin_actions` log.
