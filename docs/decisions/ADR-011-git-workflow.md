# ADR-011 — Enforced git workflow (branches, commits, merges)

- **Status:** Accepted
- **Date:** 2026-09-25
- **Branch:** feature/project-foundation

## Context

PRD §10–§11 grades the git history itself: long-lived `master` / `pre-release` / `release/<version>`,
`feature/*` branches per logical change, conventional commit messages, and a real incremental history
rather than "an empty repo straight to a finished app" (PRD §18).

## Decision

Five enforcement layers, cheapest/fastest first, so a mistake is caught in seconds rather than at
submission time: Claude Code guardrails (`.claude/`) → local git hooks (`.githooks/`,
`scripts/git/policy.sh`) → CI `git-policy` workflow → GitHub rulesets on `master` / `pre-release` /
`release/**` / `v*` tags → `scripts/git/audit.sh` before submission. Merges into `master` are pull
requests merged with a merge commit (no squash, no rebase), so each feature branch's commits stay visible
in `git log`. Full rules: `docs/GIT_WORKFLOW.md`.

## Alternatives considered

- **Squash merging** — gives a tidy one-commit-per-feature `master`, but collapses exactly the
  incremental history the PRD says it inspects; the individual commits (schema, then constraint, then
  test) would be lost.
- **Trust + code review only, no automated hooks** — relies on remembering the rules every commit across
  ~13 branches; the PRD's own examples of what to avoid (`update`, `final`, micro-commits, one giant
  initial commit) are exactly the failure modes automation catches cheaply.

## Why this fits Dhaka Tesla Pool

The evaluator explicitly reads `git log`, not just the final diff. A branch per feature
(`feature/tesla-pooling`, `feature/concurrency-safety`, ...) with real incremental commits demonstrates
the actual engineering sequence: schema → domain logic → API → tests → docs, matching how the
`IMPLEMENTATION_PLAN.md` phases were designed.

## Trade-offs and consequences

More ceremony per commit (format, size limit, branch naming) than an unconstrained repo. `--no-verify`
bypasses the local hooks but not CI or the GitHub ruleset, so nothing is silently lost — a bypassed local
check just surfaces one step later, in the PR.

## Revisit when

Never, for this assessment — the rules exist to match PRD §10–§11 for the life of this submission.
