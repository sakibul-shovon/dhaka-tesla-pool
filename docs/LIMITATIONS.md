# Known Limitations

Scope cuts made deliberately, not bugs. Each one traces back to a PRD priority tier (P0/P1/P2) or an
assumption in [`docs/ASSUMPTIONS.md`](ASSUMPTIONS.md).

## Not implemented

- **No automatic expiry of stale `REQUESTED` rides (A17, P2).** A request that never gets accepted or
  joined stays `REQUESTED` indefinitely until the passenger cancels it themselves. Fixing this needs
  either a lazy expiry check on read or a scheduled sweep — neither exists.
- **No Playwright end-to-end test.** The plan's P1 tier called for "one Playwright E2E happy path"
  against a running `docker compose up` stack. Every layer below that (unit, integration, concurrency)
  is covered; a real-browser walk through the passenger+driver flow is not.
- **No driver onboarding.** Drivers are provisioned by the seed script only (A3) — there is no
  self-service driver registration, KYC, or vehicle-registration flow. This was a deliberate scope cut
  to avoid an entire review/approval workflow that the PRD doesn't ask for.
- **Admin panel is deliberately narrow.** It lets an operator inspect the system (overview stats, a user
  directory, a ride browser with status history) and suspend/reactivate an account, but nothing lets an
  admin adjust a vehicle's capacity, force-cancel a ride or pool to unblock a suspension, or refund a
  TeslaPay debit — see [ADR-019](decisions/ADR-019-admin-panel-scope.md) for why each of those was
  refused rather than built.
- **Rate limiting only covers `/auth/register` and `/auth/login`.** Every other mutation is still
  protected by authentication, ownership checks, idempotency and the 16 kB body limit, but has no
  per-route request-rate ceiling of its own.
- **No refund path for TeslaPay.** Once `dropOff` debits a wallet, there is no reversal — no dispute
  flow, no admin credit, no cancellation-after-charge scenario (which can't currently happen anyway,
  since a passenger can't cancel after `STARTED` and the debit only fires at drop-off).

## Deliberate design boundaries (not gaps — see ASSUMPTIONS.md for the reasoning)

- One vehicle per driver, one active pool per vehicle (A2).
- No GPS — a driver manually declares their current zone (A16).
- Polling, not WebSockets or Server-Sent Events (A21) — see
  [`docs/SCALABILITY.md`](SCALABILITY.md) for what would replace it at scale.
- Fixed per-seat, per-distance fare formula — no surge pricing, no negotiation, no promo codes.
- `EMAIL_TAKEN` is disclosed on registration, trading a small enumeration risk for a usable error
  message (A24), mitigated by registration rate limiting.
- CSRF relies on `SameSite=Lax` cookies plus an `Origin` allow-list on state-changing requests rather
  than a dedicated CSRF token; the fallback (a real token, or `SameSite=None; Secure` with stricter CORS)
  is documented as the first thing to change if the hosted deployment's cookie ever fails to survive a
  proxy (see the deployment checklist).

## Docker Compose verification

`docker compose up --build` was first written without being runnable in the development sandbox (its
network blocked Docker Hub), so it was reviewed by hand and checked piece by piece. It has since been run
end to end on a Windows 11 machine with Docker Desktop: every service healthy, `migrate` exiting 0 after
seeding the demo cast, and a demo login working through the `web` container's `/api` proxy.
