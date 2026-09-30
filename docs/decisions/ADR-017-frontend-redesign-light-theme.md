# ADR-017 — Frontend redesign: light "Dhaka Daylight" theme, not the dark cockpit theme

- **Status:** Accepted
- **Date:** 2026-09-27
- **Branch:** feature/frontend-redesign-v2

## Context

PR #15 (`feature/frontend-redesign`, merged into `master`) shipped a dark "Electric Night / EV-cockpit"
theme, but only for the app shell and 5 of 10 shared components — every page body still rendered generic,
unstyled default-Tailwind markup on top of it. Asked for a complete, research-grounded UI/UX redesign
(not an incremental fix to the dark theme), a competitive review of Uber, Pathao, Lyft and Grab found all
four are light-primary with one confident accent color, not dark-with-glow. The PRD's own opening scene
(§1, "8:41 AM, Banani Road 11") is daytime rush-hour street life, which a dark cockpit theme does not match
independently of any subjective "looks generic" judgment.

## Decision

Replace the dark palette with a light one ("Dhaka Daylight": warm off-white background, near-black text,
amber/marigold primary accent, teal secondary accent reserved for pooling-only indicators — full token
table in the redesign plan). Token *names* in `apps/web/src/index.css` are kept stable across the swap
(only values changed, plus one new `--color-on-accent` token — see "Trade-offs") so no consuming component
needed a rewrite for this alone.

## Alternatives considered

- **Finish the dark theme as originally started** — lower short-term effort (the tokens and 5 components
  already existed), but a dark-background-with-glowing-accent theme is close to the single most common
  "generic AI-generated dashboard" trope this redesign was explicitly asked to avoid, and doesn't match any
  of the four researched reference platforms or the PRD's own daytime setting.
- **Hybrid: light product, dark driver "cockpit" screen** — a real justification exists (night-driving
  glare reduction), but it means maintaining two visual themes end-to-end for a solo-built MVP scored partly
  on process discipline; rejected in favor of one coherent theme, with the driver screens differentiated by
  layout/density instead of color.

## Why this fits Dhaka Tesla Pool

The story is Jashim leaning against Bullet in daylight traffic, not a night-time control room — the product
is a battery rickshaw with a hand-painted "TESLA" badge, and the visual language should read as warm and
local rather than a generic tech-product dark mode.

## Trade-offs and consequences

`Button`'s primary variant previously set its text color to `text-bg` (the page background token), which
only produced readable text by coincidence — `--color-bg` happened to be near-black under the dark theme.
That coupling silently breaks the moment `--color-bg` is light, so a dedicated `--color-on-accent` token was
added rather than reusing an unrelated token a second time. Found and fixed in the same pass: `StatusStepper`
had the identical `text-bg` coupling, and several `text-*`/`bg-*`/`border-*` values inherited from the dark
theme (`text-faint`, `success`, `warning`, `danger`, `electric`) fell under WCAG AA contrast on the new light
background and were recalibrated (verified by computing contrast ratios directly — see the redesign plan).

## Revisit when

A genuine product reason for a second theme appears (e.g. a driver-reported glare problem, not just
aesthetic preference) — at that point, revisit the rejected hybrid-theme alternative above rather than
inventing a new one.

## Update — 2026-09-27 (round 3): System/Light/Dark preference added

A follow-up UI/UX pass added a **System / Light / Dark** toggle (`app/theme.tsx`, `ThemeToggle`), stored in
`localStorage` and applied before first paint. This is not the hybrid alternative rejected above: that
alternative would have *locked* driver screens to a dark palette regardless of preference, coupling theme to
role. What shipped instead is a single, ordinary user-controlled preference — available to passengers,
drivers and admins alike — sitting on top of the same light "Dhaka Daylight" system as its default and
primary identity (a fresh session with no stored preference still renders light-first when the OS itself
prefers light, exactly as this ADR decided). Every reference platform from the original research (Uber,
Lyft) ships the same shape: a light-primary brand with an optional system-following dark mode, not a
dark-primary identity.

Practically, this was driven by the same composition pass that fixed the app's empty-space problems, not by
a driver glare report — so the specific trigger in "Revisit when" above is still technically unmet. It's
recorded here anyway because the *outcome* (a dark palette existing in the product) is what that section
anticipated, and a future reader diffing this ADR against the running app should not conclude the token
values silently drifted out of sync with the decision. All dark-mode token pairs were verified against the
same WCAG AA thresholds as the original light palette (contrast ratios computed directly, not eyeballed).
