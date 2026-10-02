# Phase 6 execution plan — Frontend truth; stop using microdollars

For: the agent (Antigravity / any IDE) implementing Phase 6 of `docs/REMEDIATION_PLAN_V2.md`.
Source of truth for *what* to build: the plan's **Phase 6** section, **section 4** (Information Architecture), and **section 2.2** (CU formula). This file specifies *how* to work, the detailed specifications for every task, and *in which order*.
Progress is tracked in `docs/PROGRESS.md` (Phase 6 checklist); tick a box in the same commit that finishes each task.

---

## 1. Protocol

One work package (WP) at a time, on its own branch, one commit per task, `--no-ff` merge.

```bash
scripts/wp.sh start WP-6.x            # branch wp/WP-6.x from docs/intent-audit-and-remediation
# for each task:
#   1. write the test(s) first
scripts/wp.sh red   <test files>      # must FAIL before the fix
#   2. implement
scripts/wp.sh check <test files>      # forbid rules + typecheck + those tests
#   3. before committing:
git commit -m "feat(WP-6.x): <what> (T-6.x.n)"
scripts/wp.sh finish WP-6.x           # full gate (node + workers + ui + ui-dom), then merge --no-ff
```

- **Commit messages**: `type(WP-x.y): summary (T-x.y.z)`.
- **Granularity**: one task per commit.
- **Never push or deploy**: user handles remote pushes.
- **Strict Quality Invariants**:
  - Zero `any` in new code.
  - No empty catch blocks.
  - No hand-rolled D1 mock object literals (`prepare: (`).
  - No client-chosen `x-tenant-id` header from UI.
  - Integer Credit Units: all capacity accounting is `bigint` CU; no floating point; no currency.

---

## 2. Invariants & Phase Boundaries

1. **No new migrations in Phase 6**: All schema migrations required for CU, standing, and identity were delivered in Phases 1–5 (`0001` through `0022`).
2. **Phase 7 Boundary Preparation (WP-6.5)**:
   - Migration `0023` in Phase 7 will drop `cost_microdollars`, `daily_spend_rollup`, `budget_microdollars`, `spent_microdollars`, and `community_debt_micro_cu`.
   - Before Phase 7 runs, Phase 6 (specifically WP-6.5) MUST cease ALL runtime reads and writes of these columns and tables.
3. **Frontend Truth**:
   - The UI must never render hardcoded or fabricated mock numbers (e.g. latency numbers, fake audits, synthetic token counts, placeholder names).
   - If server data is missing or loading, render designated skeleton or null states (`—`), or handle error boundaries explicitly.

---

## 3. Work Package Breakdown & Task Catalog

Execution order:
1. **WP-6.5** — Stop using microdollars (backend & contract cleanup)
2. **WP-6.1** — Remove invented data (audit & purge fake UI literals)
3. **WP-6.3** — Standing and debt widget (StandingCard with PRD states)
4. **WP-6.2** — Real admin panel (server-backed endpoints and management SPA)
5. **WP-6.4** — Information architecture per PRD section 4 (Tabs, Sub-tabs, Modals, Toasts)

---

### WP-6.5 Stop using microdollars

**Objective**: Eliminate all runtime dependencies on microdollar columns and currency math so Phase 7 migration `0023` can safely drop them without breaking changes.

#### T-6.5.1 Remove µ$ from cost ledger writes
- **Files**: `src/storage/repositories/cost_ledger/`, `src/storage/d1/ledger.ts`, `src/storage/d1/rollups.ts`.
- **Changes**: Omit `cost_microdollars` from `INSERT INTO cost_ledger`. Cease dual-writing to `daily_spend_rollup`; read and write strictly to `daily_cu_rollup`. Make `costMicrodollars` optional.
- **Verification**: `test/unit/credits/cost_ledger_no_microdollars.test.ts`.

#### T-6.5.2 Remove µ$ from auth tokens
- **Files**: `src/storage/repositories/auth_tokens/repository.ts`, `src/storage/repositories/auth_tokens/types.ts`.
- **Changes**: Stop inserting or updating `budget_microdollars` and `spent_microdollars`. Store and update `budget_cu` and `spent_cu`. Treat legacy `0n` budget as `null` (unlimited).
- **Verification**: `test/unit/credits/auth_tokens_no_microdollars.test.ts`, `tests/storage/repositories/authTokens.test.ts`.

#### T-6.5.3 Remove µ$ from contributor standing D1 sync
- **Files**: `src/quota/tenant/tenant_do.ts`, `src/quota/tenant/debt.ts`.
- **Changes**: When TenantQuotaDO synchronizes its standing to D1 `contributor_standing`, omit `community_debt_micro_cu` from the `UPDATE` / `INSERT` query. Sync only `community_debt_cu`, `contributed_cu_24h`, `multiplier_pct`, `jail_status`, etc.
- **Verification**: `test/integration/quota/contributor_standing_sync.test.ts`.

#### T-6.5.4 Delete calculateCost, financial.ts, x-kc-cost-microdollars header
- **Files**: `src/constants/financial.ts`, `src/worker/router/headers.ts`, `src/proxy/cost_calculator.ts`, `src/worker/router/chat/non_streaming.ts`, `src/worker/router/chat/stream.ts`.
- **Changes**: Delete `src/constants/financial.ts`. Remove `x-kc-cost-microdollars` from `applyKcHeaders` and response headers. Remove `calculateCost` invocations in hot path; route all calculations strictly through `calculateCu`.
- **Verification**: Unit and route tests verifying absence of `x-kc-cost-microdollars` and removal of `financial.ts`.

#### T-6.5.5 UI µ$ cleanup and grep guard
- **Files**: `ui/src/lib/admin/VelocityDials.svelte`, `ui/src/lib/SurveillanceTable.svelte`, `ui/src/lib/TenantSurveillance.svelte`, `ui/src/lib/AdminView.svelte`, `ui/src/lib/types.ts`.
- **Changes**: Replace all UI microdollar formatting and fields with Credit Units (`CU`). Ensure CI check confirms zero occurrences of `microdollar` or currency calculations in `src/` and `ui/src/`.
- **Verification**: `npm run test:ui` and grep checks.

#### T-6.5.6 Update documentation invariants
- **Files**: `GEMINI.md`, `CONTEXT.md`.
- **Changes**: Update Invariant #4 from "Fixed-Point Microdollars" to "Integer Credit Units: all capacity accounting is `bigint` CU; zero floating-point math; zero currency".
- **Verification**: Full check with `scripts/wp.sh finish WP-6.5`.

---

### WP-6.1 Remove invented data

**Objective**: Eradicate all mock numbers, hardcoded latency values, synthetic logs, and client-invented fallbacks across UI components.

#### T-6.1.1 Audit surviving invented-data components
- Run AST / regex analysis to identify all numeric literals and synthetic constants inside `{...}` template bindings in `ui/src/lib/**/*.svelte`.

#### T-6.1.2 AdminView.svelte — remove fake audit rows and syncDurationMs
- **Files**: `ui/src/lib/AdminView.svelte`.
- **Changes**: Wire audit list to `GET /api/admin/audit`. Remove client-generated synthetic audit history and fake `syncDurationMs`.

#### T-6.1.3 CircuitBreakerControls.svelte — remove hard-coded latencies
- **Files**: `ui/src/lib/CircuitBreakerControls.svelte`.
- **Changes**: Wire to `GET /api/admin/providers`. Display live p90 latencies from Coordinator stats. Remove hard-coded latency mock values (242/118/82/380) and unconfigured providers.

#### T-6.1.4 TelemetryLogs.svelte — remove invented model/token data
- **Files**: `ui/src/lib/TelemetryLogs.svelte`, `src/worker/router/dashboard/metrics_routes.ts`.
- **Changes**: Ensure server returns real `prompt_tokens`, `completion_tokens`, `cu`, `model`. UI displays `—` when data is absent. Remove `bytes_in/out = tokens * 4` synthetic calculation.

#### T-6.1.5 TopNavBar.svelte — remove hard-coded trust/tier/name
- **Files**: `ui/src/lib/TopNavBar.svelte`.
- **Changes**: Fetch identity and user tier from `GET /api/session`. Hide badges or show loading indicator when data is not yet resolved.

#### T-6.1.6 DebtLedgerWidget.svelte — remove standing fallback defaults
- **Files**: `ui/src/lib/DebtLedgerWidget.svelte`.
- **Changes**: Remove hardcoded fallback constants (1.5x / PRISTINE defaults). Render loading spinner or error alert if live standing is unavailable.

#### T-6.1.7 KeysTable.svelte — remove RPD/RPM fallbacks
- **Files**: `ui/src/lib/KeysTable.svelte`.
- **Changes**: Rely strictly on row data from `GET /api/keys`. Display `—` if limits are undefined; remove arbitrary 10,000 / 60 fallback defaults.

#### T-6.1.8 MetricCards.svelte — remove $1.00 budget ring, use CU
- **Files**: `ui/src/lib/MetricCards.svelte`.
- **Changes**: Display "CU used today / CU allowance today" fetched from `/api/stats`. Remove dollar-based budget ring.

#### T-6.1.9 Workbench.svelte — remove assignedRpm formula and hard-coded timestamp
- **Files**: `ui/src/lib/Workbench.svelte`.
- **Changes**: Read `projects.rpm_sub_cap` and live project RPM from TenantQuotaDO. Render real dates via `Date` formatting; remove static UTC mock timestamp.

#### T-6.1.10 CI guard scripts/check-ui-literals.mjs
- **Files**: `scripts/check-ui-literals.mjs`, `package.json`.
- **Changes**: Script that fails if any integer literal ≥ 10 is present inside `{...}` template bindings in `ui/src/lib/` unless explicitly allowlisted in an ignore config. Integrate into `npm run gate`.

---

### WP-6.3 Standing and debt widget

**Objective**: Implement the PRD Section 4.2 compliant StandingCard widget displaying accurate multiplier caps, debt/contribution ratios, and recovery projections.

#### T-6.3.1 Standing data types
- **Files**: `ui/src/lib/standing/types.ts`.
- **Changes**: Define TypeScript interfaces for Standing payload matching TenantQuotaDO `standing()` output (`community_debt_cu`, `contributed_cu_24h`, `multiplier_pct`, `jail_status`, `caps: { vesting, debt, band }`, `recovery`).

#### T-6.3.2 Standing API client
- **Files**: `ui/src/lib/standing/api.ts`.
- **Changes**: Typed client function `fetchStanding()` calling `GET /api/pool/standing`.

#### T-6.3.3 Rewrite DebtLedgerWidget → StandingCard.svelte with PRD states
- **Files**: `ui/src/lib/standing/StandingCard.svelte`.
- **Changes**:
  - Remove all "Resolve debt" / `resolveDebt` actions.
  - Implement visual states:
    - `PRISTINE`: Green banner, full multiplier, debt ≤ 50% contribution.
    - `SOFT_WARNING`: Yellow banner, 1.50x cap, debt > 50%.
    - `HARD_JAIL`: Red banner, 1.00x lock, debt > 100%.
    - `TRUSTED`: Green with gold star, 7+ debt-free streak.
  - Visual ratio bar with 50% and 100% threshold markers.
  - Active binding cap indicator (Vesting vs Debt vs Pool Band).
  - Recovery projection details (`estimated_days` from server).

#### T-6.3.4 Delete legacy DebtLedgerWidget.test.ts and add StandingCard tests
- **Files**: `ui/src/lib/DebtLedgerWidget.test.ts`, `ui/src/lib/standing/StandingCard.test.ts`.
- **Changes**: Replace legacy test suite with component tests verifying all 4 PRD visual states from fixture payloads.

---

### WP-6.2 Real admin panel

**Objective**: Back the Admin dashboard with real server endpoints for tenant quota resets, key routing controls, provider circuit breaker overrides, and immutable audit logs.

#### T-6.2.1 POST /api/admin/tenants/:id/reset-quota endpoint + TenantQuotaDO.reset()
- **Files**: `src/quota/tenant/tenant_do.ts`, `src/worker/gateway/admin_handler.ts`.
- **Changes**: Implement RPC method `TenantQuotaDO.reset()`. Implement `POST /api/admin/tenants/:id/reset-quota` requiring admin session; writes to `admin_audit_logs`.

#### T-6.2.2 GET /api/admin/audit endpoint
- **Files**: `src/worker/gateway/admin_handler.ts`.
- **Changes**: Paginated query on `admin_audit_logs` returning real event timestamps, actors, actions, and target IDs.

#### T-6.2.3 GET /api/admin/tenants endpoint
- **Files**: `src/worker/gateway/admin_handler.ts`.
- **Changes**: Endpoint aggregating D1 tenant records joined with live DO standing.

#### T-6.2.4 Admin Tenants view
- **Files**: `ui/src/lib/admin/TenantsView.svelte`.
- **Changes**: UI for browsing tenants, viewing live standing, and executing quota reset with modal confirmation.

#### T-6.2.5 Admin Keys view
- **Files**: `ui/src/lib/admin/KeysView.svelte`.
- **Changes**: Server-backed key management table showing routing status, drain state, and soft deletion via coordinator RPC.

#### T-6.2.6 Admin Providers view
- **Files**: `ui/src/lib/admin/ProvidersView.svelte`.
- **Changes**: Controls for viewing Coordinator provider stats and toggling `TRIPPED` / `NORMAL` provider overrides.

#### T-6.2.7 Admin audit log view
- **Files**: `ui/src/lib/admin/AuditLogView.svelte`.
- **Changes**: Paginated table rendering audit logs directly from `GET /api/admin/audit`.

---

### WP-6.4 Information architecture per PRD section 4

**Objective**: Align console navigation and views strictly with PRD Section 4.

#### T-6.4.1 Top-level navigation: Dashboard / Keys / Pool / Analytics
- **Files**: `ui/src/lib/TopNavBar.svelte`, `ui/src/lib/SideNavBar.svelte`.
- **Changes**: Main tabs: `Dashboard`, `Keys`, `Pool`, `Analytics`. Move `Playground` and `API Docs` into a `Developers` dropdown. Admin view accessible only on `admin.*` subdomain.

#### T-6.4.2 Dashboard view
- **Files**: `ui/src/lib/DashboardView.svelte`.
- **Changes**: Compose `StandingCard`, today's activity stats (requests, burst, community served), endpoint details, and token management.

#### T-6.4.3 Keys view with sub-tabs: My Keys / Private / Observation
- **Files**: `ui/src/lib/KeysView.svelte`.
- **Changes**: Filtered tabs. Observation sub-tab displays real-time countdown to pool graduation. Expandable row details: drain state, dispatch count, communal share percentage.

#### T-6.4.4 Rotate modal and pool toggle modal with PRD text
- **Files**: `ui/src/lib/RotateKeyModal.svelte`, `ui/src/lib/PoolToggleModal.svelte`.
- **Changes**: Include PRD Flow D rotation explanation (30-minute grace window for same project) and Flow E pool switch freeze warnings.

#### T-6.4.5 Pool view with sub-tabs: Community / Provider / My Contribution
- **Files**: `ui/src/lib/PoolView.svelte`.
- **Changes**: Backed by `/api/pool/telemetry` and `/api/pool/contribution`. Render locked CTA if user lacks GitHub link.

#### T-6.4.6 Analytics view with sub-tabs: Usage / Ledger / Multiplier History
- **Files**: `ui/src/lib/AnalyticsView.svelte`.
- **Changes**: Usage charts from `daily_cu_rollup`; paginated ledger from `cost_ledger`; history from `standing_history`.

#### T-6.4.7 Public /report page
- **Files**: `ui/src/lib/ReportPage.svelte`.
- **Changes**: Unauthenticated public key reporting form protected by Turnstile widget.

#### T-6.4.8 Notification toasts every 30s
- **Files**: `ui/src/lib/NotificationToasts.svelte`.
- **Changes**: Poll `GET /api/notifications?since=` every 30 seconds; allow dismissing notifications and marking as read.

---

## 4. Phase 6 Gate Verification

Before merging Phase 6 into the main remediation branch:
1. `npm run check-ui-literals` must pass with zero illegal hardcoded numbers.
2. `npm run gate` (< 10s) must pass all unit, integration, UI, and DOM tests.
3. No code in `src/` or `ui/src/` may reference `cost_microdollars`, `budget_microdollars`, `spent_microdollars`, `community_debt_micro_cu`, or `daily_spend_rollup`.
4. Walkthrough verification of PRD Flows A through I recorded in `docs/walkthrough.md`.
