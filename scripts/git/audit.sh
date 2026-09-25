#!/usr/bin/env bash
# Pre-submission audit of the repository against PRD §10–§11 and §14. Read-only.
# Usage: git fetch --all --tags && scripts/git/audit.sh [release-branch]
set -uo pipefail
source "$(dirname "$0")/policy.sh"
release="${1:-release/v1.0.0}"; tag="v${release#release/v}"
fails=0; warns=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
warn() { printf '  \033[33mWARN\033[0m %s\n' "$*"; warns=$((warns + 1)); }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; fails=$((fails + 1)); }
has_ref() { git rev-parse --verify -q "$1" >/dev/null; }

echo "Branches"
for b in master pre-release "$release"; do
  has_ref "origin/$b" && pass "origin/$b exists" || fail "origin/$b is missing"
done
features=$(git for-each-ref --format='%(refname:short)' 'refs/remotes/origin/feature/*')
count=$(grep -c . <<<"$features" || true)
(( count >= 5 )) && pass "$count feature branches published" || warn "only $count feature branches published"
master_line=$(git rev-list --first-parent origin/master 2>/dev/null)
for f in $features; do
  # fork point = newest commit on master's first-parent line that the branch contains
  fork=""
  for c in $master_line; do
    if git merge-base --is-ancestor "$c" "$f"; then fork="$c"; break; fi
  done
  n=$(git rev-list --count --no-merges "${fork:+$fork..}$f")
  git merge-base --is-ancestor "$f" origin/master 2>/dev/null || warn "$f is not merged into master"
  (( n == 1 )) && warn "$f has a single commit — is that really incremental?"
  (( n > 25 )) && warn "$f has $n commits — possible micro-commit noise"
done

echo "Release"
if has_ref "refs/tags/$tag"; then
  git merge-base --is-ancestor "$tag" "origin/$release" 2>/dev/null \
    && pass "tag $tag is on $release" || fail "tag $tag is not on $release"
else
  warn "tag $tag not found"
fi
if has_ref "origin/$release" && has_ref origin/pre-release; then
  extra=$(git rev-list --no-merges "origin/pre-release..origin/$release" | wc -l)
  (( extra == 0 )) && pass "$release was cut from pre-release (no commits of its own)" \
                    || warn "$release has $extra commit(s) not on pre-release"
fi

echo "Master history"
direct=$(git rev-list --first-parent --no-merges origin/master | wc -l)
roots=$(git rev-list --max-parents=0 origin/master | wc -l)
(( direct <= roots )) && pass "master changed only through merge commits" \
                      || fail "master has $((direct - roots)) direct (non-merge) commit(s) besides the root"

echo "Commit messages (all branches)"
bad=0
while IFS=$'\t' read -r sha header; do
  [[ -z "$sha" ]] && continue
  reason=$(validate_commit_message "$header") || { fail "${sha:0:9} $header → $reason"; bad=1; }
done < <(git log --all --no-merges --format='%H%x09%s')
(( bad == 0 )) && pass "every non-merge commit follows <type>(<scope>): <description>"

echo "Hygiene"
leaked=$(git log --all --name-only --format= | sort -u | grep -E "$FORBIDDEN_FILES_PATTERN" || true)
[[ -z "$leaked" ]] && pass "no forbidden files anywhere in history" || fail "forbidden files in history: $leaked"
authors=$(git log --all --format='%an <%ae>' | sort -u)
(( $(grep -c . <<<"$authors") == 1 )) && pass "single author identity: $authors" \
  || warn "multiple author identities (check the GitHub account you submit from):"$'\n'"$authors"
total=$(git rev-list --count --all --no-merges)
pass "$total non-merge commits in total"
echo "  Largest commits (excluding lockfiles/migrations/Markdown):"
git log --all --no-merges --format='@@%h %s' --numstat -- . ':(exclude)*package-lock.json' \
  ':(exclude)*migrations/*' ':(exclude)*.md' \
  | awk '/^@@/ { if (h) print s"\t"h; h=substr($0,3); s=0; next } $1 ~ /^[0-9]+$/ { s += $1 + $2 } END { if (h) print s"\t"h }' \
  | sort -rn | head -5 | sed 's/^/    /'

echo
(( fails == 0 )) && echo "Audit: $warns warning(s), no failures" || { echo "Audit: $fails failure(s), $warns warning(s)"; exit 1; }
