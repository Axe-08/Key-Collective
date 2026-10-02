# Key Collective — Remediation Plan v3 (finish, prove, harden)

v3 does not replace v2. It amends the rest of Phase 7, adds three short phases (G, D, F), and amends v2's Phase 8. Every v2 rule (R-1 to R-8) and decision (D-01 to D-27) still applies unless changed below.

Execution protocol is unchanged: `scripts/wp.sh` loop, one commit per task, tick the box in `docs/PROGRESS.md` in the same commit, `--no-ff` merge. See `docs/PHASE4_PLAN.md` for the protocol and the testing pitfalls.

**STOP** marks a step only the owner can do. The executing agent stops, reports what is needed, and waits. It never marks a STOP step done itself.

## 0. Why v3

v2's safety came from releasing each phase, watching it, then removing the old path (R-3, R-4). That never happened.

- **Nothing after Phase 2 has been deployed.** About 225 commits exist only locally and on the remediation branch. `ci-dev.yml` deploys only on a push to `develop`, and no `develop` branch exists locally or on origin. The lease engine, sessions, CU accounting and the commons economy have never run outside tests.
- **Phase 7 removed the fallbacks anyway.** WP-7.5 removed the `ROUTING_ENGINE` switch and WP-7.6 removed lazy HKDF migration. Neither had its precondition met, so routing can no longer be rolled back without a code change.
- **The tests pass, but the process was bypassed in places** (audit below).

Production has no keys, users or traffic (as of 2026-09-30). So the waivers below are cheap now, and they will not be cheap after launch.

### Audit findings (2026-10-02, at `62f31ec`)

| Id | Finding | Fixed in |
|---|---|---|
| AU-01 | Phases 3–7 never deployed, and the dev deploy branch `develop` does not exist. | Phase D |
| AU-02 | 23 `catch (err) { void err; }` swallows get around the empty-catch rule. Some hide D1 writes: the coordinator vesting `UPDATE` and the TenantQuotaDO standing mirror. | WP-F.3, WP-8.1, T-G.1.1 |
| AU-03 | Would-deny stats live in an in-memory array per isolate (`src/pool/enforcement.ts`). `GET /api/admin/commons/would-deny` shows one isolate's recent memory. | WP-F.1 |
| AU-04 | A new tenant's first alarm (the 60 s standing-mirror alarm) runs `nightlyReset` mid-day, because `lastResetDay` is null. | WP-F.2 |
| AU-05 | Lazy HKDF migration was removed before it ever ran anywhere. `ops/migrate_keys_hkdf.ts` has no runner, and `ops/` is not typechecked. Dev keys saved by the old deploy have `hkdf_migrated = 0` (0009 default) and will be quarantined on first lease. | D.1, WP-F.4, T-G.1.4 |
| AU-06 | WP-7.5 and WP-7.6 merged without their human preconditions. | D-28 (retroactive waiver) |
| AU-07 | µ$ leftovers in live code. The Phase 7 gate grep is too narrow to catch them. | T-7.7.9, Phase 7 gate |
| AU-08 | WP-4.6, 6.1, 6.2 and 6.4 each landed as one commit for 3–10 tasks, so the per-task red check cannot be verified. | T-G.1.2, T-G.1.3, T-8.3.x |
| AU-09 | `@ts-expect-error` is used in tests to assert that a property is absent. | T-G.1.1, WP-8.3 |
| AU-10 | No operator steps recorded since Phase 3. Migrations 0023/0024 drop columns the deployed Worker reads, and migrations run before the Worker deploys. | WP-G.2, D.1, D.2 |
| AU-11 | `kc_pending` is signed with `KC_MASTER_KEY` (Phase 3 note), so the master key doubles as a credential (S10). | WP-8.5 |

## 1. Decisions

- **D-28 Waived preconditions (retroactive).** The time-based preconditions of WP-7.1 (D-22 sunset + 14 days), WP-7.5 (D-23, 7 days on leases) and WP-7.6 (HKDF count) are waived because production has no users, keys or traffic. Consequences:
  - Routing is fix-forward only.
  - After 0023/0024 run, a Worker version built before WP-7.3 crashes on the dropped columns. `wrangler rollback` may target only versions built at or after the Phase 7 merge.
  - Data rollback means restoring the D1 export.
- **D-29 Dev proving replaces observation.** Every remaining phase ends with a dev deploy and the Phase D smoke checklist before the next phase starts.
- **D-30 Agents do not certify human preconditions.** A **STOP** line means stop, report and wait.
- **D-31 Process rules are enforced by tooling, not prose.** Phase G turns the protocol into checks: one commit per task, a red log, swallow and suppression forbids, and count baselines.

## 2. Order

1. **Phase 7: finish** (agent, in flight). WP-7.2 and WP-7.7 with the amendments below.
2. **Phase G: guardrails** (agent, small). Starts after Phase 7 merges, because it edits `scripts/wp.sh`.
3. **Phase D: deploy and prove on dev** (owner). Blocks Phase F and Phase 8.
4. **Phase F: audit fixes** (agent).
5. **Phase 8: hardening and release** (v2, amended; agent), then Phase D again on the Phase 8 build.
6. **Production release** (owner): merge to `master`, which triggers `deploy-prod.yml` (export, migrate, deploy).

---

## Phase 7: finish (amendments)

**WP-7.2.** T-7.2.2 builds the suspend-unclaimed-accounts maintenance route and its tests only.
- **STOP:** the owner runs the D-27 count on production (D.1 step 3) and decides whether the route is ever run.

**WP-7.7.** Add one task:
- **T-7.7.9 Remove µ$ leftovers (AU-07).** Convert each item to CU, or archive it if `scripts/reachability.mjs` (T-7.7.7) reports it unreachable.
  - `src/durable_objects/rate_limiter/limiter.ts` (spend accumulator) and `rate_limiter/types.ts`.
  - `src/proxy/upstream/types.ts` (`costCalculator`, the bigint cost field) and its test in `src/proxy/upstream_client.test.ts`.
  - `src/router/registry/catalog.ts` and `src/router/registry/helpers.ts` (µ$ pricing).
  - `src/durable_objects/key_selector/types.ts`.
  - `src/contracts/v4_types.ts` (`community_debt_micro_cu`) and `src/contracts/v3_5_types.ts` (`Microdollars`).
  - The "Fixed-Point Microdollars" invariant in the file headers of `key_pool.ts`, `proxy/index.ts`, `router/index.ts`, `errors/domain_error.ts` and `proxy/upstream/client.ts`. Rewrite it as "Integer Credit Units".

**Phase 7 gate, amended.** It adds to v2's gate:
- `grep -rniE "microdollar|micro_cu|µ\\$" src ui/src` returns nothing (`archives/` excluded).
- The `void err;` count has not grown past 23. T-G.1.5 makes that check permanent.

---

## Phase G: guardrails

### WP-G.1 `wp.sh` and gate hardening

- **T-G.1.1 New forbid rules** in `forbid()`, applied to added lines. Each entry gives the pattern, the paths it covers, and the message:
  - `void\s+_?(err|e|error)\s*;` in `src/`: "swallowed error: log it or rethrow".
  - `\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(\{\s*\}|undefined|null)\s*\)` in `src/`: "swallowed promise rejection".
  - `@ts-(ignore|expect-error)` in `src/`, `test*` and `ui/src/`: "type suppression".
  - `\b(it|test|describe)\.(skip|todo)\(|\bx(it|describe)\(` in `.`: "skipped test".

  Add `scripts/wp.sh selftest`, which feeds each pattern one line that must match and one that must not, and exits non-zero on any miss.
- **T-G.1.2 One commit per task.** `finish` fails unless all of these hold:
  1. Every `T-…` listed under `### WP-x.y` in `docs/PROGRESS.md` appears in at least one commit subject on the branch.
  2. No commit subject names more than one task id.
  3. Every listed task is ticked.
  4. Task ids match `T-[0-9A-Z]+\.[0-9]+\.[0-9]+`, so ids like `T-G.1.1` work.
- **T-G.1.3 Red log.**
  - `wp.sh red T-x.y.z <tests>` appends `T-id HEAD-sha test-files` to `.wp/red.log`, which is git-ignored.
  - `finish` requires an entry for every task whose commit type is `feat` or `fix`. `refactor`, `test`, `docs` and `chore` are exempt.
- **T-G.1.4 Typecheck `ops/`.** Add `ops/**/*` to `tsconfig.json` `include` and fix the errors that appear.
- **T-G.1.5 Count baselines.**
  - `scripts/check-baselines.mjs` counts swallows (the T-G.1.1 patterns), `console.` outside `src/utils/logger.ts`, and `@ts-expect-error|@ts-ignore` across `src`, `test*` and `ui/src`.
  - It fails if any count is above `scripts/baselines.json`. Start from today's counts; WP-8.1 lowers them to 0.
  - Add it to `gate:fast`.

### WP-G.2 Operator ledger

- **T-G.2.1** In `docs/PROGRESS.md`:
  - Add "Operator steps for Phases 4–8", which is the D.1–D.4 lists below with a checkbox each.
  - Under WP-7.5 and WP-7.6, add "precondition waived under D-28 (2026-10-02), not met".

---

## Phase D: deploy and prove on dev (owner)

Facts:
- `ci-dev.yml` deploys only on a push to `develop`, and the pull-request run is gate-only.
- `deploy-prod.yml` deploys on a push to `master` or a `v*` tag. Do not merge to `master` before Phase D passes.

### D.1 Before deploy (STOP)

1. Back up both databases:
   ```
   npx wrangler d1 export key-collective-d1-dev --remote --output backups/dev-<date>.sql
   npx wrangler d1 export key-collective-d1 --remote --output backups/prod-<date>.sql
   ```
2. Count keys that are not HKDF-migrated, on dev and production:
   ```
   npx wrangler d1 execute key-collective-d1-dev --remote --command "SELECT COUNT(*) AS n FROM api_keys WHERE hkdf_migrated = 0"
   ```
   Run the same with `key-collective-d1`.
   - Dev: if the count is above 0, delete those test keys and re-add them after the deploy. That is simpler than running the migration script.
   - Production: expect 0. If it is not 0, stop; WP-F.4 then builds a runner.
3. D-27 count on production:
   ```
   SELECT COUNT(*) FROM users WHERE id LIKE 'gh_%' OR id LIKE 'usr_gh_%'
   ```
   If it is 0, the WP-7.2 suspend route never needs to run.
4. Check dev secrets with `npx wrangler secret list --env dev`. Expected: `KC_MASTER_KEY`, `SESSION_SIGNING_KEY`, `GITHUB_CLIENT_SECRET`, `TURNSTILE_SECRET`. `GITHUB_CLIENT_ID` is a var.
5. Run `npx wrangler d1 migrations list key-collective-d1-dev --remote` and note which migrations are pending. 0015–0024 are expected.

### D.2 Deploy (STOP)

- Run `git push origin docs/intent-audit-and-remediation:develop`. This creates `develop`, then CI runs the gate, applies the migrations and deploys `--env dev`.
- Expect a few seconds of 500s between the migrations and the deploy (AU-10).
- Rollback follows D-28.

### D.3 Smoke on dev (about 45 minutes)

Record results in `docs/specs/dev_smoke_<date>.md`. This includes the pending Phase 3 staging walkthrough.

1. Sign in, complete consent, link GitHub. Rights show the private and community pools.
2. Submit a Gemini key with Turnstile. Expect 201.
   - Record the real GCP probe response in `docs/specs/gcp_probe.md` (the Phase 3 leftover).
   - Submitting the same key again gives 409 `key_already_registered`.
3. Create a project and a project token. Call `POST https://api-dev.key-col.axe08.tech/v1/chat/completions` with it.
   - Expect 200 and a CU header.
   - The call appears in Analytics against the key id.
4. Call with a model whose provider has no key. Expect an honest fallback or a 429/503 body, not a 500.
5. Admin panel:
   - The provider override and the kill switch each change what the next request gets.
   - The audit log lists both actions.
   - reset-quota works on your tenant.
6. The Standing card and the Pool and My Contribution tabs show real numbers, with no placeholders.
7. Rotate the key. Delete it. Resubmit within 30 minutes: vesting carries over. After 30 minutes the project is tombstoned (409 `project_tombstoned`).
8. The public `/report` page submits with Turnstile, while signed out.
9. Run `npx wrangler tail --env dev` during all of the above. Any `Security Alert`, `QUARANTINED` or unhandled error is a finding.

### D.4 Soak (next UTC midnight)

- `standing_history` and `key_daily_stats` each gain a row for the day.
- The coordinator hourly stats rows exist.
- No key moved to `QUARANTINED` unexpectedly.

Every failure becomes a WP-F.x card that starts with a failing test reproducing it.

---

## Phase F: audit fixes

### WP-F.1 Durable would-deny stats (AU-03)

- **T-F.1.1** Migration `0025_would_deny_hourly.sql`, expand only:
  ```sql
  CREATE TABLE IF NOT EXISTS would_deny_hourly (
    hour_utc INTEGER NOT NULL, rule TEXT NOT NULL, tenant_hash TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hour_utc, rule, tenant_hash)
  );
  ```
- **T-F.1.2** Store and read the counts in D1:
  - `recordWouldDeny` upserts `count = count + 1`, through `ctx.waitUntil` where available. A failure is logged and never thrown.
  - Delete `inMemoryWouldDenyEvents`.
  - `getWouldDenyStats(db, hours)` becomes async SQL, and `GET /api/admin/commons/would-deny` awaits it.
  - Keep the Analytics Engine write.
  - Tests (Workers pool, real D1):
    - Rows inserted straight into D1 show up in the endpoint. This test is red today.
    - Two hits in the same tenant, rule and hour give `count = 2`.
    - Rows older than `hours` are excluded.
- **STOP after merge:** commons enforcement stays off on every environment until the owner reviews a week of these stats (D-24).

### WP-F.2 No mid-day reset for new tenants (AU-04)

- **T-F.2.1** Set and persist the reset day when a tenant is first seen:
  - When `TenantQuotaDO` loads with no stored `last_reset_day`, set `lastResetDay` to the current UTC day and persist it.
  - The first `nightlyReset` then runs at the next UTC midnight.
  - Test (deterministic clock from WP-1.1, Workers pool):
    1. Create the tenant at 14:00 UTC and make standing dirty.
    2. Run the alarm at 14:01. Expect no `standing_history` row and streak 0.
    3. Run the alarm at 00:00:05 the next day. Expect exactly one row.

### WP-F.3 Swallowed errors that hide writes (AU-02, pulled forward from WP-8.1)

- **Depends on:** T-7.7.5, since `src/utils/logger.ts` must already be wired.
- **Sites:** `grep -rn "void err;" src`, which lists 23 at `62f31ec`. They are in:
  - `pool/coordinator_do.ts`, `quota/tenant/tenant_do.ts`, `pool/enforcement.ts`
  - `worker/pool_routes.ts`, `worker/gateway/control.ts`, `worker/gateway/admin_handler.ts`
  - `worker/router/dashboard/abuse_routes.ts`, `worker/router/dashboard/keys/ops.ts`, `worker/router/dashboard/keys/get_keys.ts`

  One task per file. Fix each kind of site as follows:

  | Kind | Fix |
  |---|---|
  | State mirror or D1 write in a DO (standing mirror, vesting `UPDATE`, stats flush) | `logger.error(event, err)`; keep the dirty flag so the next alarm retries. Never clear dirty after a failed write. |
  | Request path | A typed `RouterError` with a status, or log and report degraded state in the body (the `sync: "pending"` pattern from `post_key.ts`). |
  | Telemetry (Analytics Engine write) | `logger.debug("telemetry_drop", err)` |

- **Tests, without D1 mocks.**
  - Mirror sites: break the write in the Workers pool, for example `ALTER TABLE contributor_standing RENAME TO cs_x`. Assert the logger recorded the event. Then rename the table back, run the next alarm, and assert the row is written.
  - Request-path sites: assert the HTTP status and body.
- **Done when** the swallow baseline is 0.

### WP-F.4 HKDF script disposition (AU-05)

- **T-F.4.1** If D.1 shows 0 unmigrated keys on production and on dev (after deleting the test keys):
  - Archive `ops/migrate_keys_hkdf.ts` and remove its use from `test/integration/commons/ac07_hkdf_isolation.test.ts`. The isolation tests stay.
  - Keep the `hkdf_migrated` column and the `=== 1` check as cheap defence.
- **STOP** if production shows any unmigrated key. The owner decides on a runner, for example an admin maintenance route that processes 50 rows per batch and is audit-logged.

---

## Phase 8: hardening and release (v2, amended)

- **WP-8.1.** Its scope is what WP-F.3 left: the remaining empty catches and `console.*`, plus ESLint.
  - `kc/catch-must-handle` must also reject `void err;` and `.catch(() => {})`.
  - Lower every count in `scripts/baselines.json` to 0.
- **WP-8.3.** Two more tasks:
  - **T-8.3.a** Replace `@ts-expect-error` absence checks with `expect(x).not.toHaveProperty(…)` or `expectTypeOf`.
  - **T-8.3.b Revert check (AU-08)** for WP-4.6, 6.1, 6.2 and 6.4. For each task, revert its `src` hunk on a scratch branch and run that WP's tests. If they still pass, the task has no test: write one that is red against the reverted code, and keep it.
- **WP-8.5.** Add S10 work for AU-11: sign `kc_pending` with `SESSION_SIGNING_KEY`, while still accepting the old signature for one cookie lifetime.
- **WP-8.6.** `gate` adds lint, `node scripts/reachability.mjs`, `(cd ui && npm run check)` and `scripts/check-baselines.mjs`.
- **WP-8.7.** Update `docs/ops/deploy.md`:
  - Remove the `ROUTING_ENGINE` flip and the `legacy_route_hit` query; both are gone.
  - Add the migrate-before-deploy window, the D-28 rollback floor, and "`develop` deploys dev, `master` deploys production".
- **Release gate, amended.** It adds to v2's release gate:
  - Phase D (D.2–D.4) passes on dev with the Phase 8 build.
  - **STOP:** the owner merges to `master`. That triggers `deploy-prod.yml`, which exports D1, applies migrations and deploys.

## Housekeeping (owner, any time)

About 30 stale worktrees from earlier HIVE and Antigravity runs are registered, including `.hive/wt/_stage-*` inside the repo. Review them with `git worktree list`. Remove the ones you no longer need with `git worktree remove <path>`, then run `git worktree prune`, so that greps and tools stop seeing duplicate source trees.
