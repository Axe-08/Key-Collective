# Phase 7 execution plan — Contract: remove everything deprecated

For: the agent (Antigravity / any IDE) implementing Phase 7 of `docs/REMEDIATION_PLAN_V2.md`.
Source of truth for *what* to build: the plan's **Phase 7** section. This file specifies *how* to work, the detailed task specifications, and *in which order*.
Progress is tracked in `docs/PROGRESS.md` (Phase 7 checklist); tick a box in the same commit that finishes each task.

---

## 1. Protocol (same as Phase 6)

One work package (WP) at a time, on its own branch, one commit per task, `--no-ff` merge.

```bash
./scripts/wp.sh start WP-7.x            # creates wp/WP-7.x from docs/intent-audit-and-remediation
./scripts/wp.sh red   <test-file>        # run tests → must FAIL (red)
./scripts/wp.sh check <test-file>        # run tests → must PASS (green)
# then: git add . && git commit -m "type(WP-7.x): summary (T-7.x.y)"
./scripts/wp.sh finish WP-7.x           # full gate → --no-ff merge
```

- Commit messages: `type(WP-7.x): summary (T-7.x.y)`
- Strict Quality Invariants: zero `any`, zero empty catches, integer CU only, `npm run gate` < 10 s.

---

## 2. Archive-Not-Delete Policy

> **All legacy code removed in this phase MUST be moved to `archives/` instead of deleted.**

For every file the plan marks for removal:

```bash
mkdir -p archives/$(dirname <relative-path>)
git mv <relative-path> archives/<relative-path>
```

Example: `git mv src/storage/d1/keys.ts archives/src/storage/d1/keys.ts`

This preserves history, keeps the code accessible for reference, and avoids accidental loss.
Tests that move to `archives/` are excluded from vitest automatically (vitest only scans `src/`, `test/`, `tests/`, `ui/`).

---

## 3. Rules learned in Phases 1–6 (read before writing tests)

1. **Where tests go:** Pure functions → `test/unit/` (Node pool). Workers pool (`vitest.workers.config.ts`) for anything touching D1, DOs, or `SELF.fetch`. UI DOM tests → `ui/src/lib/*.dom.test.ts`.
2. **Workers-pool pitfalls:** D1 auto-migrates from `migrations/`; no manual `CREATE TABLE`. Use `fetchMock.activate()` / `fetchMock.get()` for upstream stubs. `vi.useFakeTimers()` breaks Miniflare — use real time.
3. **Code rules:** No `any`. Expand-only migrations for existing columns; contract migrations (`ALTER TABLE DROP COLUMN`) get their own numbered file. Empty catches → `// Non-blocking fallback` comment required. All CU math is `bigint`.
4. **UI tests:** MSW handlers in `ui/src/mocks/handlers.ts`. Wildcard fallback returns `{}` — guard Svelte components against undefined fields.
5. **Archive rule:** `git mv` to `archives/`, never `rm`. Commit the archive move and the import rewiring in the same commit so the tree stays compilable.

---

## 4. Phase 7 overview

**Theme:** Remove everything deprecated. Old API URLs stop working; the console accepts only sessions; unclaimed legacy accounts are suspended. Deprecated D1 columns are dropped. Dead code is archived.

**Release:** R7

**Compatibility:** Each WP has a **Human** precondition proving that nothing uses what it removes. If a precondition is not met, leave that WP pending and ship the rest.

**Rollback:** Code rollback to R6 is safe for everything except the dropped columns (`0023`, `0024`); restore those from the pre-deploy D1 export (WP-1.3) only if R6 must run again.

---

## 5. Human precondition checklist

Before starting Phase 7, verify these preconditions. **Any WP whose precondition is NOT met is skipped** — the remaining WPs still ship.

| WP | Precondition | How to check |
|----|-------------|--------------|
| WP-7.3 | WP-6.5 deployed; no code reads µ$ columns | `grep -rn "cost_microdollars\|budget_microdollars\|spent_microdollars\|community_debt_micro_cu\|daily_spend_rollup" src/` returns nothing (**already true**) |
| WP-7.4 | WP-5.10 deployed; no D1 code reads `api_keys.dispatched_today`, `dispatched_communal`, `vesting_tier` | Confirmed: only `PoolCoordinatorDO` SQLite (not D1) uses these names — will be renamed |
| WP-7.5 | Production has run `ROUTING_ENGINE=leases` for ≥ 7 days without rollback | Operator checks deploy log |
| WP-7.6 | `SELECT COUNT(*) FROM api_keys WHERE hkdf_migrated = 0` returns 0 | Operator runs query in prod D1 |
| WP-7.1 | `Sunset` date from WP-2.7 has passed AND `legacy_route_hit` has been zero for 14 consecutive days | Analytics Engine query in `docs/ops/deploy.md` |
| WP-7.2 | 30-day notice period (D-27, after WP-3.5) has ended; operator has emailed/bannered legacy account owners | Operator confirms |
| WP-7.7 | WP-7.1, 7.2, 7.5, 7.6 all merged (the maintenance routes they use are archived here) | All preceding WPs done |

---

## 6. Execution order & task catalog

Order chosen to maximize parallelism with Human preconditions:

1. **WP-7.3** — Drop microdollar columns (precondition already met)
2. **WP-7.4** — Key schema contract (precondition already met)
3. **WP-7.5** — Retire legacy routing engine (Human: 7 days on leases)
4. **WP-7.6** — Retire legacy global-key decryption (Human: HKDF migration complete)
5. **WP-7.1** — Remove legacy API routes (Human: sunset + 14 days zero traffic)
6. **WP-7.2** — Sessions only; retire unclaimed legacy accounts (Human: 30-day notice)
7. **WP-7.7** — Dead code: wire or archive (depends on all above)

---

### WP-7.3 — Drop the microdollar columns

**Objective**: Migration `0023_credit_units_contract.sql` drops every µ$ column and the `daily_spend_rollup` table. Clean up the last µ$ reference in `telemetry_emitter.ts`.

**Human precondition**: WP-6.5 (Phase 6) already stopped every read and write. Already met.

#### T-7.3.1 — Migration `0023_credit_units_contract.sql`

- **Files**: `migrations/0023_credit_units_contract.sql` (new)
- **Changes**:
  ```sql
  -- Backfill any NULL cu values before dropping the cost column
  UPDATE cost_ledger SET cu = 10 + ((prompt_tokens + 999) / 1000)
                            + (((completion_tokens + COALESCE(reasoning_tokens, 0)) * 4 + 999) / 1000)
   WHERE cu IS NULL;

  -- Drop µ$ columns and tables
  DROP INDEX IF EXISTS idx_cost_ledger_cost_microdollars;
  ALTER TABLE cost_ledger DROP COLUMN cost_microdollars;

  DROP INDEX IF EXISTS idx_daily_spend_rollup_tenant_day;
  DROP TABLE IF EXISTS daily_spend_rollup;

  ALTER TABLE auth_tokens DROP COLUMN budget_microdollars;
  ALTER TABLE auth_tokens DROP COLUMN spent_microdollars;

  ALTER TABLE contributor_standing DROP COLUMN community_debt_micro_cu;

  DROP VIEW IF EXISTS cost_ledger_events;
  DROP VIEW IF EXISTS daily_spend_rollups;
  DROP VIEW IF EXISTS model_defs;
  ```
- **Verification**: `test/storage/migration_0023.test.ts` — applies `0023` on the production-shaped fixture after `0013`; asserts every `cost_ledger` row has non-NULL `cu`; asserts no `cost_microdollars` column exists; asserts `daily_spend_rollup` table does not exist.

#### T-7.3.2 — Clean telemetry emitter µ$ remnants

- **Files**: `src/worker/telemetry_emitter.ts`
- **Changes**:
  - Remove `costMicrodollars?: bigint` from `CreateTelemetryEventParams` (line 57).
  - Replace `Number(event.cu ?? event.costMicrodollars ?? 0)` with `Number(event.cu ?? 0)` (line 120).
  - Remove the `costMicrodollars` validation branch (lines 185–188).
  - Remove `costMicrodollars: params.costMicrodollars ?? 0n` from the mapper (line 272).
  - Update the JSDoc comment (line 9) to remove "Fixed-Point Microdollars" reference.
- **Verification**: `grep -rn "costMicrodollars\|microdollar\|Microdollar" src/` returns nothing. Existing telemetry tests pass.

#### T-7.3.3 — Schema conformance test

- **Files**: `test/unit/pure/no_microdollar_schema.test.ts` (new)
- **Changes**: Test that `grep -rn "microdollar\|Microdollar\|cost_microdollars\|budget_microdollars\|spent_microdollars\|daily_spend_rollup" src/` returns zero matches.
- **Verification**: `npm run test:unit`

**Done when**: The database has no µ$ column or table. `grep` returns nothing. Gate passes.

---

### WP-7.4 — Key schema contract

**Objective**: Migration `0024_key_schema_contract.sql` drops `api_keys.dispatched_today`, `dispatched_communal`, `vesting_tier`. Rename coordinator's internal SQLite columns to avoid naming collision. Clean `normaliseKeyStatus` legacy branches.

**Human precondition**: WP-5.10 already stopped D1 reads/writes of these columns. Already met.

> **IMPORTANT**: `PoolCoordinatorDO` uses `dispatched_today` / `dispatched_communal` in its **own transactional SQLite** (not D1 `api_keys`). These are live routing counters and must be **renamed** (not dropped) so the Phase 7 grep check passes without breaking routing.

#### T-7.4.1 — Rename coordinator SQLite columns

- **Files**: `src/pool/coordinator_do.ts`
- **Changes**:
  - In the coordinator's `CREATE TABLE IF NOT EXISTS` DDL statements (~lines 226–260): rename `dispatched_today` → `dispatches_today`, `dispatched_communal` → `dispatches_communal`. This applies to both `key_model_stats` and `key_stats` tables.
  - Update all SQL queries that reference the old names (~30 occurrences): `SELECT`, `UPDATE`, `INSERT`, `COALESCE(SUM(...))`.
  - Update all TypeScript property reads: `r.dispatched_today` → `r.dispatches_today`, `r.dispatched_communal` → `r.dispatches_communal`.
  - The coordinator's `this.ctx.storage.deleteAll()` on schema change ensures clean re-creation; existing DOs will reconcile from D1 on next alarm.
- **Files also affected**: `src/contracts/api/responses.ts` (rename zod fields `dispatched_today` → `dispatches_today`, `dispatched_communal` → `dispatches_communal`), `src/worker/router/dashboard/keys/get_keys.ts` (update property mapping).
- **Verification**: `grep -rn "dispatched_today\|dispatched_communal" src/` returns nothing. Existing coordinator and key selector tests pass.

#### T-7.4.2 — Migration `0024_key_schema_contract.sql`

- **Files**: `migrations/0024_key_schema_contract.sql` (new)
- **Changes**:
  ```sql
  -- Drop legacy columns from api_keys (no code reads them since WP-5.10)
  DROP INDEX IF EXISTS idx_api_keys_dispatched_today;
  DROP INDEX IF EXISTS idx_api_keys_dispatched_communal;
  ALTER TABLE api_keys DROP COLUMN dispatched_today;
  ALTER TABLE api_keys DROP COLUMN dispatched_communal;
  ALTER TABLE api_keys DROP COLUMN vesting_tier;
  ```
- **Verification**: `test/storage/migration_0024.test.ts` — applies `0024` after `0014` on the production-shaped fixture. Asserts no `dispatched_today`, `dispatched_communal`, or `vesting_tier` column exists in `api_keys`.

#### T-7.4.3 — Clean `normaliseKeyStatus` legacy branches

- **Files**: `src/durable_objects/key_pool/key_pool_do.ts`, `src/contracts/keys.ts`
- **Changes**:
  - `normaliseKeyStatus`: remove legacy value branches (`'Healthy'` → `'HEALTHY'`, `'Quarantined'` → `'QUARANTINED'`, etc.). The CHECK constraint from migration `0014` guarantees only canonical uppercase values exist. A non-canonical value now throws `InvalidKeyError`.
  - Remove `toEpochMs`'s seconds/ISO branches for `api_keys` and `projects` columns (if present in `contracts/keys.ts`).
- **Verification**: Unit test asserting `normaliseKeyStatus('Healthy')` throws. `grep -rn "dispatched_today\|dispatched_communal\|vesting_tier" src/` returns nothing.

**Done when**: The key schema has no legacy columns and no legacy value handling. Gate passes.

---

### WP-7.5 — Retire the legacy routing engine

**Objective**: Delete the `ROUTING_ENGINE` switch and the legacy `getKey()` path. `KeyPoolDO` shrinks to private keys only. Archive the dead code.

**Human precondition**: Production has run with `ROUTING_ENGINE=leases` for ≥ 7 days without rollback (D-23).

#### T-7.5.1 — Remove `ROUTING_ENGINE` switch from cascade router

- **Files**: `src/router/cascade/router.ts`, `src/router/leases/engine.ts`, `src/router/cascade/types.ts`, `src/worker/auth/types.ts`
- **Changes**:
  - `src/router/leases/engine.ts`: archive the file (`routingEngine()` function); leases are now the only path — no switch needed.
  - `src/router/cascade/router.ts` (`route()` method, ~lines 186–187): remove the `useLeases` conditional. The lease path is always taken. Remove `checkSelfKeyAvailable` method (~line 110).
  - `src/router/cascade/types.ts`: remove the `ROUTING_ENGINE` JSDoc references and the `routingEngine` field.
  - `src/worker/auth/types.ts`: remove `ROUTING_ENGINE?: "legacy" | "leases" | string` from `WorkerEnv`.
- **Archive**: `git mv src/router/leases/engine.ts archives/src/router/leases/engine.ts`
- **Verification**: `grep -rn "ROUTING_ENGINE\|selfKeyRouted\|checkSelfKeyAvailable" src/` returns nothing.

#### T-7.5.2 — Shrink `KeyPoolDO` to private keys only

- **Files**: `src/durable_objects/key_pool/key_pool_do.ts`
- **Changes**:
  - Remove the D1 query that loads `pool_type = 'COMMUNITY'` keys from other tenants (~line 324: `AND (k.tenant_id = ? OR (k.pool_type = 'COMMUNITY' ...)`). Replace with `WHERE k.tenant_id = ? AND upper(k.status) = 'HEALTHY'`.
  - Archive `getKey()` method (~lines 982–1012) — replaced by the lease orchestrator's `acquireLease()`.
  - Remove the stage-0 per-key D1 status re-check for borrowed snapshots (the `isNotOwned && this.env.DB` branch inside `getKey`).
- **Verification**: A tenant DO's key list contains only its own keys. `grep -rn "getKey\b.*provider.*tenantId" src/durable_objects/key_pool/` returns nothing for the legacy method.

#### T-7.5.3 — Remove `ROUTING_ENGINE` from `wrangler.jsonc` and scripts

- **Files**: `wrangler.jsonc`, `package.json`
- **Changes**:
  - Remove `"ROUTING_ENGINE": "legacy"` from top-level and production `vars` blocks (~lines 109, 186).
  - Remove `"ROUTING_ENGINE": "leases"` from dev and test `vars` blocks (~lines 120, 246).
  - Remove `"test:workers:legacy"` script from `package.json`.
- **Verification**: `grep -rn "ROUTING_ENGINE" wrangler.jsonc package.json` returns nothing.

#### T-7.5.4 — Archive legacy routing tests

- **Files**: Any test that sets `ROUTING_ENGINE=legacy`.
- **Changes**: `grep -rn "ROUTING_ENGINE.*legacy\|legacy.*ROUTING_ENGINE" test/ tests/ src/` to find them; archive each to `archives/`.
- **Verification**: `grep -rn "ROUTING_ENGINE" test/ tests/` returns nothing. Gate passes.

**Done when**: The lease orchestrator is the only routing path. No `ROUTING_ENGINE` references. Gate passes.

---

### WP-7.6 — Retire legacy global-key decryption

**Objective**: Archive the legacy global-key decryption path from `resolveLeasedKey` and `durable_objects/crypto.ts`. A row with `hkdf_migrated = 0` is now a `KeyDecryptionError` (quarantine).

**Human precondition**: `SELECT COUNT(*) FROM api_keys WHERE hkdf_migrated = 0` returns 0 in production.

#### T-7.6.1 — Simplify `resolveLeasedKey` to HKDF-only

- **Files**: `src/worker/router/core/key_resolver.ts`
- **Changes**:
  - Remove the lazy HKDF migration branch (~lines 138–198): if `hkdf_migrated !== 1`, throw `KeyDecryptionError` and quarantine the key instead of attempting legacy decryption + re-encryption.
  - Remove the JSDoc describing the lazy migration (lines 8–9).
  - The function now expects only HKDF-encrypted keys.
- **Verification**: Unit test asserting a row with `hkdf_migrated = 0` returns `KeyDecryptionError` and is quarantined.

#### T-7.6.2 — Archive legacy global-key decryption path in `crypto.ts`

- **Files**: `src/durable_objects/crypto.ts`
- **Changes**:
  - If `decryptKeyRaw` or `decryptKey` has a branch that uses a raw master key (not HKDF-derived tenant subkey) for decryption, archive the entire legacy path. The function now only accepts HKDF-derived keys.
  - Archive `src/durable_objects/crypto.spec.ts` (legacy global-key test) to `archives/src/durable_objects/crypto.spec.ts`.

> **NOTE**: If `crypto.ts` does NOT have an explicit legacy vs. HKDF branch (i.e., it only has a generic `decryptKey` that works with any CryptoKey), then T-7.6.2 is a no-op — the quarantine in T-7.6.1 is sufficient.

- **Verification**: A row with `hkdf_migrated = 0` is quarantined and the upstream is never called. Gate passes.

**Done when**: Only tenant HKDF subkeys can decrypt a key. Gate passes.

---

### WP-7.1 — Remove the legacy API routes

**Objective**: Archive `src/worker/api/legacy_routes.ts` and its wiring. The routing tables match section 2.1: console and apex never serve `/v1/*`; aliases return 404.

**Human precondition**: `Sunset` date from WP-2.7 has passed AND `legacy_route_hit` has been zero for 14 consecutive days.

#### T-7.1.1 — Archive legacy routes and unwire

- **Files**: `src/worker/api/legacy_routes.ts`, and wherever it is imported/wired.
- **Changes**:
  - `git mv src/worker/api/legacy_routes.ts archives/src/worker/api/legacy_routes.ts`
  - Remove the import and route dispatch from the main worker handler (check `src/worker/index.ts` or `src/index.ts`).
  - Remove `LEGACY_SUNSET` var from `wrangler.jsonc`.
- **Verification**: `grep -rn "legacy_routes\|LEGACY_SUNSET" src/ wrangler.jsonc` returns nothing.

#### T-7.1.2 — Route matrix integration tests

- **Files**: `test/integration/hosts.test.ts` (new or extend existing)
- **Changes**:
  - `POST https://console.../v1/chat/completions` → 404
  - `POST https://api.../chat/completions` → 404
  - `GET https://key-col.axe08.tech/v1/models` → 301 redirect to console
  - No response from any host carries a `Deprecation` header
- **Verification**: `npm run test:workers`

#### T-7.1.3 — Remove `Deprecation` / `Sunset` header injection

- **Files**: Check `src/worker/error_normalizer.ts`, headers middleware.
- **Changes**: Remove any `Deprecation` or `Sunset` header injection logic since the legacy routes no longer exist.
- **Verification**: `grep -rn "Deprecation\|Sunset.*header\|legacy_route_hit" src/` returns nothing. Gate passes.

**Done when**: Section 2.1 route matrix passes with no legacy rows. Gate passes.

---

### WP-7.2 — Sessions only on the console; retire unclaimed legacy accounts

**Objective**: Console `/api/*` accepts only `kc_session` (+ CSRF on mutations). The bearer branch is archived. A one-time maintenance route suspends unclaimed legacy accounts.

**Human precondition**: 30-day notice period (D-27, after WP-3.5) has ended; operator has emailed/bannered legacy account owners.

#### T-7.2.1 — Remove console bearer token branch

- **Files**: `src/worker/router/dashboard/handler.ts` (~lines 105–143)
- **Changes**:
  - Remove the `rawToken` / `authHeader` / bearer token extraction branch. Console `/api/*` now accepts only `kc_session` cookie authentication.
  - `api.*` still accepts only API keys (unchanged).
  - Archive the removed code block as a comment reference or move the logic to `archives/src/worker/router/dashboard/bearer_auth.ts`.
- **Verification**: Test: a bearer token on console `GET /api/keys` → 401. Existing session-based tests still pass.

#### T-7.2.2 — Add maintenance route to suspend unclaimed legacy accounts

- **Files**: `src/worker/gateway/admin_handler.ts`
- **Changes**:
  - Add `POST /api/admin/maintenance/suspend-unclaimed-legacy` (admin session only).
  - Implementation: `UPDATE users SET registration_status = 'SUSPENDED' WHERE (id LIKE 'gh_%' OR id LIKE 'usr_gh_%') AND registration_status = 'ACTIVE'`. Also: `UPDATE api_keys SET status = 'QUARANTINED' WHERE tenant_id IN (SELECT id FROM users WHERE registration_status = 'SUSPENDED' AND (id LIKE 'gh_%' OR id LIKE 'usr_gh_%'))`. Write one `admin_audit_logs` row with the count of affected users.
  - This route is called once by the operator, then archived in WP-7.7.
- **Verification**: Test: after the maintenance call, a legacy account's keys are never leased; a second call changes nothing.

#### T-7.2.3 — Archive legacy cookie-based auth token fallback

- **Files**: `src/worker/router/dashboard/handler.ts` (~lines 116–123)
- **Changes**:
  - Remove the `kc_auth_token` cookie fallback branch (this was the pre-session cookie).
  - Archive: `git mv` the extracted block to `archives/src/worker/router/dashboard/legacy_cookie_auth.ts`.
- **Verification**: `grep -rn "kc_auth_token" src/` returns nothing. Gate passes.

**Done when**: Console accepts no bearer credential. Gate passes.

---

### WP-7.7 — Dead code: wire or archive

**Objective**: Archive all 39 unreachable files (4,085 lines), facades, and one-off maintenance routes. Wire the sybil engine and logger. Create `scripts/reachability.mjs` and add it to `gate`.

**Depends on**: WP-7.1, 7.2, 7.5, 7.6 (the maintenance routes they use are archived here).

> **IMPORTANT**: Each task card archives one module group together with the tests that import it, so the type check passes per card.

#### T-7.7.1 — Archive parallel storage layer

- **Files to archive**:
  - `src/storage/d1/` (7 files: `adapter.ts`, `index.ts`, `keys.ts`, `ledger.ts`, `rollups.ts`, `types.ts`, `validation.ts`)
  - `src/storage/do.ts`
  - `src/storage/index.ts`
  - `src/storage/d1.spec.ts`
  - `src/storage/do.spec.ts`
- **Changes**: `git mv` each to `archives/`. Remove any imports of `src/storage/d1/` or `src/storage/do` from the remaining codebase (replace with repository imports if needed).
- **Verification**: `grep -rn "from.*storage/d1\|from.*storage/do\|from.*storage/index" src/` returns nothing. Gate passes.

#### T-7.7.2 — Archive unused contracts and barrels

- **Files to archive**:
  - `src/contracts/providers.ts` (replaced by `src/providers/config.ts`)
  - `src/proxy/index.ts` (barrel)
  - 7 barrel files: `src/auth/index.ts`, `src/constants/index.ts`, `src/contracts/index.ts`, `src/durable_objects/index.ts`, `src/quota/index.ts`, `src/router/index.ts`, `src/types/index.ts`
- **Changes**: `git mv` each to `archives/`. Update any surviving imports to use direct module paths.
- **Verification**: `grep -rn` for each archived barrel's import path returns nothing. Gate passes.

#### T-7.7.3 — Archive facade modules

- **Files to archive**:
  - `src/durable_objects/key_pool.ts` (facade)
  - `src/durable_objects/key_pool_do.ts` (facade, NOT the real `key_pool/key_pool_do.ts`)
  - `src/worker/router/chat_handler.ts` (facade)
  - `src/worker/router/dashboard_handler.ts` (facade)
  - `src/durable_objects/key_pool/rpc.ts` (HTTP RPC router — native DO RPC only now)
- **Changes**: `git mv` each to `archives/`. Rewrite any remaining imports to point to the real modules.
- **Verification**: No import of any archived facade. Gate passes.

#### T-7.7.4 — Archive one-off maintenance routes

- **Files**: `src/worker/gateway/admin_handler.ts`
- **Changes**:
  - Remove `POST /api/admin/maintenance/backfill-key-hash` handler (~lines 299–354). Archive the handler function to `archives/src/worker/gateway/maintenance_backfill.ts`.
  - Remove `POST /api/admin/maintenance/suspend-unclaimed-legacy` handler (added in WP-7.2). Archive to `archives/src/worker/gateway/maintenance_suspend_legacy.ts`.
- **Verification**: `grep -rn "backfill-key-hash\|suspend-unclaimed-legacy" src/` returns nothing. Gate passes.

#### T-7.7.5 — Wire `src/utils/logger.ts` as the only logger

- **Files**: `src/utils/logger.ts` (currently unreachable — wire it)
- **Changes**:
  - Verify `logger.ts` exports a structured JSON logger with `trace_id`, `tenant_id` (hashed), `event`, `error_code`.
  - Replace the top 5–10 most important `console.*` calls in `src/` with `logger.*` calls (remaining ones will be cleaned up in WP-8.1).
  - Import and use in at least: `src/worker/router/dashboard/handler.ts`, `src/pool/coordinator_do.ts`, `src/durable_objects/key_pool/key_pool_do.ts`.
- **Verification**: `logger.ts` is imported by at least 3 modules. Gate passes.

#### T-7.7.6 — Verify sybil engine is wired (no-op if already wired)

- **Files**: `src/auth/sybil/engine.ts`, `src/auth/github/link_flow.ts`
- **Changes**:
  - Confirm `evaluateAntiSybil` is called from `link_flow.ts:198` and `communityEligible` from `link_flow.ts:219`. If already wired (research confirms it is), this task is a verification-only no-op.
  - Ensure `src/auth/sybil/index.ts` barrel is NOT archived (it is used — unlike the dead barrels in T-7.7.2).
- **Verification**: `grep -rn "evaluateAntiSybil\|communityEligible" src/auth/github/` returns matches. Gate passes.

#### T-7.7.7 — Create `scripts/reachability.mjs` and add to gate

- **Files**: `scripts/reachability.mjs` (new), `package.json`
- **Changes**:
  - Script scans `src/` for `.ts` files, parses import graphs (regex-based), and reports files with zero inbound imports from the entry point (`src/index.ts`) or test files.
  - Files in `archives/` are excluded.
  - Exits with code 1 if any unreachable non-test source file is found.
  - Update `package.json` `"gate"` script to include `&& node scripts/reachability.mjs`:
    ```json
    "gate": "npm run gate:fast && npm run test:workers && npm run test:ui && node scripts/reachability.mjs"
    ```
- **Verification**: `node scripts/reachability.mjs` reports zero unreachable files. Gate passes.

#### T-7.7.8 — Wire `contracts/keys.ts` (`KeyStatus`, `PoolType` enums)

- **Files**: `src/contracts/keys.ts`
- **Changes**:
  - Verify `KeyStatus` and `PoolType` enums/types are imported by at least `key_pool_do.ts` and `get_keys.ts`. If not, add imports.
  - If `contracts/keys.ts` is already wired, this is a verification no-op.
- **Verification**: `grep -rn "from.*contracts/keys" src/` returns at least 2 matches. Gate passes.

**Done when**: `scripts/reachability.mjs` reports zero unreachable files. Gate passes.

---

## 7. Phase 7 gate verification

All of the following must pass before Phase 7 is signed off:

```bash
# 1. Full quality gate
npm run gate                        # < 10s for gate:fast portion

# 2. Reachability (added in WP-7.7)
node scripts/reachability.mjs       # 0 unreachable files

# 3. Grep checks — must all return NOTHING
grep -rn "ROUTING_ENGINE" src/ wrangler.jsonc
grep -rn "legacy_routes\|LEGACY_SUNSET" src/ wrangler.jsonc
grep -rn "microdollar\|Microdollar\|cost_microdollars\|budget_microdollars\|spent_microdollars" src/
grep -rn "dispatched_today\|dispatched_communal\|vesting_tier" src/
grep -rn "selfKeyRouted\|checkSelfKeyAvailable" src/
grep -rn "kc_auth_token" src/
grep -rn "backfill-key-hash\|suspend-unclaimed-legacy" src/

# 4. Archive directory exists and contains legacy code
ls archives/src/

# 5. Migrations applied cleanly
npm run test:db
```

---

## 8. PROGRESS.md Phase 7 skeleton

The Phase 7 skeleton has already been added to `docs/PROGRESS.md`.
