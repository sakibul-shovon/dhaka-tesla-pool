# ADR-018 — Frontend map: real basemap + frontend-only zone coordinates, never routing

- **Status:** Accepted
- **Date:** 2026-09-27
- **Branch:** feature/frontend-redesign-v2

## Context

The frontend redesign wanted "realistic map/location UI." ADR-008 already settled the *backend's* geography
model — a fixed 10-zone grid (`xDkm`/`yDkm`) for Manhattan-distance matching, deliberately not real
coordinates, per PRD §4 ("don't fight map APIs") and the plan's own "Won't ship" list (real maps/routing/GPS,
§1). There is no lat/lng anywhere in the database and no live driver position — only a *declared* zone
(A16). Any frontend map has to be visually honest about that, not imply a capability the system doesn't have.

## Decision

- **`@vis.gl/react-maplibre` + a free, keyless vector-tile style** (OpenFreeMap) for an actual basemap on the
  booking, ride-tracking, and driver go-online/pool screens — no API key, no account, no quota or billing
  risk, consistent with the PRD's free-tier-only rule.
- A **frontend-only** lookup, `zoneCoords.ts` (`ZONE_DISPLAY_COORDS: Record<ZoneCode, [lat, lng]>`), maps
  each of the 10 fixed zone codes to a real-world approximate Dhaka coordinate for pin placement only. This
  table is never sent to or read from the API; the zone *code* remains the only identifier the backend ever
  sees. It is presentation data, exactly as approximate as the backend's own grid, not a claim of survey
  accuracy.
- Pickup/drop-off render as pins with a **straight dashed line** between them when both are known — explicitly
  not a routed path — and a driver's zone renders as a pin **snapped to that zone's centroid**, updated only
  on the next poll tick, never animated as a smoothly-moving vehicle.
- The zone `<select>` is never removed. `ZonePicker` always keeps it as the real, accessible form control,
  with the map as a supplementary, `aria-hidden` preview — both because map interaction isn't reliably
  keyboard/screen-reader operable, and because it degrades gracefully if tiles fail to load.
- The map bundle (MapLibre GL is not small) is lazy-loaded (`React.lazy`) everywhere it's used, so `/login`
  and the marketing landing page never pay for it.
- Separately, the landing page's "how pooling works" section uses a *different*, purely illustrative
  component (`ZoneDiagram`, plain SVG built from the same `xDkm`/`yDkm` the API already returns) rather than
  the real basemap — deliberately not a real map, so it can't be mistaken for one.

## Alternatives considered

- **Stylized zone diagram only, no real basemap anywhere** — the most literally honest option (nothing could
  ever be mistaken for real GPS), but delivers little of the "realistic map/location UI" the redesign was
  asked for, and real basemap tiles carry no cost/quota risk once OpenFreeMap-style free providers are used,
  so the honesty concern doesn't actually require giving up the real map.
- **No map at all, keep plain zone dropdowns** — zero risk, zero product improvement; rejected as
  under-delivering on an explicit ask that turned out to have a safe implementation path.

## Why this fits Dhaka Tesla Pool

The PRD's own §4 explicitly permits "a lightweight free map" as one of three valid geography options — this
is that option, scoped to stay a visual/spatial aid on top of the existing zone model rather than a second,
competing geography system. It also directly defends against the exact question the plan's own §24
"Interview defense sheet" primes evaluators to ask ("is this real GPS tracking?") — the honest answer stays
"no," and the UI never implies otherwise.

## Trade-offs and consequences

The map cannot show real turn-by-turn distance/ETA — only the same zone-to-zone relationship the backend
already computes. `maplibre-gl` is a genuinely large dependency (~1 MB), which is why it is never in the
eager bundle for any route; `RidePage`'s first attempt at this imported `ZoneMap` directly and was caught by
Vite's own `INEFFECTIVE_DYNAMIC_IMPORT` build warning, fixed by lazy-loading it the same way `ZonePicker`
already did.

## Revisit when

The backend ever gains real geocoding/GPS (a scope change well beyond this MVP, per the plan's own
"Won't ship" list) — at that point the frontend-only coordinate table becomes redundant and should be
replaced by server-provided coordinates, and the dashed "indicative" line can become a real route.
