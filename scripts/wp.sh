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
  local node=() workers=() ui=() uidom=()
  for f in "$@"; do
    case "$f" in
      test/integration/*|test/do/*|tests/admin/*) workers+=("$f") ;;
      ui/src/*.dom.test.ts) uidom+=("${f#ui/}") ;;
      ui/src/*) ui+=("${f#ui/}") ;;
      *) node+=("$f") ;;
    esac
  done
  local status=0
  if ((${#node[@]})); then npx vitest run "${node[@]}" || status=$?; fi
  if [[ $status -ne 0 ]]; then return $status; fi
  if ((${#workers[@]})); then npx vitest run -c vitest.workers.config.ts "${workers[@]}" || status=$?; fi
  if [[ $status -ne 0 ]]; then return $status; fi
  if ((${#ui[@]})); then npx vitest run --root ui "${ui[@]}" || status=$?; fi
  if [[ $status -ne 0 ]]; then return $status; fi
  if ((${#uidom[@]})); then npx vitest run --root ui -c vitest.dom.config.ts "${uidom[@]}" || status=$?; fi
  return $status
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
  check_rule 'void\s+_?(err|e|error)\s*;'     'src/' 'swallowed error: log it or rethrow'
  check_rule '\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(\{\s*\}|undefined|null)\s*\)' 'src/' 'swallowed promise rejection'
  check_rule '@ts-(ignore|expect-error)'      'src/' 'type suppression'
  check_rule '@ts-(ignore|expect-error)'      'test*' 'type suppression'
  check_rule '@ts-(ignore|expect-error)'      'ui/src/' 'type suppression'
  check_rule '\b(it|test|describe)\.(skip|todo)\(|\bx(it|describe)\(' '.' 'skipped test'
  return $fail
}

selftest() {
  local fail=0
  assert_rule() { # pattern must_match must_not_match
    local pat="$1" yes="$2" no="$3"
    if ! printf '%s\n' "$yes" | grep -Eq -- "$pat"; then
      echo "SELFTEST FAIL (expected match): $pat on: $yes"
      fail=1
    fi
    if printf '%s\n' "$no" | grep -Eq -- "$pat"; then
      echo "SELFTEST FAIL (unexpected match): $pat on: $no"
      fail=1
    fi
  }
  local kw_only="only" kw_skip="skip" kw_ts="ignore"
  assert_rule 'catch\s*(\([^)]*\))?\s*\{\s*\}' \
    'try { foo(); } catch (err) {}' \
    'try { foo(); } catch (err) { logger.error("fail", err); }'
  assert_rule '\bas any\b|:\s*any\b' \
    'const x: any = 1;' \
    'const x: unknown = 1;'
  assert_rule '\b(it|test|describe)\.only\(' \
    "it.${kw_only}('focused', () => {})" \
    "it('normal', () => {})"
  assert_rule 'prepare\s*:\s*\(' \
    'const db = { prepare: () => {} };' \
    'await env.DB.prepare("SELECT 1").first();'
  assert_rule 'x-tenant-id' \
    'headers: { "x-tenant-id": "t1" }' \
    'headers: { "content-type": "application/json" }'
  assert_rule 'void\s+_?(err|e|error)\s*;' \
    'catch (err) { void err; }' \
    'catch (err) { logger.error("failed", err); }'
  assert_rule '\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(\{\s*\}|undefined|null)\s*\)' \
    'promise.catch((err) => {})' \
    'promise.catch((err) => logger.error("failed", err))'
  assert_rule '@ts-(ignore|expect-error)' \
    "// @ts-${kw_ts} missing prop" \
    '// normal comment'
  assert_rule '\b(it|test|describe)\.(skip|todo)\(|\bx(it|describe)\(' \
    "it.${kw_skip}('later', () => {})" \
    "it('runs now', () => {})"
  if [[ $fail -ne 0 ]]; then exit 1; fi
  echo "selftest ok"
}

verify_tasks() {
  local wp="$1" branch="wp/$1"
  local section
  section=$(awk -v wp="### $wp" '
    $0 == wp || index($0, wp " ") == 1 { in_sec=1; next }
    in_sec && /^##/ { exit }
    in_sec { print }
  ' docs/PROGRESS.md)
  if [[ -z "$section" ]]; then
    echo "FINISH FAILED: section ### $wp not found in docs/PROGRESS.md" >&2
    return 1
  fi
  local unticked
  unticked=$(printf '%s\n' "$section" | grep -E '^\s*-\s*\[\s\]\s*T-[0-9A-Z]+\.[0-9]+\.[0-9]+' || true)
  if [[ -n "$unticked" ]]; then
    echo "FINISH FAILED: unticked task(s) in $wp:" >&2
    echo "$unticked" >&2
    return 1
  fi
  local tasks
  tasks=$(printf '%s\n' "$section" | grep -oE 'T-[0-9A-Z]+\.[0-9]+\.[0-9]+' | sort -u || true)
  if [[ -z "$tasks" ]]; then
    echo "FINISH FAILED: no tasks matching T-[0-9A-Z]+.[0-9]+.[0-9]+ under ### $wp" >&2
    return 1
  fi
  local subjects
  subjects=$(git log "$BASE..$branch" --format=%s)
  while IFS= read -r subj; do
    [[ -z "$subj" ]] && continue
    local count
    count=$(printf '%s\n' "$subj" | grep -oE 'T-[0-9A-Z]+\.[0-9]+\.[0-9]+' | sort -u | wc -l)
    if (( count > 1 )); then
      echo "FINISH FAILED: commit subject names more than one task id: $subj" >&2
      return 1
    fi
    if printf '%s\n' "$subj" | grep -Eq '^(feat|fix)(\([^)]*\))?!?:'; then
      local ctid
      ctid=$(printf '%s\n' "$subj" | grep -oE 'T-[0-9A-Z]+\.[0-9]+\.[0-9]+' | head -1 || true)
      if [[ -n "$ctid" ]]; then
        if [[ ! -f .wp/red.log ]] || ! grep -Eq "^${ctid//./\\.} " .wp/red.log; then
          echo "FINISH FAILED: missing .wp/red.log entry for feat/fix task $ctid" >&2
          return 1
        fi
      fi
    fi
  done <<< "$subjects"
  while IFS= read -r tid; do
    [[ -z "$tid" ]] && continue
    if ! printf '%s\n' "$subjects" | grep -Eq "(^|[^0-9A-Za-z.])${tid//./\\.}([^0-9]|$)"; then
      echo "FINISH FAILED: task $tid not found in any commit subject on $branch" >&2
      return 1
    fi
  done <<< "$tasks"
  echo "tasks ok"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  start)
    git switch "$BASE"
    git switch -c "wp/$1"
    ;;
  red)
    tid=""
    if [[ "${1:-}" =~ ^T-[0-9A-Z]+\.[0-9]+\.[0-9]+$ ]]; then
      tid="$1"; shift
    fi
    if run_tests "$@"; then echo "RED CHECK FAILED: the new tests already pass"; exit 1; fi
    if [[ -n "$tid" ]]; then
      mkdir -p .wp
      echo "$tid $(git rev-parse HEAD) $*" >> .wp/red.log
    fi
    echo "red check ok: tests fail before the fix"
    ;;
  check)
    forbid
    npm run -s typecheck
    if (($#)); then run_tests "$@"; fi
    echo "check ok"
    ;;
  selftest)
    selftest
    ;;
  verify-tasks)
    verify_tasks "$1"
    ;;
  finish)
    branch="wp/$1"
    [[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "working tree not clean"; exit 1; }
    git switch "$branch"
    verify_tasks "$1"
    forbid
    npm run -s gate
    git switch "$BASE"
    git merge --no-ff "$branch" -m "Merge $1"
    git branch -d "$branch"
    ;;
  *)
    sed -n '2,9p' "$0"; exit 1 ;;
esac
