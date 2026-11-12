# HIVE Plan: Event-Driven Zero-Idle-Cost Gateway & P1/P2 Technical Debt Remediation

> **Framework:** HIVE v3.0 (Hierarchical Implementation & Verification Engine)  
> **Base Branch:** `docs/intent-audit-and-remediation`  
> **Target Branch:** `hive/event-driven-and-tech-debt`  
> **Execution Invariants:** TypeScript strict mode (0 errors), `make gate` < 10s, zero plaintext keys, zero D1 polling load during idle tabs.  
> **Plan Version:** 3.0.0

---

## 1. Decisions log

| Decision | Summary | Impacted Subsystems | Owner |
|---|---|---|---|
| D-10 | **Eliminate Autonomous Background Polling** | `ui/src/App.svelte`, `ui/src/lib/MetricCards.svelte`, `ui/src/lib/notifications_feed.ts` | Frontend Lead |
| D-11 | **Client-Side SWR In-Browser Cache** | `ui/src/lib/cache/browser_cache.ts` | Frontend Lead |
| D-12 | **Dedicated Manual Refresh Controls for Stats & Logs** | `ui/src/lib/MetricCards.svelte`, `ui/src/lib/DashboardView.svelte`, `ui/src/lib/TelemetryLogs.svelte` | UI Designer |
| D-13 | **Non-Blocking Hot Path via `ctx.waitUntil`** | `src/worker/router/chat/non_streaming.ts` | Systems Engineer |
| D-14 | **7-Day Temporal Ceiling on Live Analytics Rollup** | `src/worker/router/dashboard/metrics_routes.ts` | Database Architect |
| D-15 | **Cold Shard Provider Name Extraction** | `src/pool/coordinator_do.ts` | Distributed Systems |
| D-16 | **Inter-Package Dependency Cycle Decoupling** | `src/proxy`, `src/router`, `src/contracts` | Core Scribe |

---

## 2. Foundations

### 2.1 Event-Driven Lifecycle Matrix & Client SWR Caching
1. **Initial Mount:** On startup, the UI calls `loadData()` once. Resulting records (`keys`, `stats`, `logs`) are stored in `browser_cache.ts` with a timestamp and a 5-minute freshness TTL.
2. **Tab Switching:** Navigating between *Dashboard*, *Workbench*, *Pool*, and *Analytics* reads from the client SWR cache without dispatching HTTP requests to the worker edge.
3. **Window Focus Revalidation:** When `window` receives a `focus` event, if `Date.now() - lastLoadedAt > 300_000` (5 minutes), a background refresh is triggered.
4. **Post-Action Mutation Invalidation:** Key creation, deletion, rotation, testing, and playground completions invalidate their respective cache entries and trigger a fresh fetch.
5. **Zero Autonomous Network Intervals:** All `setInterval` timers performing network `fetch` calls are banned.

### 2.2 Dedicated Refresh Controls
- The **Stats** overview provides an explicit manual refresh button with `data-testid="refresh-stats-btn"` which queries `GET /api/stats` and updates the cards with a visual loading indicator.
- The **Telemetry Logs** table provides an explicit manual refresh button beside the search bar with `data-testid="refresh-logs-btn"` which queries `GET /api/logs`.

### 2.3 Non-Blocking Proxy Hot-Path
In accordance with the Key Collective AI Constitution (Invariant #5: Non-Blocking Telemetry), `postWork()` in `non_streaming.ts` must execute inside `ctx.waitUntil(workPromise)`. Under production workloads (`KC_ENV !== "test"`), the response to the client must never await D1 disk writes.

---

## Phase 1 — Anti-Polling & In-Browser SWR Cache

### WP-1.1 Eliminate Background setInterval Polling Loops
**Depends on:** none  
**Findings:** Idle browser tabs generate ~115,200 HTTP requests and over 200,000 D1 SQL executions per day due to uncoordinated 3s and 5s polling timers.  
**Problem.** `App.svelte` runs a 3-second `setInterval` polling `/api/keys`, `/api/logs`, and `/api/stats`. `MetricCards.svelte` runs a duplicate 5-second `setInterval` polling `/api/stats`. `notifications_feed.ts` runs a 30-second `setInterval` polling `/api/notifications`.  
**Implementation**
1. In `ui/src/App.svelte`, remove `pollIntervalId = setInterval(...)` and `updatePollInterval()`. Retain `loadData()` for event-driven invocations.
2. In `ui/src/lib/MetricCards.svelte`, delete the internal `setInterval(fetchStats, 5000)` and `$effect` polling loop.
3. In `ui/src/lib/notifications_feed.ts`, delete `const timer = setInterval(() => void refresh(), intervalMs);`. Update `start()` to fetch once on session initialization without scheduling repeating timers.
**Tests** (`ui/src/lib/MetricCards.dom.test.ts`, `ui/src/App.dom.test.ts`)
- Renders `MetricCards` in JSDOM; advances fake timers by 60 seconds; verifies `globalThis.fetch` is called exactly 0 times after mount.
- Mounts `App.svelte` in JSDOM; advances fake timers by 60 seconds; verifies `globalThis.fetch` is called exactly 0 times while idle.
**Done when** `grep -rn "setInterval" ui/src/` contains zero network-fetching timers and all UI tests pass.

### WP-1.2 In-Browser SWR Cache Engine
**Depends on:** none  
**Findings:** Tab switching causes duplicate HTTP requests even when the underlying data has not changed.  
**Problem.** Switching between Dashboard, Workbench, Pool, and Analytics tabs causes UI flash and triggers repetitive D1 queries.  
**Implementation**
1. Create `ui/src/lib/cache/browser_cache.ts` exporting:
   - `fetchWithCache<T>(key: string, fetcher: () => Promise<T>, options?: { ttlMs?: number; force?: boolean }): Promise<T>`
   - `invalidateCache(keyPrefix?: string): void`
   - `DEFAULT_CACHE_TTL_MS = 300_000` (5 minutes)
2. Wire `browser_cache.ts` into `ui/src/lib/api.ts` (or `App.svelte`) so that calls to `api.getKeys()`, `api.getStats()`, and `api.getLogs()` read from cache unless bypassed with `force: true` or marked dirty.
**Tests** (`ui/src/lib/cache/browser_cache.test.ts`)
- `fetchWithCache` caches initial fetcher output in memory.
- Sequential calls within TTL return cached data without re-executing fetcher.
- `invalidateCache('keys')` marks matching entries dirty, forcing a re-fetch on the next invocation.
- `force: true` bypasses cache and updates stored timestamp.
**Done when** `ui/src/lib/cache/browser_cache.test.ts` passes with 100% coverage.

### WP-1.3 Event-Driven Triggers & Dedicated Refresh Controls
**Depends on:** WP-1.1, WP-1.2  
**Findings:** Users require on-demand data refreshes without waiting for page reloads or relying on aggressive polling.  
**Problem.** Developers need immediate feedback when testing keys, running playground prompts, or monitoring quota usage.  
**Implementation**
1. In `ui/src/lib/MetricCards.svelte`, add a manual refresh icon button with `data-testid="refresh-stats-btn"` that calls `fetchStats()` on click and renders an active spin animation while fetching.
2. In `ui/src/lib/DashboardView.svelte`, add a manual refresh button in the header calling `onRefresh`.
3. In `ui/src/lib/TelemetryLogs.svelte`, add a manual refresh button with `data-testid="refresh-logs-btn"` calling `onRefresh`.
4. In `ui/src/App.svelte`, register a `focus` event listener on `window`: if `Date.now() - lastLoadedAt > 300_000`, trigger `loadData()`.
5. In `ui/src/App.svelte`, ensure `handleAddKey`, `handleDeleteKey`, `handleRotateKey`, `handleTestKey`, and `<Playground onRefreshMetrics={loadData} />` invalidate the SWR cache and refresh state immediately upon completion.
**Tests** (`ui/src/lib/MetricCards.dom.test.ts`, `ui/src/App.dom.test.ts`)
- Clicking `data-testid="refresh-stats-btn"` executes fetch to `/api/stats` and updates the rendered metrics.
- Clicking `data-testid="refresh-logs-btn"` executes fetch to `/api/logs`.
- Dispatching `window.dispatchEvent(new Event('focus'))` when cache is older than 5 minutes triggers `loadData()`.
- Dispatching `window.dispatchEvent(new Event('focus'))` when cache is fresh (< 5 minutes) triggers 0 network calls.
**Done when** Manual refresh buttons and focus listeners trigger targeted network fetches and pass all DOM tests.

### Phase 1 gate
- `cd ui && npx vitest run` passes with 0 failures across all 18+ UI test suites.
- Idle browser tabs generate 0 HTTP requests over arbitrary time windows.
- Manual refresh controls for `/api/stats` and `/api/logs` are fully responsive.

---

## Phase 2 — Priority 1 (P1) Hot-Path & Query Performance

### WP-2.1 Non-Blocking Proxy Hot-Path in `non_streaming.ts`
**Depends on:** none  
**Findings:** `non_streaming.ts:136` explicitly awaits `workPromise`, forcing every chat completion to block on D1 SQLite commits.  
**Problem.** Violates AI Constitution Invariant #5 (Non-Blocking Telemetry) and introduces 15ms–60ms of latency per request.  
**Implementation**
1. In `src/worker/router/chat/non_streaming.ts`, replace lines 132-136:
   ```typescript
   const workPromise = postWork();
   if (ctx && typeof ctx.waitUntil === "function") {
     ctx.waitUntil(workPromise);
   }
   if (env?.KC_ENV === "test") {
     await workPromise;
   }
   ```
2. Ensure that in production (`KC_ENV !== "test"`), `postWork()` runs exclusively in the background via `ctx.waitUntil`.
**Tests** (`test/unit/worker/non_blocking_hotpath.test.ts`)
- When `KC_ENV === "production"`, `handleChatCompletionNonStreaming` returns HTTP 200 before `workPromise` resolves.
- `ctx.waitUntil` is passed the background `postWork()` promise.
- When `KC_ENV === "test"`, `workPromise` is awaited synchronously to preserve integration test assertions.
**Done when** Non-streaming chat responses return immediately without awaiting D1 writes in production.

### WP-2.2 Bounded 7-Day Live Analytics Rollup Query
**Depends on:** none  
**Findings:** `src/worker/router/dashboard/metrics_routes.ts:314-325` scans the entire lifetime of `cost_ledger` when `daily_cu_rollup` is pending.  
**Problem.** As the table grows to tens of thousands of rows, this fallback triggers unbounded full-table scans.  
**Implementation**
1. In `src/worker/router/dashboard/metrics_routes.ts`, update the SQL query for `liveRes` in `handleGetUsage`:
   ```sql
   SELECT
     date(created_at) AS day,
     CASE WHEN provider = 'google' THEN 'gemini' ELSE provider END AS provider,
     model_id AS model,
     COUNT(*) AS requests,
     SUM(prompt_tokens + completion_tokens + reasoning_tokens) AS tokens,
     COALESCE(SUM(cu), 0) AS cu
   FROM cost_ledger
   WHERE tenant_id = ?
     AND created_at >= datetime('now', '-7 days')
   GROUP BY day, provider, model_id
   ORDER BY day DESC, cu DESC
   LIMIT 100
   ```
**Tests** (`test/unit/worker/metrics_rollup_query.test.ts`)
- Mock D1 prepare call; verify generated SQL contains `created_at >= datetime('now', '-7 days')`.
- Insert records older than 8 days; verify they are excluded from the live fallback aggregation.
**Done when** Live usage queries are strictly bounded to the 7-day temporal window.

### Phase 2 gate
- `npx vitest run test/unit/worker/non_blocking_hotpath.test.ts test/unit/worker/metrics_rollup_query.test.ts` passes.
- Hot-path non-streaming latency benchmarks show zero D1 await time in non-test mode.

---

## Phase 3 — Priority 2 (P2) Architectural Remediation & Decoupling

### WP-3.1 Shard Provider Extraction in `PoolCoordinatorDO` Constructor
**Depends on:** none  
**Findings:** Alarms running on cold `PoolCoordinatorDO` shards fail to reconcile D1 community keys because `this.getMeta("provider")` is undefined.  
**Problem.** When an idle coordinator wakes purely on a 60-second timer before receiving any RPC invocation, reconciliation is skipped.  
**Implementation**
1. In `src/pool/coordinator_do.ts`, update the constructor:
   ```typescript
   const idName = (this.ctx.id as { name?: string }).name;
   if (idName?.startsWith("pool:")) {
     const canonicalProvider = canonicalCoordinatorProvider(idName.slice(5));
     this.setMeta("provider", canonicalProvider);
   }
   ```
**Tests** (`test/unit/pool/coordinator_cold_init.test.ts`)
- Instantiate `PoolCoordinatorDO` with `idFromName("pool:google")`.
- Assert `this.getMeta("provider") === "google"` immediately upon instantiation.
- Trigger `alarm()` on cold DO; verify D1 reconciliation executes successfully.
**Done when** Cold coordinator DOs immediately identify their provider shard from `ctx.id.name`.

### WP-3.2 Inter-Package Circular Dependency Decoupling (`proxy <-> router <-> worker`)
**Depends on:** none  
**Findings:** Layer inversion where transport client `src/proxy` imports `TokenUsage` from `src/router` and `normalizeUpstreamResponse` from `src/worker`.  
**Problem.** Prevents clean packaging, breaks tree-shaking, and risks runtime initialization TDZ errors.  
**Implementation**
1. Move `TokenUsage` from `src/router/registry` to `src/contracts/telemetry.ts`.
2. Extract `normalizeUpstreamResponse` from `src/worker/error_normalizer.ts` into `src/proxy/upstream/normalizer.ts`.
3. Update imports in `src/proxy/upstream/client.ts` and `src/proxy/sse/types.ts` to reference `contracts/` and local `proxy/` paths only.
**Tests** (`test/unit/proxy/normalizer.test.ts`)
- Verify `normalizeUpstreamResponse` correctly sanitizes upstream error responses and secret keys.
- Run `npm run typecheck` to verify zero type errors across all packages.
**Done when** `src/proxy` has zero imports pointing to `src/worker` or `src/router`.

### WP-3.3 Intra-Package 9-File Gateway Loop Resolution
**Depends on:** WP-3.2  
**Findings:** 9 files in `src/worker/` form a cyclic dependency chain between gateway subdomains, types, router dispatcher, and admin handlers.  
**Problem.** `gateway/types.ts` imports `RouterHandler` from `router/index.ts`, which imports from `gateway/admin_handler.ts`.  
**Implementation**
1. In `src/worker/gateway/types.ts`, replace the concrete `RouterHandler` import with a decoupled generic handler function signature:
   ```typescript
   export type RouteDispatcherFn = (request: Request, env: WorkerEnv, ctx?: ExecutionContext) => Promise<Response>;
   ```
2. Update references in `src/worker/gateway/subdomain.ts` and `src/worker/gateway/admin_handler.ts` to use `RouteDispatcherFn`.
**Tests** (`test/unit/worker/gateway_routing.test.ts`)
- Run `npm run typecheck`.
- Execute full worker gateway routing unit tests.
**Done when** The circular import chain between `src/worker/gateway` and `src/worker/router` is completely broken.

### Phase 3 gate
- `npx vitest run test/unit/pool test/unit/proxy test/unit/worker` passes.
- `npm run typecheck` produces 0 errors.

---

## Phase 4 — Automated Testing Suites & Full Gate Certification

### WP-4.1 Automated UI & DOM Test Harness Integration
**Depends on:** WP-1.1, WP-1.2, WP-1.3  
**Findings:** UI tests historically verified static SSR markup strings without checking DOM click handlers and lifecycle timers.  
**Implementation**
1. Build comprehensive test suites in:
   - `ui/src/lib/cache/browser_cache.test.ts`
   - `ui/src/lib/MetricCards.dom.test.ts`
   - `ui/src/App.dom.test.ts`
2. Validate zero timers running in background, verify manual refresh button dispatches, and verify focus listener revalidation.
**Tests** (`cd ui && npx vitest run`)
- All 18+ UI test suites execute and pass in < 3s.
**Done when** 100% of UI test files pass in JSDOM.

### WP-4.2 Backend Unit & Gate Certification
**Depends on:** WP-2.1, WP-2.2, WP-3.1, WP-3.2, WP-3.3  
**Findings:** All changes across workers, durable objects, and proxy must satisfy the strict repository gate.  
**Implementation**
1. Implement and link:
   - `test/unit/worker/non_blocking_hotpath.test.ts`
   - `test/unit/worker/metrics_rollup_query.test.ts`
   - `test/unit/pool/coordinator_cold_init.test.ts`
2. Execute full repository gate: `make gate`.
**Tests** (`make gate`)
- Strict TypeScript check (`tsc --noEmit`): 0 errors.
- Root vitest suite: 1,050+ tests passing.
- UI vitest suite: 105+ tests passing.
- Total execution time: < 10 seconds.
**Done when** `make gate` outputs: `🎉 [GATE PASSED] TypeScript typecheck and tests satisfied in <10s.`

### Phase 4 gate
- Full regression suite green.
- Verified zero unhandled exceptions, zero D1 write delays in proxy hot path, and zero idle polling network traffic.
