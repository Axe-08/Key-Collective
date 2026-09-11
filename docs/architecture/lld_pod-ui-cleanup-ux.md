# Low-Level Design: Pod UI Cleanup UX

## 1. Overview
The goal of this task is to clean up and refine the User Experience (UX) across key UI components of the Pod Manager. Specifically, we will eliminate duplicate navigation elements, remove misleading mock buttons, update status strings for clarity, and streamline the administrative and documentation views.

## 2. Scope of Changes

### 2.1 TopNavBar.svelte
- **Location**: `ui/src/lib/TopNavBar.svelte`
- **Actions**:
  - Remove the centered `<nav>` element which duplicates the primary navigation tabs ("Virtual Pools", "Developer Workbench", "API Docs", "Admin Panel").
  - Remove the "Deploy Proxy" button (reload mock) and the "Add Provider Key" button from the top bar to de-clutter the header.
  - Update the edge status badge text: Change from `"Operational • 12ms (SIN-01)"` to `"Edge Network Active • Latency Nominal"`.

### 2.2 SideNavBar.svelte
- **Location**: `ui/src/lib/SideNavBar.svelte`
- **Actions**:
  - Rename the main CTA button text from `"+ New Virtual Pool"` to `"+ Add Provider Key"`.
  - Remove the `"SIN-01 Edge Operational"` card block at the top of the sidebar.
  - Consolidate navigation links to precisely four active routes:
    1. Overview (Key Pool) -> `activeTab = "pool"`
    2. Developer Workbench -> `activeTab = "workbench"`
    3. API Documentation -> `activeTab = "docs"`
    4. Admin Panel -> `activeTab = "admin"` (rendered only if `userAccount?.tier === "admin"`)
  - Remove redundant or duplicate navigation links ("Key Inventory", "Failover Topologies", "Usage & Quotas", "Audit Trail", etc.).
  - Rename `"Shield Quota"` to `"Daily Quota Limit"`.

### 2.3 ApiDocs.svelte
- **Location**: `ui/src/lib/ApiDocs.svelte`
- **Actions**:
  - Refine marketing language in the documentation. For example, replace `"All requests are routed through edge proxies deployed at 28 tier-1 exchanges."` with a simpler, developer-focused technical phrasing (e.g., `"API requests are routed through regional edge proxies for minimal latency."`). This applies to both the markdown export string and the HTML rendering.
  - The interactive sandbox and Markdown/PDF export functions will remain fully functional and un-modified in logic.

### 2.4 AdminView.svelte
- **Location**: `ui/src/lib/admin/AdminView.svelte`
- **Actions**:
  - Update the default state of `adminTab` from `"all"` to `"surveillance"`.
  - Remove the `"Unified Control Center"` tab button.
  - Refactor the conditional rendering logic (`{#if adminTab === "all" || ...}`) to rely strictly on mutually exclusive tab matches (e.g., `{#if adminTab === "surveillance"}`) ensuring that the Tenant Surveillance, Velocity Dials, and Circuit Breakers views do not stack.
  - Remove the `"SIN-01 • DO Isolated Hot State"` text from the header badge area to reduce clutter.

## 3. Architecture & Contracts
No changes are required to the underlying TypeScript contracts (`src/contracts/v3_types.ts` and `src/contracts/v3_5_types.ts`). The modifications are strictly presentational and structural within the Svelte components.
