#!/usr/bin/env bash
# Solo work-package flow (replaces the HIVE runner). One WP per branch, granular commits, --no-ff merge.
#
#   scripts/wp.sh start WP-3.1          branch wp/WP-3.1 from the base branch
#   scripts/wp.sh red   <test files>    the new tests must FAIL before the fix
#   scripts/wp.sh check [test files]    forbid rules + typecheck + the given tests (run before each commit)
#   scripts/wp.sh finish WP-3.1         full suites, then merge --no-ff into the base branch and delete the WP branch
#
# Tests under test/integration/ or test/do/ run in the Workers pool; everything else in the Node pool.
set -euo pipefail
BASE="${WP_BASE:-docs/intent-audit-and-remediation}"
cd "$(git rev-parse --show-toplevel)"

run_tests() {
  local node=() workers=()
  for f in "$@"; do
    case "$f" in test/integration/*|test/do/*) workers+=("$f") ;; *) node+=("$f") ;; esac
  done
  if ((${#node[@]})); then npx vitest run "${node[@]}"; fi
  if ((${#workers[@]})); then npx vitest run -c vitest.workers.config.ts "${workers[@]}"; fi
}

# Forbid rules apply to lines added since the base branch (committed + working tree).
forbid() {
  local fail=0
  check_rule() { # pattern pathspec message
    local hits
    hits=$(git diff -U0 "$BASE" -- "$2" | grep -E '^\+[^+]' | grep -E -- "$1" || true)
    if [[ -n "$hits" ]]; then echo "FORBID: $3"; echo "$hits" | head -5; fail=1; fi
  }
  check_rule 'catch\s*(\([^)]*\))?\s*\{\s*\}' 'src/' 'empty catch block'
  check_rule '\bas any\b|:\s*any\b'           'src/' '`any` in new code'
  check_rule '\b(it|test|describe)\.only\('   '.'    '.only left in a test'
  check_rule 'prepare\s*:\s*\('               'test*' 'hand-rolled D1 mock (use the Workers harness)'
  check_rule 'x-tenant-id'                    'ui/src/' 'client-chosen tenant header'
  return $fail
}

cmd="${1:-}"; shift || true
case "$cmd" in
  start)
    git switch "$BASE"
    git switch -c "wp/$1"
    ;;
  red)
    if run_tests "$@"; then echo "RED CHECK FAILED: the new tests already pass"; exit 1; fi
    echo "red check ok: tests fail before the fix"
    ;;
  check)
    forbid
    npm run -s typecheck
    if (($#)); then run_tests "$@"; fi
    echo "check ok"
    ;;
  finish)
    branch="wp/$1"
    [[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "working tree not clean"; exit 1; }
    git switch "$branch"
    forbid
    npm run -s gate
    git switch "$BASE"
    git merge --no-ff "$branch" -m "Merge $1"
    git branch -d "$branch"
    ;;
  *)
    sed -n '2,9p' "$0"; exit 1 ;;
esac
