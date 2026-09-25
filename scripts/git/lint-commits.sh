#!/usr/bin/env bash
# Usage: scripts/git/lint-commits.sh <revision-range>
# Validates every non-merge commit in the range — catches anything that skipped local hooks.
set -euo pipefail
source "$(dirname "$0")/policy.sh"
range="$1"; failures=0
while IFS=$'\t' read -r sha header; do
  [[ -z "$sha" ]] && continue
  if ! reason=$(validate_commit_message "$header"); then
    red "✖ ${sha:0:9} $header"; note "    → $reason"; failures=$((failures + 1))
  fi
done < <(git log --no-merges --format='%H%x09%s' "$range")
if (( failures > 0 )); then red "$failures commit message(s) violate the policy"; exit 1; fi
echo "✔ commit messages in $range follow the policy"
