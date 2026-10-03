# Phase 8 execution plan: guardrails, audit fixes, hardening and release

This plan is for the agent implementing the work after Phase 7.

- **What to build** comes from `docs/REMEDIATION_PLAN_V3.md` (Phases G, D and F, plus the Phase 8 amendments) and `docs/REMEDIATION_PLAN_V2.md` (Phase 8).
- **This file** says how to work, the task catalog, and the order.
- **Progress** goes in `docs/PROGRESS.md`. The first commit of this phase pastes the checklist from section 7 there. Tick each box in the commit that finishes the task.

**STOP** marks a step only the owner can do. Stop, report what you need, and wait. Never tick a STOP step, and never treat a precondition as met because the tests pass (D-30).

---

## 1. Protocol

One work package at a time, on its own branch, one commit per task, and a `--no-ff` merge.

```bash
./scripts/wp.sh start WP-8.x
./scripts/wp.sh red   T-8.x.y <test-file>   # must FAIL. After T-G.1.3, the task id is required.
./scripts/wp.sh check <test-file>           # must PASS
git add <the files this task changed>       # never `git add .` or `git add -A`
git commit -m "type(WP-8.x): summary (T-8.x.y)"
./scripts/wp.sh finish WP-8.x
```

- **One task id per commit subject.** After T-G.1.2, `finish` rejects a branch where any task has no commit, or any commit names two tasks. WP-4.6, 6.1, 6.2 and 6.4 were bundled into single commits; that must not happen again.
- **Commit types.** A task that adds or changes behaviour is `feat` or `fix`, and needs a red-check entry. `refactor`, `test`, `docs` and `chore` are exempt.
- **Never push or deploy.** Deploying is Phase D and belongs to the owner.

## 2. Rules: corrections to PHASE7_PLAN §3

1. **No more comment-only catches.** PHASE7_PLAN told you an empty catch was fine with a `// Non-blocking fallback` comment, and that produced the 22 `void err;` swallows. That rule is withdrawn. Every `catch` must do one of these:
   - rethrow;
   - return a typed error that becomes an HTTP status;
   - call `logger.*` from `src/utils/logger.ts`, which T-7.7.5 wired.

   Even telemetry drops must at least call `logger.debug`.
2. **No type suppressions.** That means no `@ts-expect-error` or `@ts-ignore` anywhere, including tests. To assert that a property is absent, use `expect(obj).not.toHaveProperty("x")` or `expectTypeOf`.
3. **Time in Durable Object tests.** Use `test/helpers/clock.ts` (the WP-1.1 clock). `vi.useFakeTimers()` still breaks Miniflare.
4. **Making D1 fail without mocks.** In the Workers pool, rename the table inside the test, e.g. `ALTER TABLE contributor_standing RENAME TO cs_x`, then rename it back. Hand-rolled D1 mocks stay forbidden.
5. **Archive, don't delete.** `git mv` the file to `archives/`, and rewire its imports in the same commit. The exceptions are files V2 says to delete outright: lockfiles, and `docs/data_contracts.go` and `.py`.
6. **Migrations.** Expand only. `0025` is next, and is taken by T-F.1.1.
7. **Everything else in PHASE4_PLAN.md and PHASE7_PLAN.md §3 still applies**: test placement, fetchMock, the msw wildcard, and never the literal `x-tenant-id` in `ui/src`.

## 3. Baseline (at `f84c7ef`, during WP-7.7)

These are the counts `scripts/check-baselines.mjs` (T-G.1.5) starts from. Phase 8 takes each to 0.

| Metric | Count | Where |
|---|---|---|
| `void err;` swallows | 22 | `pool/coordinator_do.ts`, `quota/tenant/tenant_do.ts`, `pool/enforcement.ts`, `worker/pool_routes.ts`, `worker/gateway/control.ts`, `worker/gateway/admin_handler.ts`, `dashboard/abuse_routes.ts`, `dashboard/keys/ops.ts`, `dashboard/keys/get_keys.ts` |
| Empty `catch {}` | 1 | `dashboard/keys/get_keys.ts:92` |
| `console.*` outside the logger | 16 | `gateway/main_worker.ts`, `gateway/subdomain.ts`, `gateway/console_handler.ts`, `dashboard/auth_routes.ts`, `dashboard/token_routes.ts`, `auth/github/link_flow.ts` |
| `any` in `src` | 16 | `worker/auth/middleware.ts`, `dashboard/handler.ts` (including `this as any` into `handleAdminRequest`), `worker/index.test.ts` |
| `any` in `ui/src` | 27 | — |
| `@ts-expect-error` / `@ts-ignore` | 10 | `src`, `test*`, `ui/src` |
| Hard-coded admin and contact emails | 20 | `admin_handler.ts`, `dashboard/handler.ts`, `openapi_spec.ts`, 6 admin Svelte files, `App.svelte` |
| Second package manager | 3 files | `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `ui/pnpm-lock.yaml` |
| Acceptance tests | 2 of 15 | `ac07` (in `test/integration/commons/`) and `ac08` (in `test/unit/worker/`) |

## 4. Order

```
WP-G.1 → WP-G.2 → STOP: Phase D (owner) → WP-F.1 → WP-F.2 → WP-F.3 → WP-F.4
       → WP-8.1 → WP-8.2 → WP-8.3 → WP-8.4 → WP-8.5 → WP-8.6 → WP-8.7 → STOP: release
```

- **WP-F.4** needs the D.1 counts.
- **WP-F.3** needs T-7.7.5 (the logger).
- **WP-8.6** needs 8.1 and 8.3.
- **WP-8.4 and 8.5** have no dependencies. If Phase D is slow, write them while you wait; they are tests only.
- **Phase D findings.** Each becomes a `WP-F.x` card (F.5, F.6, …) whose first task is a failing test that reproduces the problem. Insert it before WP-8.1.

## 5. Task catalog

### Phase G and Phase F

Use the task specs in `REMEDIATION_PLAN_V3.md` as written. The tasks are:
- T-G.1.1 to T-G.1.5, and T-G.2.1.
- T-F.1.1, T-F.1.2, T-F.2.1, T-F.4.1.
- WP-F.3, split one task per file:

| Task | File |
|---|---|
| T-F.3.1 | `pool/coordinator_do.ts` |
| T-F.3.2 | `quota/tenant/tenant_do.ts` |
| T-F.3.3 | `pool/enforcement.ts` |
| T-F.3.4 | `worker/pool_routes.ts` |
| T-F.3.5 | `worker/gateway/control.ts` |
| T-F.3.6 | `worker/gateway/admin_handler.ts` |
| T-F.3.7 | `dashboard/abuse_routes.ts` |
| T-F.3.8 | `dashboard/keys/ops.ts` |
| T-F.3.9 | `dashboard/keys/get_keys.ts`, including the empty catch at line 92 |

### WP-8.1 Silent failures and lint

- **T-8.1.1 ESLint.** Add a flat config to the root and to `ui/` (`typescript-eslint`, and `eslint-plugin-svelte` for the UI), plus `npm run lint`. Rules:
  - `no-empty` with `allowEmptyCatch: false`;
  - `@typescript-eslint/no-explicit-any`;
  - `@typescript-eslint/ban-ts-comment`;
  - `no-console`, except in `src/utils/logger.ts`.

  Start with every rule set to `warn` so the tree passes; T-8.1.5 raises them to `error`.
- **T-8.1.2 `kc/catch-must-handle`.** A local rule in `eslint/kc-plugin.mjs`. It allows a catch body that rethrows, returns, or calls `logger.*`. It rejects `void err;`, a catch body that is only a comment, and `.catch(() => {})`, `.catch(() => null)` and `.catch(() => undefined)`.

  **Exception:** `.catch(() => null)` is allowed when it is directly on `request.json()` and a schema check follows. Tests: ESLint `RuleTester` with valid and invalid samples, in `test/unit/lint/catch_must_handle.test.ts`.
- **T-8.1.3 `console.*` to the logger** in the 6 files listed in §3.
  - `auth_routes.ts` and `link_flow.ts` log raw OAuth errors today, so they must go through the sanitizer.
  - Test: an OAuth failure with a token-shaped string in the upstream error. The captured log does not contain it.
- **T-8.1.4 Unparseable bodies give 400 `invalid_json`.** Find every `request.json()` whose failure path does not end in a 400 with a schema error, and make it end in `400 invalid_json`. Tests: a malformed body on each such route.
- **T-8.1.5 Raise to error.** Set the lint rules from T-8.1.1 to `error`, add `lint` to `gate:fast`, and set `swallows`, `empty_catch` and `console` in `scripts/baselines.json` to 0.

### WP-8.2 Type safety and configuration

- **T-8.2.1 Remove `any` from `src`.**
  - DO alarms use `DurableObjectStorage.getAlarm` and `setAlarm` from `@cloudflare/workers-types`, with no casts.
  - `TenantQuotaDO` stored state is parsed with a zod schema.
  - `handleAdminRequest` gets a typed context instead of `this as any`.
- **T-8.2.2 Remove `any` from `ui/src`** (27 sites).
- **T-8.2.3 Remove type suppressions from `src` and `ui/src`.** Tests are handled in T-8.3.2.
- **T-8.2.4 `ADMIN_EMAILS` var.**
  - Server: the admin check reads `env.ADMIN_EMAILS` (comma-separated) and removes the literals from `admin_handler.ts` and `dashboard/handler.ts`.
  - UI: shows the signed-in admin's identity from the session or `/api/me` response, never a literal.
  - `openapi_spec.ts` gets its contact email from a var, or drops it.
  - **STOP:** the owner sets `ADMIN_EMAILS` for `dev` and `production` in `wrangler.jsonc` vars before Phase D runs again.
  - Test: a non-listed email gets 404 from `/api/admin/*`; a listed one gets 200.
  - Done when `grep -rnE "keycollective\.(io|ai)" src ui/src` returns only test fixtures.
- **T-8.2.5 Firebase config.**
  - If `ui/src/lib/firebase.ts` is unreachable (per `scripts/reachability.mjs`), archive it.
  - Otherwise read its config from `VITE_FIREBASE_*`.
- **T-8.2.6 npm only.** Delete `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `ui/pnpm-lock.yaml`. `npm ci` must pass at the root and in `ui/`.
- **T-8.2.7 Baselines.** Set `any` and `ts_suppressions` (in `src` and `ui/src`) in `scripts/baselines.json` to 0.

### WP-8.3 Tests that pass without testing

- **T-8.3.1 Inventory.**
  - List the rows of V2 §10.2 (Appendix B) that are still open, together with `test/error_normalizer.test.ts`.
  - Add one sub-task per file group to `PROGRESS.md` (T-8.3.1a, T-8.3.1b, …) in a `docs` commit.
  - A rewrite that exposes a real bug is a `fix`: it needs a red-check entry and fixes the bug in the same task.
- **T-8.3.2 Type suppressions in tests.** Replace `@ts-expect-error` absence checks (for example in the WP-6.5 header and telemetry tests) with runtime or `expectTypeOf` assertions.
- **T-8.3.3 to T-8.3.6 Revert checks**, one task each for WP-4.6, 6.1, 6.2 and 6.4, which were bundled.
  - For each original task in the WP, revert its `src` or `ui/src` hunk on a scratch branch and run that WP's tests.
  - Every hunk whose revert leaves the tests green gets a new test that is red on the reverted code.
  - Record the results as a table (hunk → test that catches it) in the commit body.
- **T-8.3.7 Migration test.** `tests/storage/migrations.test.ts` applies every migration from 0001 to the latest on an empty database, and asserts the final schema matches `PRAGMA table_info` for each table the code reads.
- **T-8.3.8 Error normaliser.** Rewrite `test/error_normalizer.test.ts` using real-shaped Gemini and Groq error bodies, including `ErrorInfo` with a project number. Assert that no project number or provider header reaches the client.

### WP-8.4 Acceptance suite (`test/acceptance/`, Workers pool, black box through `SELF.fetch` on the real hosts)

- **T-8.4.0** Create `test/acceptance/`.
  - Add it to the Workers vitest config.
  - `git mv` the existing `ac07_hkdf_isolation.test.ts` and `ac08_upstream_headers.test.ts` into it, renaming `ac08` to `ac08_error_normalizer.test.ts`.
- **T-8.4.1 to T-8.4.15 (except T-8.4.13).** One file per acceptance criterion, `acNN_<slug>.test.ts`, named as in V2 WP-8.4. AC-13 (the gate time budget) belongs to T-8.6.2.
  - Each file starts with a comment quoting the acceptance criterion.
  - Every test goes in through HTTP and asserts through HTTP or D1. No module-level calls.
  - An acceptance test that fails on current code is a `fix` task: keep the red-check entry, then fix the code.

### WP-8.5 Security regression suite (`test/integration/security/`)

Each file starts with a comment describing the original exploit (from `docs/INTENT_AUDIT.md`), and asserts that the exploit now fails.

- **T-8.5.1** `git mv` `test/security/*` (including `r2_error_leakage.test.ts`) into `test/integration/security/`. Convert any that use module calls to `SELF.fetch` where the finding is about HTTP.
- **T-8.5.2 S5**, as described in `INTENT_AUDIT.md`.
- **T-8.5.3 S8: OAuth state.** A forged, replayed or expired `kc_oauth` gets 400, and no session is created.
- **T-8.5.4 S10 / AU-11: the master key is not a credential.**
  - Sign `kc_pending` with `SESSION_SIGNING_KEY`. Accept the old `KC_MASTER_KEY` signature only until one cookie lifetime has passed after deploy, and leave a `TODO(remove after <date>)`.
  - Test: a `kc_pending` cookie signed with the master key after the cutoff is rejected.
- **T-8.5.5 S11: demo isolation.** The demo token cannot lease community keys, does not appear in economy stats, and cannot reach the admin or console routes.
- **T-8.5.6 S12: no credentials in query strings.**
  - Inbound: `?key=`, `?api_key=` and `?token=` are ignored and never authenticate.
  - Outbound: switch `forceErrorGcpProbe` in `src/ingress/probe.ts` from `?key=` to the `x-goog-api-key` header, so the key cannot end up in URL logs.

### WP-8.6 Gate and CI

- **T-8.6.1 `package.json`.**
  - `gate:fast` = typecheck + lint + unit tests + `check-no-sql-mocks` + `check-ui-literals` + `check-baselines`.
  - `gate` = `gate:fast` + workers tests + UI tests + `(cd ui && npm run check)` + `node scripts/reachability.mjs`.
- **T-8.6.2 `ci-dev.yml`.**
  - The `quality-gate` job runs `npm run gate` on pull requests and on pushes to `develop`.
  - A separate step times `gate:fast` (AC-13).
  - **STOP if over 10 s.** Report the measured time. The owner either revises D-14 or asks for the unit suite to be split. Do not change the budget yourself.
- **T-8.6.3 `deploy-prod.yml`.** Keep the D1 export step, and run `npm run gate` before migrations and deploy.
- **T-8.6.4 Coverage.**
  - Add `@vitest/coverage-v8` with thresholds of ≥ 90 % lines and ≥ 80 % branches for `src/router/leases`, `src/pool`, `src/quota`, `src/auth` and `src/worker/router/dashboard/keys`.
  - Upload the report as a CI artifact.
  - If the current numbers are below the thresholds, set each threshold to the current number. Then add a `T-8.6.4a` task listing the gaps, and do not lower the target.

### WP-8.7 Documentation truth and runbooks

- **T-8.7.1** `docs/ops/secret-rotation.md`, per V2 WP-8.7.
- **T-8.7.2** `docs/ops/admin-access.md`, which now uses `ADMIN_EMAILS`.
- **T-8.7.3** `docs/ops/deploy.md`.
  - Cover: `develop` deploys dev and `master` deploys production; export before migrate; the migrate-before-deploy window; the D-28 rollback floor; `wrangler tail` checks.
  - No `ROUTING_ENGINE`, no `legacy_route_hit`.
- **T-8.7.4** PRD section 1.2 status, set from the Phase D smoke record and not from the code. Apply the V2 PRD amendments (D-01, D-02/03, D-05, D-06, D-14, D-15).
- **T-8.7.5** `README.md`: endpoints on `api.key-col.axe08.tech/v1`, CU, providers, and the test badge from CI. No hand-written counts.
- **T-8.7.6** `CONTEXT.md` and `GEMINI.md` invariants.
  - Integer CU, host topology, identity rules, no SQL mocks.
  - Replace the "Non-blocking fallback comment" rule with rule 1 above.
  - Remove every "Fixed-Point Microdollars" line.
- **T-8.7.7** Delete `docs/data_contracts.go` and `docs/data_contracts.py`. Keep `.ts` only if it generates the zod contracts.
- **T-8.7.8** `docs/README.md`: an index labelling each document as normative or historical/generated.

## 6. Release gate (STOP: owner)

1. `npm run gate` passes in CI, and every count in `scripts/baselines.json` is 0.
2. All 15 acceptance tests and the security suite are green.
3. Phase D (V3: D.2 to D.4) passes again on dev with this build.
4. The owner merges to `master`, which triggers `deploy-prod.yml` (export, gate, migrate, deploy).

## 7. PROGRESS.md checklist (paste at the start of the phase)

```markdown
## Phase G — Guardrails
Plan: `docs/PHASE8_PLAN.md` (specs in `docs/REMEDIATION_PLAN_V3.md`)
### WP-G.1
- [ ] T-G.1.1 Forbid rules: swallows, promise swallows, type suppressions, skipped tests; wp.sh selftest
- [ ] T-G.1.2 finish: one commit per task, every task ticked
- [ ] T-G.1.3 Red log (.wp/red.log) required for feat/fix tasks
- [ ] T-G.1.4 Typecheck ops/
- [ ] T-G.1.5 scripts/check-baselines.mjs + baselines.json in gate:fast
### WP-G.2
- [ ] T-G.2.1 Operator steps for Phases 4–8; D-28 waiver notes under WP-7.5 / WP-7.6

## Phase D — Deploy and prove on dev (owner)
- [ ] D.1 Exports, HKDF counts, D-27 count, secrets, pending migrations
- [ ] D.2 Push to develop; CI deploy green
- [ ] D.3 Smoke checklist recorded in docs/specs/dev_smoke_<date>.md
- [ ] D.4 Midnight soak

## Phase F — Audit fixes
### WP-F.1
- [ ] T-F.1.1 Migration 0025_would_deny_hourly.sql
- [ ] T-F.1.2 Would-deny stats in D1; endpoint reads D1
### WP-F.2
- [ ] T-F.2.1 New tenant: lastResetDay = today on first load
### WP-F.3
- [ ] T-F.3.1 coordinator_do.ts swallows
- [ ] T-F.3.2 tenant_do.ts swallows
- [ ] T-F.3.3 enforcement.ts swallow
- [ ] T-F.3.4 pool_routes.ts swallows
- [ ] T-F.3.5 control.ts swallow
- [ ] T-F.3.6 admin_handler.ts swallow
- [ ] T-F.3.7 abuse_routes.ts swallows
- [ ] T-F.3.8 keys/ops.ts swallows
- [ ] T-F.3.9 get_keys.ts swallow + empty catch
### WP-F.4
- [ ] T-F.4.1 HKDF script disposition (after D.1)

## Phase 8 — Hardening and release
### WP-8.1
- [ ] T-8.1.1 ESLint flat config (root + ui), npm run lint
- [ ] T-8.1.2 kc/catch-must-handle rule + RuleTester tests
- [ ] T-8.1.3 console.* → logger in 6 files; OAuth errors sanitized
- [ ] T-8.1.4 Malformed JSON → 400 invalid_json on every route
- [ ] T-8.1.5 Lint rules to error; lint in gate:fast; baselines swallows/console → 0
### WP-8.2
- [ ] T-8.2.1 Zero any in src
- [ ] T-8.2.2 Zero any in ui/src
- [ ] T-8.2.3 Zero type suppressions in src and ui/src
- [ ] T-8.2.4 ADMIN_EMAILS var; no hard-coded emails
- [ ] T-8.2.5 Firebase config via env or archived
- [ ] T-8.2.6 npm only (delete pnpm files)
- [ ] T-8.2.7 Baselines any / ts_suppressions → 0
### WP-8.3
- [ ] T-8.3.1 Inventory of open Appendix B rows (adds T-8.3.1a…)
- [ ] T-8.3.2 Type suppressions in tests → runtime / expectTypeOf
- [ ] T-8.3.3 Revert check WP-4.6
- [ ] T-8.3.4 Revert check WP-6.1
- [ ] T-8.3.5 Revert check WP-6.2
- [ ] T-8.3.6 Revert check WP-6.4
- [ ] T-8.3.7 Migration test applies all migrations
- [ ] T-8.3.8 Error normalizer with real-shaped bodies
### WP-8.4
- [ ] T-8.4.0 test/acceptance/ + move ac07, ac08
- [ ] T-8.4.1 AC-01 self-key priority
- [ ] T-8.4.2 AC-02 debt ledger
- [ ] T-8.4.3 AC-03 quota jail
- [ ] T-8.4.4 AC-04 project hash Sybil
- [ ] T-8.4.5 AC-05 observation
- [ ] T-8.4.6 AC-06 tombstone
- [ ] T-8.4.7 AC-07 HKDF isolation (moved, black-box)
- [ ] T-8.4.8 AC-08 error normalizer (moved, black-box)
- [ ] T-8.4.9 AC-09 takedown timing
- [ ] T-8.4.10 AC-10 hero/parasite
- [ ] T-8.4.11 AC-11 eviction durability
- [ ] T-8.4.12 AC-12 midnight jitter
- [ ] T-8.4.14 AC-14 cold-start share cap
- [ ] T-8.4.15 AC-15 consent 422
### WP-8.5
- [ ] T-8.5.1 Consolidate security tests
- [ ] T-8.5.2 S5
- [ ] T-8.5.3 S8 OAuth state
- [ ] T-8.5.4 S10 kc_pending signed with SESSION_SIGNING_KEY
- [ ] T-8.5.5 S11 demo isolation
- [ ] T-8.5.6 S12 no query-string credentials (inbound + probe)
### WP-8.6
- [ ] T-8.6.1 gate / gate:fast scripts
- [ ] T-8.6.2 ci-dev full gate + AC-13 timing
- [ ] T-8.6.3 deploy-prod gate before migrate
- [ ] T-8.6.4 Coverage thresholds
### WP-8.7
- [ ] T-8.7.1 secret-rotation.md
- [ ] T-8.7.2 admin-access.md
- [ ] T-8.7.3 deploy.md
- [ ] T-8.7.4 PRD 1.2 status + amendments
- [ ] T-8.7.5 README
- [ ] T-8.7.6 CONTEXT.md / GEMINI.md invariants
- [ ] T-8.7.7 Delete data_contracts.go / .py
- [ ] T-8.7.8 docs/README.md index
```
