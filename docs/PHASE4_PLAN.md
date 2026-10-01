# Phase 4 execution plan — Leases behind a switch

For: the agent (Antigravity / any IDE) implementing Phase 4 of `docs/REMEDIATION_PLAN_V2.md`.
Source of truth for *what* to build: the plan's **Phase 4** section and **section 2.4** (coordinator,
lease sequence). This file says *how* to work and in *which order*. Progress lives in
`docs/PROGRESS.md` (Phase 4 checklist); tick a box in the same commit that finishes the task.

---

## 1. Protocol (same as Phase 3)

One work package (WP) at a time, on its own branch, one commit per task, `--no-ff` merge.

```
scripts/wp.sh start WP-4.1            # branch wp/WP-4.1 from docs/intent-audit-and-remediation
# for each task:
#   1. write the test(s) first
scripts/wp.sh red   <test files>      # must FAIL before the fix (a pure import error is not a red check:
                                      #   create the module with a stub first, then red-check the behaviour)
#   2. implement
scripts/wp.sh check <test files>      # forbid rules + typecheck + those tests
#   3. before committing, if the change touches shared code, run both full suites:
#      npx vitest run && npx vitest run -c vitest.workers.config.ts
git commit -m "feat(WP-4.1): <what> (T-4.1.n)"   # body: why, deviations; end with the Co-Authored-By line
scripts/wp.sh finish WP-4.1           # full gate (node + workers + ui + ui-dom), then merge --no-ff
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

## 2. Rules learned in Phases 1–3 (read before writing tests)

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
  per-test `scenario` variable (see `test/integration/keys/submit.test.ts`, `identity/github_link.test.ts`).
- jose caches Google's JWKS across files: use `test/helpers/google_jwt.ts` (shared key pair).
- Default test clock: `Date.now()` in the Worker can be shifted by other suites; compute expiries in SQL
  (`datetime('now', ?)`) when comparing against SQLite time, and use the WP-1.1 test clock
  (`setClockForTest`, `test/helpers/clock.ts`) for breaker/cooldown/alarm timing.
- An authenticated `/v1` call that never reaches a provider: `POST /v1/chat/completions` with body
  `"{not json"` — auth and quota run, then 400.
- Users created by raw `INSERT INTO users` default to `registration_status = 'PENDING_CONSENT'` and are
  blocked from console `/api/*` (403). Use `createUser()` (ACTIVE + google identity) or set `'ACTIVE'`.

**Code rules**
- No empty `catch {}`, no `any` in `src/` (forbid rules check added lines only).
- Migrations run **before** the new Worker deploys and must be safe for the running release (D-26):
  expand only (add tables/columns/indexes, idempotent updates); drops wait for a later contract migration.
  Next number: **0017**. Add a case to `test/integration/migrations.test.ts` that applies everything
  before it, seeds rows, applies the new one, and asserts.
- Console `/api/*` mutations need a session cookie **and** `x-kc-csrf`; responses for new errors use
  `{ error: "<code>" }` or the route's existing `{ error: { message, code } }` shape (the UI client reads both).
- `api.*` (`/v1`) ignores cookies; auth is the bearer API key. Errors go through `formatRouterError`
  (domain errors only show their message; others become "Internal error").

**UI tests**
- Server-render tests: `*.test.ts` under `ui/src` (svelte/server). Interactive tests: `*.dom.test.ts`
  (client build + happy-dom, `ui/vitest.dom.config.ts`, msw for HTTP). `npm run test:ui` runs both.
- Never put the string `x-tenant-id` in `ui/src` (forbid rule + phase gate grep), not even in a test.

## 3. Phase 4 overview

Release R4. **User-visible change: none while `ROUTING_ENGINE=legacy`** (production default). `dev` and
`test` run `leases`. Both engines must stay green until WP-7.5 deletes the legacy path.

Order: **WP-4.1 first** (everything depends on it), then 4.2 → 4.3 → 4.4 → 4.5 → 4.6
(4.2–4.6 are independent of each other; this order minimises conflicts in the router and KeyPoolDO).

Read first: plan section 2.4 (coordinator data model, lease sequence, RPC list), `src/pool/coordinator_do.ts`,
`src/durable_objects/key_pool/key_pool_do.ts` (note `reconcileSyncPending` and the D-21 lending filter added
in Phase 3), `src/router/cascade_router.ts`, `src/worker/router/chat/{stream,non_streaming,handler}.ts`,
`src/worker/router/core/key_resolver.ts`, `src/quota/tenant/tenant_do.ts`.

## 4. Tasks

### WP-4.1 Coordinator key registry and leases (largest; split as below)

- **T-4.1.1 Switch.** `ROUTING_ENGINE` var: `wrangler.jsonc` production `legacy`, dev `leases`;
  `vitest.workers.config.ts` binding `leases`, plus a way to run the routing suites with `legacy`
  (e.g. a second workers config or an env override read by the router). Router reads it once per request.
  Test: with `legacy`, existing routing tests pass and the coordinator is never asked for a lease.
- **T-4.1.2 Coordinator rewrite.** SQLite tables per 2.4; typed RPC `lease / settle / upsertKey / removeKey /
  setStatus / stats / reconcile / setOwnerDebt`; 60 s alarm; 5 min D1 reconcile. Register only keys whose
  owner has `communityPool` (reuse the SQL predicate from `KeyPoolDO` D-21 query / `src/auth/rights.ts`).
  Delete the HTTP `fetch` endpoints (`/coordinator/health`, `/report-volume`, `/update-provider`,
  `/brake-status/*`) and update callers (`pool_routes.ts` health push, `chat/handler.ts` brake check).
  Tests in `test/do/coordinator.test.ts`: global RPM across tenants, concurrency (50 parallel leases vs
  rpm_limit 10 → exactly 10), idempotent `settle`, revocation visible on the next lease, D-21 exclusion.
- **T-4.1.3 KeyPoolDO private lease API.** `leasePrivate(provider, estimateCu)`, `settle(leaseId, outcome)`,
  private keys loaded from D1 on first access and on `reconcile()` (call it after key add/delete/pool-mode
  in `keys/*.ts`). Breaker/limiter apply to private keys only. Keep the legacy community load for `legacy`.
- **T-4.1.4 Lease orchestrator** `src/router/leases/orchestrator.ts`: `acquire(provider, ctx)` →
  `{ leaseId, keyId, source: private | own_community | borrowed, ownerTenantId } | null`, `settle`.
  Order: private → own community → borrowed. Priority computed at lease time (debt boost, PARASITE, HERO,
  headroom). TenantQuotaDO pushes owner debt via `coordinator.setOwnerDebt` (0 until WP-5.3).
- **T-4.1.5 CascadeRouter on leases.** With `leases`, `executeCascadeRouting` takes a `LeaseProvider` and
  never calls `keyPool.getKey()`; lease per candidate model, dispatch, settle. `auto` for a Groq-only
  tenant leases Groq directly (moved from WP-1.4).
- **T-4.1.6 Lease integration tests** `test/integration/commons/leases.test.ts`: the plan's list (order via
  `cost_ledger.borrowed` / `lender_tenant_id`, global limit, revocation, idempotency, concurrency, Groq-only
  auto, legacy untouched, D-21).
- **T-4.1.7 Legacy tests.** Migrate/delete per Appendix B list in the plan (cascade_router, coordinator_wiring,
  coordinator_do, key_pool spec/tests, key_selector, circuit_breaker → Workers pool, `settle` outcomes).

### WP-4.2 Account usage to the key

- **T-4.2.1** Both chat handlers pass `lease.keyId` to `settle` and the ledger; delete the separate
  `recordUsage` calls. Ledger repository rejects `key_id` not matching `^key_`.
  Tests: streaming and non-streaming write `cost_ledger.key_id` = leased key id; the key's minute counter
  increments by exactly 1 per request.

### WP-4.3 Upstream status handling, quarantine, notifications

- **T-4.3.1** `src/proxy/upstream/classify.ts` (table in the plan) + unit tests per row (Node; pure).
- **T-4.3.2** Outcome flows through `settle` to KeyPoolDO/coordinator; D1 `status`/`status_changed_at`
  updated for `key_invalid`, `rpd_exhausted`, recoveries. Breaker: open on 5th consecutive 5xx, half-open
  after 60 s test clock. A 400 returns 400 (sanitised) with no fallback. Delete `recordResult` /
  `recordStatusCode` from `KeyPoolContract`.
- **T-4.3.3** Migration `0017_notifications.sql` (+ migration test). `GET /api/notifications?since=<ms>`
  (tenant-scoped, ms) and `POST /api/notifications/:id/read`. Owner notification on abuse takedown and on
  `key_invalid` (PRD Flow G text with key label and provider). Also move the D-21 "Link GitHub" notice
  (currently synthesised in `GET /api/session`) into this table if straightforward; otherwise leave it.

### WP-4.4 Strict key decryption

- **T-4.4.1** `resolveLeasedKey(lease)` replaces `core/key_resolver.ts`: row by `lease.keyId`, assert
  `row.tenant_id === lease.ownerTenantId`, decrypt with that tenant's subkey only; lazy HKDF migration
  (`hkdf_migrated`). Failure → `KeyDecryptionError`, key QUARANTINED, never returned as a credential.
  Delete the raw-key fast path and caller/`default` fallbacks. Cache keyed by key id + nonce, TTL 5 min,
  `evict(keyId)` replaces the global `clearDecryptedKeyCache()` (callers in `keys/ops.ts`).
- **T-4.4.2** `ops/migrate_keys_hkdf.ts` bulk migration. Tests: AC-07 cross-tenant → error + quarantine +
  upstream never called; corrupted ciphertext → quarantine; legacy row re-encrypted once.
  Migrate `src/worker/router/core/key_resolver.test.ts`.

### WP-4.5 Demo pool isolation

- **T-4.5.1** Reserve `sys_operator` (move `default` rows there — data move is an operator step; write the
  SQL as a migration only if it is safe/idempotent) and authenticate demo tokens as `sys_demo`. For
  `sys_demo` the orchestrator leases only `KeyPoolDO("sys_operator")` private keys, never the coordinator;
  demo traffic excluded from multiplier, debt and pool telemetry. Note: `/api/demo/token` still serves the
  demo token; `/api/playground/token` is the session-scoped key (WP-3.10) — keep them separate.
  Tests: community keys present + empty operator pool → 503 `demo_unavailable`, coordinator untouched;
  operator key present → served, no `borrowed` ledger row. Migrate `src/auth/demo/demo.test.ts`.

### WP-4.6 Admin circuit override and kill switch

- **T-4.6.1** Coordinator `setProviderOverride(TRIPPED|NORMAL, until?, reason, adminUserId)`; while
  TRIPPED, leases skip that provider; KeyPoolDO honours the pushed flag. Visible in `/api/admin/providers`.
- **T-4.6.2** Kill switch: coordinator instance `"control"` storing `{ maintenance, reason, since }`;
  ApiHost checks with a 10 s isolate cache → 503 `{ error: { code: "maintenance" } }`, `Retry-After: 60`;
  console `/api/*` unaffected. Delete `MIDNIGHT_FREEZE` handling (`dispatcher.ts`).
- **T-4.6.3** Both write `admin_audit_logs` and return stored state. Replace the echo tests in
  `tests/admin/admin_router.test.ts` (admin via `createSession(user, { kind: "admin" })` + cookie
  `kc_admin_session`, `role: "admin"`, email in `ADMIN_EMAILS`, host `admin.test`).

## 5. Phase 4 gate (before asking the human to sign off)

- `npm run gate` green, and the Workers routing suites also green with `ROUTING_ENGINE=legacy`.
- AC-01 (lease order) and AC-07 (HKDF isolation) pass on `leases`.
- Every Phase 4 box in `docs/PROGRESS.md` ticked; deviations listed there.
- Human: 48 h staging soak on `leases` (`scripts/soak/commons.mjs`, 5 synthetic tenants) — not the agent's job.

## 6. Context from Phase 3 that Phase 4 touches

- `KeyPoolDO.ensureLoaded` → `reconcileSyncPending()` pulls `sync_pending=1` keys; keep that working
  (or fold it into the new `reconcile()`).
- `KeyPoolDO` D1 load only lends another tenant's COMMUNITY key when the owner holds communityPool (D-21);
  the coordinator must apply the same rule.
- `ApiKeyRepository` (`src/storage/repositories/api_keys/repository.ts`) is the place for new `api_keys`
  SQL (status updates on settle, quarantine).
- `checkProofOfLife` (`src/ingress/probe.ts`) is the shared upstream probe; nightly canary re-checks
  (WP-4.3 table) can reuse it.
- Project sub-caps: `AuthenticatedContext.projectId` + TenantQuotaDO `projectMaxSubCap` (WP-3.7) —
  leases must not bypass the quota DO.
