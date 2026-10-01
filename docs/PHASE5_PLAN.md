# Phase 5 execution plan — Commons economy (observe first)

For: the agent (Antigravity / any IDE) implementing Phase 5 of `docs/REMEDIATION_PLAN_V2.md`.
Source of truth for *what* to build: the plan's **Phase 5** section, **section 2.4** (coordinator,
lease sequence), and **section 2.2** (CU formula). This file says *how* to work and in *which order*.
Progress lives in `docs/PROGRESS.md` (Phase 5 checklist); tick a box in the same commit that finishes
the task.

---

## 1. Protocol (same as Phase 4)

One work package (WP) at a time, on its own branch, one commit per task, `--no-ff` merge.

```
scripts/wp.sh start WP-5.1            # branch wp/WP-5.1 from docs/intent-audit-and-remediation
# for each task:
#   1. write the test(s) first
scripts/wp.sh red   <test files>      # must FAIL before the fix (a pure import error is not a red check:
                                      #   create the module with a stub first, then red-check the behaviour)
#   2. implement
scripts/wp.sh check <test files>      # forbid rules + typecheck + those tests
#   3. before committing, if the change touches shared code, run both full suites:
#      npx vitest run && npx vitest run -c vitest.workers.config.ts
git commit -m "feat(WP-5.1): <what> (T-5.1.n)"   # body: why, deviations; end with the Co-Authored-By line
scripts/wp.sh finish WP-5.1           # full gate (node + workers + ui + ui-dom), then merge --no-ff
```

- **Commit messages**: `type(WP-x.y): summary (T-x.y.z)`. In the body, record anything that differs
  from the plan ("Deviation: …") and pre-existing bugs found and fixed.
- **Granularity**: one task per commit. If two tasks share the same hunks, one commit covering both
  (say so in the message) is fine. Don't use `git add -A` from the root while unrelated files are
  staged; check `git status` before committing.
- **Never** push or deploy; the human does that.
- **Test output is noisy** (logged errors). Read results with
  `grep -E "^ FAIL |^ +Test Files |^ +Tests  "` on a saved log rather than scrolling.
- If you stop mid-task, leave the checklist accurate; the first unticked box is the resume point.

## 2. Rules learned in Phases 1–4 (read before writing tests)

**Where tests go**
- Anything touching D1 or a Durable Object runs in the Workers pool: `test/integration/**` or `test/do/**`,
  run with `-c vitest.workers.config.ts`. `test/unit/**` is Node only (no D1).
- Hand-rolled D1 mocks (`prepare: (`) are forbidden (`scripts/wp.sh` forbid rule + `check-no-sql-mocks`).
  Use real `env.DB` from `cloudflare:test` and `test/helpers/world.ts` (`createUser({ github, eligible, tier,
  registrationStatus, role })`, `createSession(user)`, `createApiKey`, `addProviderKey`).
- Legacy tests listed under each WP's "Legacy tests (Appendix B)" must be migrated or deleted in that WP;
  when deleting, say in the commit where the coverage now lives.

**Workers-pool pitfalls**
- *Isolated storage failed / `.sqlite-shm`*: a test woke a real DO (KEY_POOL, RATE_LIMITER, …) and left
  storage open. In route tests pass an env with that binding set to `undefined`, or a small fake namespace
  (`{ idFromName: n => n, get: () => ({ fetch: async () => … }) }`), unless the test is *about* that DO.
  For DO logic, construct the class directly with a Map-backed storage
  (see `test/integration/identity/community_keys_d21.test.ts` `poolFor()`), or use the real binding with
  `runInDurableObject` and keep each test self-contained.
- *fetchMock*: `activate()` + `disableNetConnect()` in `beforeAll`. Interceptors that might not be consumed
  (a test that stops early) leak into the next test: use `.persist()` with a reply callback reading a
  per-test `scenario` variable.
- jose caches Google's JWKS across files: use `test/helpers/google_jwt.ts` (shared key pair).
- Default test clock: `Date.now()` in the Worker can be shifted by other suites; compute expiries in SQL
  (`datetime('now', ?)`) when comparing against SQLite time, and use the WP-1.1 test clock
  (`setClockForTest`, `test/helpers/clock.ts`) for breaker/cooldown/alarm timing.
- An authenticated `/v1` call that never reaches a provider: `POST /v1/chat/completions` with body
  `"{not json"` — auth and quota run, then 400.
- Users created by raw `INSERT INTO users` default to `registration_status = 'PENDING_CONSENT'` and are
  blocked from console `/api/*` (403). Use `createUser()` (ACTIVE + google identity) or set `'ACTIVE'`.

**Phase 4 lessons**
- **Coordinator must `reconcile` after key inserts**: integration tests that create keys via
  `addProviderKey()` and then send chat requests through the full stack need an explicit
  `coord.reconcile("groq")` call so the coordinator knows about D1 keys.
- **Request objects are consumed**: `Request` objects in Workers pool tests cannot be reused after their
  body is consumed. Create fresh `new Request(...)` objects for each `worker.fetch()` call.
- **`WorkerEnv` typing**: `POOL_COORDINATOR` is typed as `{}` in `WorkerEnv`. Cast as
  `DurableObjectNamespace | undefined` when accessing it directly.
- **Coordinator is provider-sharded**: `env.POOL_COORDINATOR.idFromName("pool:google")` and
  `"pool:groq"`. The special `"control"` instance handles maintenance state.

**Code rules**
- No empty `catch {}`, no `any` in `src/` (forbid rules check added lines only).
- Migrations run **before** the new Worker deploys and must be safe for the running release (D-26):
  expand only (add tables/columns/indexes, idempotent updates); drops wait for a later contract migration.
  Phase 5 migration numbers: **0018–0022**. Add a case to `test/integration/migrations.test.ts` that
  applies everything before it, seeds rows, applies the new one, and asserts.
- Console `/api/*` mutations need a session cookie **and** `x-kc-csrf`; responses for new errors use
  `{ error: "<code>" }` or the route's existing `{ error: { message, code } }` shape.
- `api.*` (`/v1`) ignores cookies; auth is the bearer API key. Errors go through `formatRouterError`.

**UI tests**
- Server-render tests: `*.test.ts` under `ui/src` (svelte/server). Interactive tests: `*.dom.test.ts`
  (client build + happy-dom, `ui/vitest.dom.config.ts`, msw for HTTP). `npm run test:ui` runs both.
- Never put the string `x-tenant-id` in `ui/src` (forbid rule + phase gate grep), not even in a test.

## 3. Phase 5 overview

Release R5. **User-visible changes:** keys join the pool after 24 h observation; debt and contribution
are real; standing and multiplier are computed; nightly decay; drain detection; jitter at provider
resets; the canary probe; truthful pool telemetry; project-hash rotation and tombstones. **New refusals**
(brake, eye-for-eye, share cap, jail) are only recorded until the operator enforces them (D-24).

**Compatibility:** `0018`–`0022` are additive. `api_keys.dispatched_today`, `dispatched_communal` and
`vesting_tier` are no longer read or written (WP-5.10) but still exist until WP-7.4.

**Rollback:** set `COMMONS_ENFORCEMENT=observe`; redeploy R4 if needed (it ignores the new tables).

## 4. Execution order

Phase 5 has 12 work packages. Order by dependencies then conflict risk:

```
WP-5.1 ─── WP-5.6 ─── WP-5.7
  │
  └─────────────────────── WP-5.12 (depends on 5.1, 5.3, 5.5, 5.10)
WP-5.2
WP-5.3 ─── WP-5.4 (depends on 5.3)
WP-5.5 ─── WP-5.10 (depends on 5.5)
WP-5.8
WP-5.9
WP-5.11
```

Recommended serial order (minimises conflicts in coordinator, TenantQuotaDO and orchestrator):

1. **WP-5.1** — Enforcement switch (dependency of 5.6, 5.7, 5.12)
2. **WP-5.2** — Observation lifecycle + anti-cycling
3. **WP-5.3** — Debt and contribution accounting
4. **WP-5.4** — Nightly reset: decay, trust, streaks (depends on 5.3)
5. **WP-5.5** — Dispatch counters, hero/parasite, self-key accounting
6. **WP-5.6** — Surge brake (depends on 5.1)
7. **WP-5.7** — Eye-for-eye firewall + share cap (depends on 5.1)
8. **WP-5.8** — Reset jitter and leaky-bucket queue
9. **WP-5.9** — Passive contributor canary
10. **WP-5.10** — Truthful pool telemetry (depends on 5.5)
11. **WP-5.11** — Project hash lifecycle, rotation, deletion
12. **WP-5.12** — Multiplier and quota jail (depends on 5.1, 5.3, 5.5, 5.10)

## 5. Existing state (what Phase 4 left)

Before you start, know what already exists:

| Area | State | Files |
|---|---|---|
| Coordinator alarm | Promotes OBSERVATION keys, reactivates COOLDOWN keys, prunes brakes/windows, D1 reconcile every 5 min. 60 s period. | `src/pool/coordinator_do.ts:263-266, 1035-1089` |
| TenantQuotaDO | Has `accrueDebt`, `decrementDebt`, `credit` (aliases `decrementDebt`), `getDebtState`, `syncDebtState` (persists + pushes owner debt to coordinators), daily alarm calls `processDailyDebtReset` | `src/quota/tenant/tenant_do.ts:268-400` |
| `processDailyDebtReset` | Decays 30 %/20 %, resets contribution to 0, counts debt-free streak (but uses 30 days for trust, not 7 per D-07). Does **not** have sliding-window contribution, `last_reset_day` catch-up, or `standing_history` insertion. | `src/quota/tenant/debt.ts:42-67` |
| `calculateMultiplierCeiling` | Returns 100/150/450/500 based on debt ratio, but does **not** include vesting or band caps. | `src/quota/tenant/debt.ts:13-29` |
| `determineJailStatus` | Uses `multiplierCeiling === 100` brittle equality (plan says: derive from `ratio_pct` directly). | `src/quota/tenant/debt.ts:31-40` |
| Enforcement switch | **Does not exist**. `src/pool/enforcement.ts` does not exist. No `COMMONS_ENFORCEMENT` env. | — |
| D1 `contributor_standing` | Has `community_debt_micro_cu`, `daily_contributed_cu`, `consecutive_debt_free_days`, `trusted_contributor`, `multiplier_ceiling`, `current_multiplier`, `last_decay_at`, `updated_at`. **Missing**: `contributed_cu_24h`, `multiplier_pct`, `jail_status`, `last_reset_day`. | `migrations/0007_contributor_standing.sql` |
| HERO/PARASITE stubs | `key_pool_do.ts:695-696` has `classification = "HERO"` / `"PARASITE"` string assignment but no counter writes, no `drain_state`, no `key_daily_stats`. | `src/durable_objects/key_pool/key_pool_do.ts:695-696` |
| Pool routes | `pool_routes.ts` has telemetry and contribution endpoints with hard-coded fallbacks. `pool_utilization_percent` is a communal-share ratio (wrong). `wProvider` is a float. | `src/worker/router/dashboard/pool_routes.ts` |
| Canary probe | `checkProofOfLife` exists in `src/ingress/probe.ts`. KeyPoolDO alarm does **not** call it for passive tenants. | `src/ingress/probe.ts` |
| Project hash registry | Has `rotating_until`, `tombstone_until`, `rotating` status. **Missing**: `vesting_started_at`. | `migrations/0006_project_hash_registry.sql`, `0014_schema_repair.sql` |
| Orchestrator `acquire()` | Tries private → own community → borrowed. Does **not** call any enforcement check (brake, eye-for-eye, jail). Calls `accrueDebt` and `credit` on borrowed settlement. | `src/router/leases/orchestrator.ts:91-320` |
| Provider config | `src/providers/config.ts` exists with `ProviderId`, `baseUrl` per provider. **Missing**: `dailyResetTz` reset timezone metadata. | `src/providers/config.ts` |

## 6. Tasks

### WP-5.1 Commons enforcement switch

**Creates:** `src/pool/enforcement.ts`, admin endpoint, telemetry integration.

- **T-5.1.1 Enforcement module.** Create `src/pool/enforcement.ts`:
  ```ts
  export type CommonsRule = "brake" | "eye_for_eye" | "share_cap" | "jail";
  export function commonsEnforcement(rule: CommonsRule, env: WorkerEnv): "observe" | "enforce";
  export function recordWouldDeny(rule: CommonsRule, tenantHash: string, detail: string, ae: AnalyticsEngine): void;
  ```
  Reads `COMMONS_ENFORCEMENT` (`observe` | `enforce`, default `observe`) and optional
  `COMMONS_ENFORCE_RULES` (comma-separated list; enforces only listed rules). `recordWouldDeny` writes
  one data point to Analytics Engine (`commons_would_deny` dataset, tenant id hashed via SHA-256,
  never raw).
  Add `COMMONS_ENFORCEMENT` and `COMMONS_ENFORCE_RULES` to `WorkerEnv` types (`src/worker/auth/types.ts`
  or `src/worker/gateway/types.ts`).
  Tests (Node unit, `test/unit/pool/enforcement.test.ts`):
  - Default (unset) → `observe` for every rule.
  - `enforce` with `COMMONS_ENFORCE_RULES=brake` → enforces only `brake`, observe for others.
  - `enforce` without `COMMONS_ENFORCE_RULES` → enforces all.
  - `recordWouldDeny` writes exactly one data point without the raw tenant id.

- **T-5.1.2 Admin would-deny endpoint.** `GET /api/admin/commons/would-deny?hours=24` in
  `admin_handler.ts`. Reads from Analytics Engine (the `commons_would_deny` data points), returns
  counts per rule and the ten most affected hashed tenants. Add to `vitest.workers.config.ts` bindings
  if needed.
  Tests (`tests/admin/admin_router.test.ts`, append):
  - Endpoint returns a structured response (even if empty).
  - Non-admin → 401.

### WP-5.2 Observation lifecycle and anti-cycling

**Migration:** `0018_anti_cycling.sql`.

- **T-5.2.1 Migration `0018_anti_cycling.sql`.** Add `api_keys.anti_cycling_until INTEGER` column (nullable).
  Add migration test case to `test/integration/migrations.test.ts`.
  Test: migration applies cleanly; existing rows have `anti_cycling_until IS NULL`.

- **T-5.2.2 Coordinator alarm promotes observation keys → D1.** The coordinator alarm already promotes
  OBSERVATION keys past `observation_until` in its SQLite. Add: after the batch promote SQL, write the
  same status transition to D1 (`UPDATE api_keys SET community_routing_status='ACTIVE',
  status_changed_at=? WHERE id IN (…) AND community_routing_status='OBSERVATION'`). Create a notification
  for each promoted key's owner ("Your key joined the community pool"). During OBSERVATION, the key is
  leasable only with `ownOnly=true` (this is already correct in the coordinator's `lease` method — verify
  with a test).
  Tests (`test/do/coordinator.test.ts` or `test/integration/commons/observation.test.ts`):
  - AC-05: key submitted at T=0 is not leasable by another tenant at T+23h59m and is at T+24h after
    one alarm cycle.
  - Owner can use it at T+1 min (via `ownOnly=true` lease).
  - Switching COMMUNITY→PRIVATE→COMMUNITY restarts the 24 h clock.
  - Promoted key generates exactly one notification.

- **T-5.2.3 Anti-cycling tier (FR-18).** In `src/worker/router/dashboard/keys/post_key.ts` (or
  wherever key submission checks the project hash): when a submission's project hash had an
  upstream-revocation tombstone in the prior 24 h, set `api_keys.anti_cycling_until = now + 3600000`
  (60 min in ms). `TenantQuotaDO` reads this value: while anti-cycling is active, the owner's
  vesting cap is 100 (1.00×) and the key earns no contribution credit.
  Tests: FR-18 case: tombstoned project, resubmit within 24 h → `anti_cycling_until` is set;
  multiplier for that tenant is 1.00× for 60 minutes and zero credit accrued.

### WP-5.3 Debt and contribution accounting

**Migration:** `0019_standing.sql`.

- **T-5.3.1 Migration `0019_standing.sql`.** Add to `contributor_standing`:
  `contributed_cu_24h INTEGER NOT NULL DEFAULT 0`,
  `multiplier_pct INTEGER NOT NULL DEFAULT 100`,
  `jail_status TEXT NOT NULL DEFAULT 'PRISTINE'`,
  `last_reset_day TEXT`.
  Add migration test case.

- **T-5.3.2 TenantQuotaDO: credit-first, sliding-window contribution.** Rewrite `credit()` to
  first reduce debt, then add to contribution (PRD: "debt decrements when the contributor's own key
  serves another user"). Replace `dailyContributedCu` (a single counter reset at midnight) with 24
  hourly buckets stored as a JSON array in DO storage key `contributed_buckets`. `contributed_24h` is
  the sum of all buckets. New credits add to the current-hour bucket. The alarm rolls buckets hourly.
  This implements D-12 (sliding window, no midnight cliff).
  Tests (`test/unit/quota/tenant_do.test.ts`, rewrite in Workers pool):
  - AC-02 with a test catalog override where every request costs exactly 1 CU: 100 borrowed requests
    → borrower debt 100, lender contribution 100.
  - Then the borrower's own community key serves 100 requests for others → borrower debt 0.
  - `credit` first reduces debt then adds remainder to contribution.
  - Contribution from 25 h ago is evicted from the sliding window.

- **T-5.3.3 Standing mirror to D1.** After debt or contribution changes, `TenantQuotaDO` marks itself
  dirty. Its alarm (every 60 s while dirty) upserts to `contributor_standing`:
  `community_debt_cu`, `contributed_cu_24h`, `multiplier_pct`, `jail_status`, `trusted_contributor`,
  `consecutive_debt_free_days`, `updated_at`. Insert on registration too
  (`INSERT INTO contributor_standing (tenant_id) VALUES (?)`).
  Tests: After the alarm, the `contributor_standing` D1 row equals the DO state.

- **T-5.3.4 Standing and contribution endpoints.** `GET /api/pool/standing` reads the caller's
  **live** standing from their TenantQuotaDO (authoritative, not the D1 mirror). Delete the hard-coded
  fallbacks in `pool_routes.ts:222-231`. A missing standing is a 500, not "PRISTINE".
  `GET /api/pool/contribution` computes `requests_served_for_community_today`,
  `personal_requests_today`, `cu_contributed_24h`, `cu_borrowed_24h`, `net_cu` from the coordinator
  (per-owner counters) and TenantQuotaDO.
  Tests: Standing endpoint for a brand-new user returns debt 0 and multiplier 1.00× from the DO.

### WP-5.4 Nightly reset: decay, trust, streaks

**Migration:** `0020_standing_history.sql`.

- **T-5.4.1 Migration `0020_standing_history.sql`.** Create `standing_history(tenant_id TEXT,
  day TEXT, multiplier_pct INTEGER, debt_cu INTEGER, contributed_cu_24h INTEGER,
  jail_status TEXT, PRIMARY KEY (tenant_id, day))`.
  Add migration test case.

- **T-5.4.2 Rewrite `processDailyDebtReset` → `nightlyReset`.** In `src/quota/tenant/debt.ts`,
  replace `processDailyDebtReset` with `nightlyReset` per the plan:
  ```ts
  export function nightlyReset(s: DebtState): DebtState {
    const decayPct = s.trusted ? 30n : 20n;                       // decided BEFORE trust changes
    const debt = s.debtCu - (s.debtCu * decayPct) / 100n;         // floor, integer
    const streak = s.debtCu === 0n ? s.streak + 1 : 0;
    const trusted = s.debtCu > 0n ? false : (s.trusted || streak >= 7);
    return { ...s, debtCu: debt, streak, trusted };               // contribution is a sliding window; not reset
  }
  ```
  Key changes from the current code:
  - **7-day trust** (not 30) per D-07.
  - **Contribution is NOT reset** — it's a sliding window now (WP-5.3).
  - Trust is cleared at the next reset if debt is positive ("cleared the first day debt goes positive"),
    not immediately in `accrueDebt`. Update `accrueDebt` to reset the streak immediately but leave
    the trust flag to the next nightly reset.
  - **`last_reset_day` catch-up**: the alarm applies `nightlyReset` once per missed day, not once per
    alarm invocation (handles downtime). Store `last_reset_day` in DO storage.
  - Each reset inserts a `standing_history` row to D1.
  Tests (Node unit, `test/unit/quota/debt.test.ts`):
  - Trusted tenant decays 30 %, untrusted 20 %.
  - Seven debt-free resets → trusted, 500 ceiling.
  - Debt 60 with `contributed_24h` 100 across midnight → SOFT_WARNING, not jailed.
  - Three missed alarms apply three decays.

### WP-5.5 Dispatch counters, hero/parasite, self-key accounting

**Migration:** `0021_key_daily_stats.sql`.

- **T-5.5.1 Migration `0021_key_daily_stats.sql`.** Create `key_daily_stats(key_id TEXT,
  day TEXT, model TEXT, dispatched INTEGER NOT NULL DEFAULT 0, communal INTEGER NOT NULL DEFAULT 0,
  cu_served INTEGER NOT NULL DEFAULT 0, classification TEXT, PRIMARY KEY (key_id, day, model))`.
  Add `api_keys.drain_state TEXT NOT NULL DEFAULT 'OK'` column.
  Add migration test case.

- **T-5.5.2 Coordinator dispatch counters.** Counters live in the coordinator's SQLite `keys` table
  (`dispatched_today`/`dispatched_communal`, already exist). Increment in `settle()` when settled
  (both already have the columns). `communal` only when `borrowed=true`.
  Delete `recordDispatch` and `selfKeyRouted` from contracts and code (they are dead). Delete the
  HERO/PARASITE stub in `key_pool_do.ts:695-696`.
  Tests: After 10 settle calls (5 borrowed, 5 own), coordinator stats show dispatched=10, communal=5.

- **T-5.5.3 Hero/parasite classification (D-16).** On an RPD-exhaustion 429 (from `classify.ts`
  outcome `rpd_exhausted`), the coordinator classifies the key:
  - Compute `kc_seen_pct = (dispatched_today for that model) × 100 / daily_limit`.
  - `kc_seen_pct >= 50`: clean exhaustion. `HERO` if `communal_pct >= 80` (badge + telemetry only),
    else `NORMAL`.
  - `kc_seen_pct < 50`: **drained day**. Store `effective_rpd` (rolling 7-day median of dispatches at
    exhaustion) and lend at most `min(rpd_limit, effective_rpd)` from then on.
  - 5 drained days in 7 → `DRAINED` status. Owner notification. Key stops counting toward multiplier.
  - 3 consecutive clean days → back to `OK`. Owner notification.
  Telemetry event `key_classification` records `kc_seen_pct`, `communal_pct`, result.
  Tests:
  - AC-10: 85 % communal, kc_seen_pct >= 50 → `HERO`, owner credit/multiplier unchanged.
  - kc_seen_pct < 50 → drained day, `effective_rpd` stored, lending capped.
  - 5 of 7 drained → `DRAINED`, one notification.
  - 3 consecutive clean → `OK`, one notification.
  - Counters are per model.
  - AC-11: evict coordinator → counters and drain state intact.

- **T-5.5.4 Midnight stats flush.** Coordinator's alarm (at midnight UTC): per-key daily totals are
  written to D1 `key_daily_stats` and counters are reset.
  Tests: After a midnight alarm, `key_daily_stats` has rows; coordinator counters are 0.

### WP-5.6 Surge brake

- **T-5.6.1 Remove pre-dispatch brake calls.** Remove the `brake-status` and `report-volume` calls
  from the chat handler if they still exist (verify — they may have been removed in Phase 4). If
  `chat/handler.ts` still references them, delete those calls. The brake now operates inside
  `lease(ownOnly=false)` in the coordinator.
  No test for this task (deletion).

- **T-5.6.2 Surge brake in the coordinator.** In `lease(ownOnly=false)`, compute the 5-minute window
  from `borrower_window(tenant, minute, cu)`. The coordinator already records borrowed CU at settle
  time. A brake triggers only when ALL of:
  - `pool_cu_5min >= BRAKE_MIN_POOL_CU` (default 2,000)
  - `active_borrowers >= 3`
  - `tenant_cu_5min × 100 > 35 × pool_cu_5min`
  When triggered and `commonsEnforcement('brake')` is `enforce`: refuse borrowed leases for 60 s
  (`brakes` table, already exists). In `observe` mode: `recordWouldDeny('brake', ...)` and grant
  the lease. Own keys are never braked.
  Constants in `src/constants/commons.ts` (create if missing), overridable via `vars`.
  Tests (`test/integration/commons/brake.test.ts`):
  - Single borrower sending 1,000 CU in 5 min → never braked.
  - Three borrowers with shares 60/20/20 over the minimum → the 60 % tenant is braked for 60 s,
    still served by its own keys, and unbraked at +61 s.
  - State survives coordinator eviction.
  - In `observe` mode the 60/20/20 scenario serves the 60 % tenant from borrowed keys and records
    exactly one `would_deny` event for `brake`.

### WP-5.7 Eye-for-eye firewall and cold-start share cap

- **T-5.7.1 Eye-for-eye check.** In the coordinator's `lease(ownOnly=false)`, require that the
  borrower owns at least one `ACTIVE` community key **in this provider shard**. Otherwise, when
  `commonsEnforcement('eye_for_eye')` is `enforce`, return `null` with reason `eye_for_eye`.
  In `observe` mode: `recordWouldDeny` and continue. The orchestrator, on a `null` with reason
  `eye_for_eye`, gives the final 429 saying which provider needs a contribution.
  `eye_for_eye_accessible` in `/api/pool/telemetry` is computed from the same function.
  Tests (`test/integration/commons/eye_for_eye.test.ts`):
  - Gemini-only contributor cannot borrow Groq → 429 `eye_for_eye`.
  - In `observe` mode the contributor is served from Groq and one `would_deny` recorded.

- **T-5.7.2 Share cap (FR-12).** Coordinator tracks each owner's share of CU served to borrowers
  over the trailing 24 h (from `borrower_window` or a parallel `owner_service_window`). With
  `N` = distinct owners with ACTIVE keys in the shard, cap = 40 % if N ≤ 5, else `max(20%, 200/N %)`.
  Owners at or above the cap are excluded from borrowed-lease candidates when
  `commonsEnforcement('share_cap')` is `enforce`. In `observe`: `recordWouldDeny` and keep them.
  Tests (`test/integration/commons/share_cap.test.ts`):
  - AC-14 with N = 4 owners and skewed priority → no owner exceeds 40 % of served CU over 1,000
    simulated leases.
  - N = 10 → cap 20 %.

### WP-5.8 Reset jitter and leaky-bucket queue

- **T-5.8.1 Provider reset config.** Extend `src/providers/config.ts` (which already has `ProviderId`
  and `baseUrl`). Add `dailyResetTz` to `ProviderConfig` and a `nextProviderReset` helper:
  ```ts
  export const PROVIDER_RESET: Record<string, { dailyResetTz: string }> = {
    google: { dailyResetTz: "America/Los_Angeles" },
    groq: { dailyResetTz: "UTC" },
  };
  export function nextProviderReset(provider: string, now: number): number;
  ```
  The operator should have recorded actual values in `docs/specs/provider_quotas.md` before this
  phase; if that file does not exist, use the above defaults and note the deviation.
  Tests (Node unit, `test/unit/providers/config.test.ts`):
  - `nextProviderReset("google", <some timestamp>)` returns a time in `America/Los_Angeles` midnight.
  - `nextProviderReset("groq", <some timestamp>)` returns UTC midnight.

- **T-5.8.2 Jitter on RPD cooldown.** On an RPD-exhaustion 429, the coordinator sets
  `reactivate_at = next_reset(provider) + uniform(0, 300_000)` using `crypto.getRandomValues`.
  The alarm reactivates keys whose `reactivate_at` has passed (already does this).
  Tests (`test/integration/commons/jitter.test.ts`):
  - AC-12: exhaust 100 keys at 23:59:30 provider time → all `reactivate_at` within
    [reset, reset+300 s], spread > 240 s, Kolmogorov–Smirnov statistic against uniform below 0.05.

- **T-5.8.3 Leaky-bucket retry.** When `lease` returns `null` because every candidate is in COOLDOWN
  and `now` is within ±5 min of that provider's reset, the orchestrator retries with 250 ms backoff
  for up to 5 s total before returning 429.
  Tests: A request at reset−2 s waits and succeeds when a key reactivates within 5 s.

### WP-5.9 Passive contributor canary

- **T-5.9.1 Nightly canary probe.** KeyPoolDO's 00:00 UTC alarm (extend it if it doesn't already run
  at midnight): ask TenantQuotaDO for yesterday's personal request count. If `< 50`, ask the
  coordinator for the tenant's community keys and run the shared proof-of-life probe
  (`checkProofOfLife` from `src/ingress/probe.ts`) on each: 200 → `HEALTHY`; 401/403 → quarantine
  flow (WP-4.3's `classify.ts`); 429 → no action. One request per key per day.
  Tests (`test/integration/commons/canary.test.ts`):
  - Passive tenant with 2 community keys, one revoked upstream (mock 401) → that key QUARANTINED
    and a notification created.
  - Active tenant (≥ 50 requests) → no probe calls.

### WP-5.10 Truthful pool telemetry

- **T-5.10.1 Coordinator hourly stats.** Coordinator alarm (add an hourly sub-tick to the existing
  60 s alarm) computes per shard: `active`, `observation`, `quarantined`,
  `utilisation_pct = Σ day_count × 100 / Σ rpd_limit` over ACTIVE keys (true capacity utilisation),
  `p90_latency_ms` from its own settle-time latency histogram.
  `w_provider_pct = active_ratio_pct × min(100, TARGET_P90_MS × 100 / p90) / 100` with
  `TARGET_P90_MS = 800`. Displayed as `w_provider_pct / 100` with two decimals (1.00× optimal).
  Tests: Seeded coordinator with known counters → `stats()` returns exact integers.

- **T-5.10.2 Truthful telemetry endpoints.** `/api/pool/telemetry` aggregates both shards' `stats()`;
  no D1 aggregate query, no `ctx.waitUntil` pushes from a GET handler.
  `get_keys.ts` and `/api/pool/contribution` read per-key counters from the coordinator.
  After this WP, no code reads or writes `api_keys.dispatched_today`, `dispatched_communal` or
  `vesting_tier` (they are left in the schema for WP-7.4 to drop).
  Tests:
  - `w_provider` is 1.00× when p90 ≤ 800 ms and all keys active.
  - No request to the endpoint mutates coordinator state.

### WP-5.11 Project hash lifecycle, rotation and deletion

**Migration:** `0022_project_hash_vesting.sql`.

- **T-5.11.1 Migration `0022_project_hash_vesting.sql`.** Add
  `project_hash_registry.vesting_started_at INTEGER` column.
  Add migration test case.

- **T-5.11.2 Soft delete and 30-minute resubmission window.** `DELETE /api/keys/:id`:
  mark the key `REVOKED` (soft delete), remove from DO/coordinator, set its registry row to
  `ROTATING`, `rotating_until = now + 30 min`, and store `vesting_started_at` on the registry row.
  Resubmission within 30 min from the same tenant and same project (probe hash matches) → registry
  back to `ACTIVE`, new key inherits `vesting_started_at` (vesting preserved). Any other tenant → 409.
  Tests: AC-06 (delete, wait 31 min → resubmission from same project by anyone → 409 for 14 days,
  accepted after). In-window resubmission by owner keeps vesting.

- **T-5.11.3 Tombstone lifecycle.** Coordinator alarm (or lazy check at submission) turns expired
  `ROTATING` into `TOMBSTONED`, `tombstone_until = rotating_until + 14 d`. Upstream permanent
  revocation (repeated 401 after canary) and takedown → `TOMBSTONED` directly.
  **Rotate** (`POST /api/keys/:id/rotate`) becomes: probe the new key (same project for Google,
  else 409 `project_mismatch`), proof-of-life, re-encrypt, update `key_hash`, prefix/suffix; vesting
  preserved.
  Tests: Rotate with a key from another project → 409.

### WP-5.12 Multiplier and quota jail

- **T-5.12.1 `multiplier_pct` with three caps.** Rewrite `calculateMultiplierCeiling` into
  `calculateMultiplierPct` in `src/quota/tenant/debt.ts`:
  ```ts
  multiplier_pct = min(vesting_cap, debt_cap, band_cap)
  ```
  All integers (100 = 1.00×):
  - `vesting_cap` (FR-17): from the age of the owner's oldest ACTIVE community key whose
    `drain_state` is `OK` (D-16; `DRAINED` keys don't count): 0–2 h → 150; 2–12 h → 250;
    ≥ 12 h → 450 (500 if trusted). No counting community key → 100.
  - `debt_cap` (FR-03): `ratio_pct = debt * 100 / max(contributed_24h, 1)`;
    > 100 → 100 (HARD_JAIL); > 50 → 150 (SOFT_WARNING); else 450 / 500 trusted (PRISTINE).
  - `band_cap` (FR-26): from coordinator utilisation for the tenant's providers (WP-5.10):
    < 60 % → 450; < 80 % → 300; < 95 % → 150; else 100. Coordinator pushes band changes to a small
    `pool:bands` value that TenantQuotaDO reads on its alarm (not per request).
  Tests (Node unit, `test/unit/quota/multiplier.test.ts`):
  - Table test across vesting × debt × band combinations.
  - Owner whose only community key is `DRAINED` → `vesting_cap` 100.

- **T-5.12.2 Quota evaluator uses multiplier.** `evaluateQuota` uses
  `effective_limit = tier_limit * multiplier_pct / 100` for RPM and RPD. Tier limits stay the base.
  Tests: SOFT_WARNING tenant's RPM ceiling = `tier_rpm × 1.5`. Non-contributor stays at tier limits.

- **T-5.12.3 Jail enforcement.** When `commonsEnforcement('jail')` is `enforce`, HARD_JAIL tenants
  get `ownOnly=true` leases only. In `observe` mode they are served as before; the response carries
  `x-kc-commons-notice: quota_jail`, and `recordWouldDeny('jail', ...)` is logged. When no own key
  is available, the response is the PRD Flow F body (in CU):
  ```json
  { "error": { "type": "quota_jail", "code": "quota_jail",
      "message": "Community debt limit reached. Only your own keys are available.",
      "community_debt_cu": 1420, "contributed_cu_24h": 1380, "multiplier": "1.00x",
      "recovery": { "debt_decay": "20% per day at 00:00 UTC", "estimated_days": 3 } } }
  ```
  `estimated_days` = smallest `n` with `debt × 0.8ⁿ ≤ contributed_24h`, computed with integers
  (loop, max 30).
  Remove `determineJailStatus`'s dependency on `multiplierCeiling === 100`; jail status derives from
  `ratio_pct` directly.
  Tests:
  - AC-03 (debt 101, contributed 100, own keys exhausted → 429 `quota_jail` body as above).
  - In `observe` mode the tenant is served from borrowed keys, response carries
    `x-kc-commons-notice: quota_jail`, one `would_deny` event for `jail` recorded.

## 7. Phase 5 gate (before asking the human to sign off)

- `npm run gate` green on **both** engines (`ROUTING_ENGINE=leases` and `legacy`).
- AC-02 (debt), AC-03 (jail), AC-05 (observation), AC-06 (tombstone), AC-10 (hero), AC-11 (eviction),
  AC-12 (jitter), AC-14 (share cap) pass in the Workers harness with `COMMONS_ENFORCEMENT=enforce`.
- The same ACs pass with `COMMONS_ENFORCEMENT=observe` (observe-mode variants).
- Every Phase 5 box in `docs/PROGRESS.md` ticked; deviations listed there.
- Human (not the agent's job): 7 days in observe mode on production, would-deny review, then
  `COMMONS_ENFORCEMENT=enforce`.

## 8. Context from Phase 4 that Phase 5 touches

- **Coordinator `settle`** (`coordinator_do.ts`): Phase 5 WP-5.5 adds dispatch counter increments
  and hero/parasite classification on RPD-exhaustion inside `settle`. WP-5.6 writes to
  `borrower_window` on borrowed settlements (verify this already happens; if not, add it).
- **Orchestrator `acquire`** (`orchestrator.ts`): WP-5.6, 5.7, 5.12 add enforcement checks before
  the `ownOnly=false` coordinator lease call. These go between step 2b (own community) and step 2c
  (borrowed) in the plan's sequence.
- **`TenantQuotaDO` alarm** (`tenant_do.ts`): WP-5.3 changes the contribution model from a daily
  counter to a sliding window. WP-5.4 replaces `processDailyDebtReset` with `nightlyReset`. Both
  touch the same alarm handler. Do WP-5.3 first, then WP-5.4 builds on it.
- **`classify.ts`** (`src/proxy/upstream/classify.ts`): WP-5.5 reads the `rpd_exhausted` outcome
  to trigger hero/parasite classification. WP-5.8 reads it to apply jittered cooldown.
  Neither changes `classify.ts` itself.
- **`checkProofOfLife`** (`src/ingress/probe.ts`): WP-5.9 calls it from KeyPoolDO's alarm. It
  already exists and returns a status; the canary just needs to interpret the result.
- **`api_keys` columns**: WP-5.5 adds `drain_state`. WP-5.2 adds `anti_cycling_until`. WP-5.11 adds
  `vesting_started_at` to `project_hash_registry`. WP-5.10 stops reading `dispatched_today`,
  `dispatched_communal`, `vesting_tier` — but doesn't drop them (that's WP-7.4, Phase 7).
