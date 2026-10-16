# Dev QA Pass 2: Comprehensive Remediation Plan

**Document Version:** 1.0  
**Date:** 2026-10-17  
**Author:** AI Systems Engineer & Dev QA Lead  
**Target Git Branch:** `docs/intent-audit-and-remediation`  
**Reference Pass:** [`docs/specs/QA/dev_qa_pass2_2026-10-06.md`](./dev_qa_pass2_2026-10-06.md)  
**Quality Invariant:** All implementations must strictly preserve TypeScript strict mode (no `any`), adhere to the Cloudflare Workers & Durable Objects transactional boundaries, and pass `make gate` (<10s, 1049 backend + 102 UI tests).

---

## Executive Summary

During Dev QA Pass 2 (Phase F verification) across `console-dev.key-col.axe08.tech`, `api-dev.key-col.axe08.tech`, and `admin-dev.key-col.axe08.tech`, **50 out of 57 test assertions** were verified and passed (or spec-reconciled), including dual-format key compatibility (legacy GCP `AIza...` and modern Google AI Studio `AQ...`), tenant compute isolation, and midnight rollups.

This document identifies all **9 technical problems and UX discrepancies** uncovered across Blocks C, D, E, G, H, and L, analyzes their architectural root causes, and defines a prioritized, deterministic remediation roadmap.

---

## Issue Registry & Priority Matrix

| ID | Priority | Subsystem | Issue Title | Affected Files |
|---|:---:|---|---|---|
| **ISSUE-01** | **P0** | Workbench | Project Key Action Dropdown Clipped by Table Overflow | `ui/src/lib/Workbench.svelte` |
| **ISSUE-02** | **P0** | Admin Portal | Reset Quota Modal Fails to Open (`actionModalType` Mismatch) | `ui/src/lib/admin/TenantSurveillance.svelte`, `SurveillanceActionModal.svelte` |
| **ISSUE-03** | **P0** | Analytics | "Daily CU Rollup by Model" Empty due to SQLite Column Mismatch | `src/worker/router/dashboard/metrics_routes.ts` |
| **ISSUE-04** | **P1** | Dashboard | "Today's Activity" Personal Reqs Reads 0 for Private Key Traffic | `src/worker/pool_routes.ts`, `ui/src/lib/DashboardView.svelte` |
| **ISSUE-05** | **P1** | Navigation | SideNavBar Quota Badge Shows 0% and Omits Total Limit | `ui/src/lib/SideNavBar.svelte` |
| **ISSUE-06** | **P1** | Provider Keys | Optimistic UI Observation Status on Community Key Creation | `src/worker/router/dashboard/keys/post_key.ts` |
| **ISSUE-07** | **P1** | Responsive | Mobile Navigation Missing Below 768px (Tab Switching Blocked) | `ui/src/lib/SideNavBar.svelte`, `TopNavBar.svelte`, `App.svelte` |
| **ISSUE-08** | **P2** | Pool Commons | Legacy Shard Placeholders (`sambanova`, `cerebras`) in Telemetry | `src/worker/pool_routes.ts`, `ui/src/lib/types.ts` |
| **ISSUE-09** | **P2** | Auth / Docs | Ephemeral Playground Token (15m TTL) vs Permanent Project Key | `ui/src/lib/PlaygroundView.svelte` |

---

## Detailed Problem Analysis & Remediation Specs

### ISSUE-01 (P0): Project Key Action Dropdown Clipped by Table Overflow

#### 1. Problem Description & Evidence
* **QA Block:** D2, D3, D4, D5, D6.
* **Evidence:** Screenshot [`docs/specs/QA/D2.png`](./D2.png).
* **Symptom:** Clicking the 3-dot action button on a project key row in Workbench opens the dropdown menu (`Rotate Secret`, `Revoke Key`), but the menu is clipped by the table boundary and cannot be scrolled to access actions. This blocked testing D3 through D6.

#### 2. Root Cause Analysis
In `ui/src/lib/Workbench.svelte`, the project keys table container is styled with `overflow: hidden` (or `overflow-x: auto`) and relative positioning. The action dropdown is rendered as an absolutely positioned element inside the table cell (`relative` container), causing its bounding box to be clipped by the parent overflow boundary.

#### 3. Technical Remediation Spec
* **Option A (Preferred):** Use a teleport/portal or `position: fixed` with coordinates calculated from `triggerElement.getBoundingClientRect()`.
* **Option B (Immediate):** Remove `overflow: hidden` from the table wrapper, set `overflow: visible`, and add a global `click_outside` directive to dismiss open menus.
* **Acceptance Criteria:**
  - Clicking the 3-dot action menu renders the full dropdown above table borders (`z-index: 50`).
  - Both "Rotate Secret" and "Revoke Key" options are fully visible and clickable without scrolling.

---

### ISSUE-02 (P0): Admin Reset Quota Modal Fails to Open

#### 1. Problem Description & Evidence
* **QA Block:** H7.
* **Symptom:** In the Admin Surveillance tab (`admin-dev.key-col.axe08.tech`), clicking the "Reset Quota" button on a tenant row produces no visible effect; no modal or confirmation appears.

#### 2. Root Cause Analysis
In `ui/src/lib/admin/TenantSurveillance.svelte`:
```ts
function openResetModal(tenant: TenantSurveillanceRow) {
  targetTenant = tenant;
  actionModalType = 'RESET_QUOTA'; // <--- Set to uppercase 'RESET_QUOTA'
}
```
In `ui/src/lib/admin/surveillance/SurveillanceActionModal.svelte#L145`:
```svelte
{#if actionModalType === 'reset' && targetTenant} <!-- <--- Checks lowercase 'reset' -->
```
Because `'RESET_QUOTA' !== 'reset'`, the modal condition evaluates to `false` and the DOM node is never mounted.

#### 3. Technical Remediation Spec
* Normalize `actionModalType` in `TenantSurveillance.svelte`:
  ```ts
  function openResetModal(tenant: TenantSurveillanceRow) {
    targetTenant = tenant;
    actionModalType = 'reset';
    actionReason = `Administrative quota counter reset for ${tenant.email || tenant.tenantId}`;
  }
  ```
* Ensure `SurveillanceActionModal.svelte` emits `onConfirm` which invokes `api.resetTenantQuota(targetTenant.tenantId, actionReason)`.
* **Acceptance Criteria:**
  - Clicking "Reset Quota" opens the confirmation modal with tenant email and reason input.
  - Submitting calls `POST /api/admin/tenants/:id/reset-quota`, writes an audit row to `admin_audit_logs`, and refreshes the tenant table.

---

### ISSUE-03 (P0): Analytics "Daily CU Rollup by Model" Empty due to SQLite Column Mismatch

#### 1. Problem Description & Evidence
* **QA Block:** E7, Analytics Sub-tab "Usage".
* **Symptom:** In the Analytics tab, the "Usage Ledger" table displays all 17 requests correctly, but the "Daily CU Rollup by Model" sub-tab reports "No daily usage rollups recorded yet."

#### 2. Root Cause Analysis
1. **Column Name Mismatch:** In [`src/worker/router/dashboard/metrics_routes.ts#L291-L308`](file:///home/akshit/Projects/Key%20Collective/src/worker/router/dashboard/metrics_routes.ts#L291-L308):
   ```sql
   SELECT day, provider, model, requests, tokens, cu FROM daily_cu_rollup WHERE tenant_id = ?
   ```
   In remote D1, the actual table schema is:
   ```sql
   CREATE TABLE daily_cu_rollup (
     tenant_id TEXT NOT NULL,
     day TEXT NOT NULL,
     provider TEXT NOT NULL,
     model_id TEXT NOT NULL,
     total_requests INTEGER NOT NULL DEFAULT 0,
     total_tokens INTEGER NOT NULL DEFAULT 0,
     total_cu INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (tenant_id, day, provider, model_id)
   );
   ```
   SQLite fails with error `no such column: model`. The enclosing `try/catch` silently returns `{ usage: [] }`.
2. **Real-Time Visibility:** `daily_cu_rollup` is only populated during scheduled midnight rollups. Requests during the day are logged only to `cost_ledger`.

#### 3. Technical Remediation Spec
* In `metrics_routes.ts`, update `handleGetAnalyticsUsage` to query live aggregations from `cost_ledger`:
  ```sql
  SELECT
    date(created_at) AS day,
    provider,
    model_id AS model,
    COUNT(*) AS requests,
    SUM(prompt_tokens + completion_tokens) AS tokens,
    COALESCE(SUM(cu), 0) AS cu
  FROM cost_ledger
  WHERE tenant_id = ?
  GROUP BY day, provider, model_id
  ORDER BY day DESC, cu DESC
  LIMIT 100
  ```
* **Acceptance Criteria:**
  - Visiting the Analytics Usage sub-tab immediately displays live rows grouped by day, provider, and model with exact token counts and CU totals.

---

### ISSUE-04 (P1): Dashboard "Today's Activity" Personal Reqs Reads 0

#### 1. Problem Description & Evidence
* **QA Block:** E7, Dashboard Activity Card.
* **Symptom:** The Dashboard's "Today's Activity" card displays `Personal Reqs: 0`, despite the tenant executing 16 requests and consuming 146 CU.

#### 2. Root Cause Analysis
In [`src/worker/pool_routes.ts#L277-L322`](file:///home/akshit/Projects/Key%20Collective/src/worker/pool_routes.ts#L277-L322), `handlePoolContribution` derives `personalRequestsToday` from:
```ts
const personalRequestsToday = Math.max(0, coordDispatchedToday - coordCommunalServed);
```
`coordDispatchedToday` is queried exclusively from the Community `POOL_COORDINATOR` DO (`pool:google`, `pool:groq`). When a developer executes requests using their own private keys, the traffic routes through `KeySelectorDO` and `TenantQuotaDO`, completely bypassing `POOL_COORDINATOR`. Consequently, `coordDispatchedToday` is 0.

#### 3. Technical Remediation Spec
* In `handlePoolContribution`, query `cost_ledger` for today's personal request count if `coordDispatchedToday === 0`:
  ```sql
  SELECT COUNT(*) as personal_reqs
  FROM cost_ledger
  WHERE tenant_id = ? AND date(created_at) = date('now') AND borrowed = 0
  ```
* In `DashboardView.svelte`, ensure the display uses:
  ```svelte
  {(contributionData.personal_requests_today || stats.daily_quota_used || 0).toLocaleString()}
  ```
* **Acceptance Criteria:**
  - "Personal Reqs" accurately reflects all requests dispatched today across both private and community keys.

---

### ISSUE-05 (P1): SideNavBar Quota Badge Zero Utilization & Missing Total Limit

#### 1. Problem Description & Evidence
* **QA Block:** E7, Navigation Footer.
* **Symptom:** The bottom quota badge displays `0%` utilization and `146 CU today`, without displaying the total quota limit or allowance figure.

#### 2. Root Cause Analysis
1. In `SideNavBar.svelte#L36`:
   ```ts
   const percent = Math.round((stats.daily_quota_used / stats.daily_quota_limit) * 100);
   ```
   `stats.daily_quota_used` is 16 requests; `stats.daily_quota_limit` is 16,500 RPD sum. `16 / 16,500 = 0.096%`, which `Math.round()` reduces to `0%`.
2. In `SideNavBar.svelte#L178-L183`:
   ```svelte
   <div class="flex justify-between items-center text-[10px] font-mono text-on-surface-variant pt-0.5">
     <span class="text-secondary font-medium">{formatCu(cuUsedToday)} CU today</span>
     <!-- Right-hand denominator span is missing -->
   </div>
   ```

#### 3. Technical Remediation Spec
* Update `quotaPercent` in `SideNavBar.svelte` to calculate CU-based spend against `cu_allowance_today`:
  ```ts
  let quotaPercent = $derived.by(() => {
    const allowance = stats?.cu_allowance_today || stats?.daily_quota_limit || 0;
    if (allowance <= 0 || !cuUsedToday || cuUsedToday <= 0) return 0;
    const ratio = (cuUsedToday / allowance) * 100;
    return ratio > 0 && ratio < 1 ? 1 : Math.min(100, Math.round(ratio));
  });
  ```
* Add the right-hand limit figure to the footer markup:
  ```svelte
  <div class="flex justify-between items-center text-[10px] font-mono text-on-surface-variant pt-0.5">
    <span class="text-secondary font-medium" title="Credit Unit Accounting ({cuUsedToday} CU)">
      {formatCu(cuUsedToday)} CU today
    </span>
    {#if stats?.cu_allowance_today || stats?.daily_quota_limit}
      <span class="text-outline">
        / {formatCu(stats.cu_allowance_today || stats.daily_quota_limit)} CU limit
      </span>
    {/if}
  </div>
  ```
* **Acceptance Criteria:**
  - Badge renders both used and total figures (e.g., `146 CU today / 16.5K CU limit`).
  - Bar renders non-zero percentage (e.g. `1%` or `<1%`) when CU has been consumed.

---

### ISSUE-06 (P1): Optimistic UI Observation Status on Community Key Creation

#### 1. Problem Description & Evidence
* **QA Block:** C6 (Option A).
* **Symptom:** Immediately upon adding a Community key, the key row displays `HEALTHY` and "Graduated" before page refresh. Refreshing the browser displays the correct amber `OBSERVATION` badge and countdown timer.

#### 2. Root Cause Analysis
In [`src/worker/router/dashboard/keys/post_key.ts`](file:///home/akshit/Projects/Key%20Collective/src/worker/router/dashboard/keys/post_key.ts), the 201 response JSON payload omits `community_routing_status`, `observation_until`, and `is_owner`. `App.svelte` prepends this created key object directly into the reactive `keys` array. In `KeysView.svelte`, `formatCountdown(undefined)` defaults to `'Graduated'`.

#### 3. Technical Remediation Spec
* In `post_key.ts`, add the observation fields to the returned response object:
  ```ts
  return jsonResponse({
    id: keyId,
    key_prefix: prefix,
    key_suffix: suffix,
    provider: provider === "google" ? "gemini" : provider,
    label: body.label,
    rpm_limit: rpmLimit,
    rpd_limit: rpdLimit,
    priority: body.priority ?? 0,
    status: "HEALTHY",
    pool_type: poolType,
    community_routing_status: community ? "OBSERVATION" : null,
    observation_until: community ? now + DAY_MS : null,
    is_owner: true,
    requests_this_min: 0,
    requests_today: 0,
    total_requests: 0,
    created_at: now,
    sync: "pending",
  }, 201);
  ```
* **Acceptance Criteria:**
  - New Community keys immediately display amber `OBSERVATION` badge and 24h countdown timer upon creation without requiring page reload.

---

### ISSUE-07 (P1): Mobile Navigation Missing Below 768px

#### 1. Problem Description & Evidence
* **QA Block:** L2.
* **Symptom:** On phone viewports (width ~390px), horizontal scrolling is avoided, but the user cannot switch tabs because the navigation sidebar and top navbar links are hidden.

#### 2. Root Cause Analysis
In `SideNavBar.svelte`: `<aside class="... hidden md:flex">`.  
In `TopNavBar.svelte`: `<nav class="hidden md:flex ...">`.  
There is no mobile drawer or bottom tab bar implemented for viewports `< 768px`.

#### 3. Technical Remediation Spec
* Implement a mobile bottom navigation bar in `App.svelte` (or `SideNavBar.svelte`) visible only on `md:hidden`:
  - 4 primary tabs: **Dashboard**, **Keys**, **Pool**, **Analytics**.
  - Fixed at screen bottom (`fixed bottom-0 left-0 right-0 z-40 bg-surface-container-low/95 backdrop-blur-lg border-t border-outline-variant/30`).
* Add `pb-16` padding to main container on mobile to prevent content overlap.
* **Acceptance Criteria:**
  - On phone widths (390px), a sleek bottom navigation bar allows switching between all 4 tabs smoothly.

---

### ISSUE-08 (P2): Legacy Shard Placeholders (`sambanova`, `cerebras`) in Telemetry

#### 1. Problem Description & Evidence
* **QA Block:** G1.
* **Symptom:** The Provider pool table in the Pool tab lists `sambanova` and `cerebras` with zero keys, which confuses developers who know those providers were pruned from the catalog.

#### 2. Root Cause Analysis
In [`src/worker/pool_routes.ts#L77`](file:///home/akshit/Projects/Key%20Collective/src/worker/pool_routes.ts#L77), `const canonicalProviders = ['gemini', 'groq', 'sambanova', 'cerebras']` hardcodes inactive providers.

#### 3. Technical Remediation Spec
* Prune `canonicalProviders` in `src/worker/pool_routes.ts` to `['gemini', 'groq']`.
* Update `ui/src/lib/types.ts` type definition: `export type Provider = 'gemini' | 'groq';`.
* **Acceptance Criteria:**
  - Pool Provider table displays only active, supported providers (`gemini` and `groq`).

---

### ISSUE-09 (P2): Ephemeral Playground Token vs Permanent Project Key Clarity

#### 1. Problem Description & Evidence
* **QA Block:** E2/E4 cURL tests.
* **Symptom:** Developers copying tokens from browser Playground requests encounter `401 AUTHENTICATION_FAILED: [REDACTED_SECRET] has expired` after 15 minutes.

#### 2. Root Cause Analysis
Playground tokens (`kc_live_...`) are ephemeral by security design (15m TTL), whereas permanent keys (`kc_proj_live_...`) are created under Workbench projects.

#### 3. Technical Remediation Spec
* In `PlaygroundView.svelte`, render an informational badge next to the endpoint:
  *"Playground session token expires in 15m. For persistent API integration, use a Project Key from Workbench."*
* **Acceptance Criteria:**
  - Clear UX distinction between ephemeral browser playground tokens and permanent virtual project keys.

---

## Execution Order & Verification Status

### Phase 1: High-Priority Fixes (P0) — [COMPLETED & VERIFIED: commit `390c55d`]
1. **ISSUE-01:** Fix Workbench project key dropdown clipping. (Done in `ui/src/lib/workbench/KeysSection.svelte`)
2. **ISSUE-02:** Fix Admin `actionModalType` mismatch to enable Quota Reset. (Done in `ui/src/lib/admin/TenantsView.svelte` & `AdminView.svelte`)
3. **ISSUE-03:** Fix `handleGetAnalyticsUsage` SQL column mismatch & live aggregation. (Done in `src/worker/router/dashboard/metrics_routes.ts`)

### Phase 2: Core UX & Metrics Synchronization (P1) — [COMPLETED & VERIFIED]
4. **ISSUE-06:** Add observation status payload to `post_key.ts` 201 response. (Done in `src/worker/router/dashboard/keys/post_key.ts`)
5. **ISSUE-04:** Fix Dashboard `personal_requests_today` calculation in `pool_routes.ts` & fallback in `DashboardView.svelte`.
6. **ISSUE-05:** Update `SideNavBar.svelte` quota percentage calculation & render `/ limit` denominator figure.
7. **ISSUE-07:** Implement responsive mobile bottom navigation bar (`<nav ...>` for `< 768px`) in `ui/src/App.svelte`.

### Phase 3: Cleanup & Documentation (P2) — [COMPLETED & VERIFIED]
8. **ISSUE-08:** Prune `sambanova` and `cerebras` from `pool_routes.ts` & `ui/src/lib/types.ts`.
9. **ISSUE-09:** Add Playground session token guidance banner in `ui/src/lib/playground/PlaygroundRequestForm.svelte`.

### Verification Gate Protocol
All phases verified with:
```bash
make gate  # Typecheck + 1049 backend tests + 102 UI tests satisfied in <10s (ALL PASSED)
```
Following deployment of these fixes to `dev`, sections C6, D3–D6, E7, G1, H7, and L2 can be re-tested in `dev` to achieve a 100% clean QA pass.

