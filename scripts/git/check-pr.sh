#!/usr/bin/env bash
# Usage: scripts/git/check-pr.sh <head-branch> <base-branch> <base-sha> <head-sha>
# Enforces which branch may merge into which, then the commit, file and secret rules for the PR range.
set -euo pipefail
source "$(dirname "$0")/policy.sh"
head_branch="$1"; base_branch="$2"; base_sha="$3"; head_sha="$4"

if ! [[ "$head_branch" =~ $BRANCH_PATTERN ]]; then
  red "✖ head branch '$head_branch' does not follow the branch model"; exit 1
fi
case "$base_branch:$head_branch" in
  master:feature/*|master:fix/*|master:pre-release|pre-release:fix/*) ;;
  *) red "✖ '$head_branch' → '$base_branch' is not an allowed merge"
     note "  allowed: feature/* → master · fix/* → master or pre-release · pre-release → master"
     note "  release/vX.Y.Z is cut from pre-release, never merged into."
     exit 1 ;;
esac

"$(dirname "$0")/lint-commits.sh" "$base_sha..$head_sha"

changed=$(git diff --name-only --diff-filter=ACMR "$base_sha" "$head_sha")
if bad=$(grep -E "$FORBIDDEN_FILES_PATTERN" <<<"$changed"); then
  red "✖ forbidden file(s) in this pull request:"; note "$bad"; exit 1
fi
added=$(git diff -U0 --diff-filter=ACMR "$base_sha" "$head_sha" -- . \
  ':(exclude)*.env.example' ':(exclude)scripts/git/*' ':(exclude).githooks/*' \
  | grep '^+' | grep -v '^+++' || true)
if hits=$(grep -E -- "$SECRET_PATTERN" <<<"$added" | grep -vE -- "$LOCAL_DB_URL_PATTERN"); then
  red "✖ possible secret in this pull request:"; note "$(cut -c1-120 <<<"$hits")"; exit 1
fi
echo "✔ branch, commit, file and secret rules pass for $head_branch → $base_branch"
