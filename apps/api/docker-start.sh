#!/bin/sh
# Render's dockerCommand override doesn't reliably parse a `&&`-chained,
# quoted string (see render.yaml's git history) — a single unambiguous
# script path sidesteps that entirely. `set -e` gives the same
# fail-fast semantics `&&` would; `exec` on the last step replaces this
# shell with the server process so it stays PID 1 and gets signals
# directly (graceful shutdown, plan §14).
set -e
node apps/api/dist/db/migrate.js
node apps/api/dist/db/seed/index.js
exec node apps/api/dist/server.js
