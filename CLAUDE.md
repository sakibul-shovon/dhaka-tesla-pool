# CLAUDE.md — Dhaka Tesla Pool

Ride-pooling MVP for an engineering assessment. The grader scores **process** (Git history, tests, docs,
ability to explain) as heavily as the running product. Optimise for correctness and reviewability, not
feature count.

## Sources of truth (in priority order)

1. `docs/PRD.md` — the assessment brief. Never contradict it.
2. `docs/IMPLEMENTATION_PLAN.md` — the agreed design. Section numbers below refer to it.
3. `docs/decisions/ADR-*.md` — decisions as they get recorded.

Do not read the whole plan every session. Read the sections listed for the current phase (plan §20)
plus any section you are about to implement.

## How we work — non-negotiable

- **One branch per session.** Commit only on the branch named in the session prompt. Feature branches
  are created from an up-to-date `master`; names and commit sequence: plan §19.2.
- **Stop at the end of the session.** Never merge, never push, never tag, never create `pre-release` or
  `release/*` — the developer reviews and does all of that. Never force-push or rewrite pushed history.
- **Commits:** `<type>(<scope>): <description>` — types exactly `feat fix refactor test docs chore build`
  (CI changes are `build(ci)`), lowercase-kebab scope, lowercase verb first, ≥ 3 words, header ≤ 72 chars.
  One logical change per commit, ≤ ~400 changed lines excluding lockfiles/migrations/Markdown. Before
  every commit run `npm run verify` (once it exists) plus the relevant integration tests; never commit
  with a failing test, never skip or weaken a test to make it pass.
- **Git guardrails are enforced** (`docs/GIT_WORKFLOW.md`): local hooks check every commit; a Claude Code
  hook blocks push/merge/rebase/tag/config, `--no-verify` and edits to policy files. If something is
  blocked, do not look for another way to do it — note it in the end-of-session report.
- **Plan disagreements:** if implementation shows the plan is wrong or incomplete, stop and explain the
  problem and the proposed change. After approval, update the plan section (and ADR) in the same commit
  as the code change.
- **No silent scope growth.** Nothing outside the current phase. P2 items (plan §1) only when asked.
- **Explainability:** no clever code the developer can't explain in an interview. Prefer boring, explicit
  code; comment *why*, never *what*.

## Engineering invariants (break any of these = stop and ask)

- Money is integer paisa everywhere (branded `Paisa` type). No floats, no `toFixed` in business logic.
- Status columns change **only** through `applyRideTransition` / `applyPoolTransition` inside a transaction,
  on rows obtained from the lock helpers (plan §10.7).
- Lock order: idempotency key → vehicle → pool → ride requests by ascending id (plan §10.2).
- No network I/O inside a transaction; log business events after commit.
- Routes/controllers: parse → validate (Zod `.strict()`) → authorise → call use case → map result.
  No business rules or SQL in routes. Domain code (`src/domain`) is pure: no DB, HTTP, env or clock.
- Every query on user-owned data is scoped by the caller; non-owners get 404.
- Error responses use the shared error catalog (plan §12.3); never leak stacks, SQL or internals.
- API responses: `Cache-Control: no-store`; no ETags on `/api`.
- Secrets only from env; never commit `.env`. Update `.env.example` when adding a variable.
- Seed, fixtures, tests and docs use the story cast: Jashim, Bullet (capacity 3), Nusrat, Rafiq, Shirin.
  The only extra character allowed is test-only driver Monir with Tesla "Toofan" (plan §0.1). Never `user1`.
- Concurrency tests run against real Postgres — never mocks or in-memory databases.

## Environment notes

- Developer machine is Windows with Docker Desktop. Keep LF line endings (`.gitattributes`), no CRLF in
  shell scripts or Dockerfiles, avoid bind mounts in the production compose file.
- Node 24 LTS, PostgreSQL 17, npm workspaces (`apps/api`, `apps/web`, `packages/shared`).

## Commands

Filled in during Phase 1 (`feature/project-foundation`) and kept accurate afterwards:
`npm run lint` · `npm run typecheck` · `npm test` · `npm run test:integration` · `npm run db:migrate` ·
`npm run db:seed` · `npm run db:reset` · `docker compose up --build`

## End-of-session report (always)

1. Branch and list of commits made (hash + message).
2. Tests run and results (paste the summary line).
3. Deviations from the plan, if any, and why.
4. Open questions / decisions needed from the developer.
5. **Files the developer must read before merging**, with one line each on what to understand — the
   developer has to be able to explain every one of them live.
6. Candidate entries for `docs/AI_USAGE_LOG.md` (suggestions made, alternatives you rejected). The
   developer decides what goes in; do not write to that file yourself.
