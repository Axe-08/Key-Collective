# Low-Level Design: Pod-Frontend-Clarity

## 1. Overview
This LLD details the implementation of the `pod-frontend-clarity` UI pod for Key Collective, encompassing the API client and a suite of Svelte components designed with modern web principles, strict accessibility guidelines, and performance-centric rendering techniques.

## 2. Component Specifications

### 2.1 `src/ui/api.ts` (API Client)
- **State & Integration**: Acts as the centralized networking layer.
- **Implementation**:
  - A fetch wrapper that seamlessly injects the `x-tenant-id` header to enforce tenant isolation.
  - Intercepts requests and responses, providing automatic parsing and stringification of data.
  - Contains a custom JSON reviver/replacer function to handle `bigint` conversions since native JSON does not support them (e.g., parsing `costMicrodollars` string fields back into JavaScript `bigint`).

### 2.2 `src/ui/MetricCards.svelte` & `src/ui/VelocityDials.svelte`
- **Role**: Render core telemetry stats, financial metrics, and velocity/rate limits.
- **Design Specifications**:
  - Uses modern CSS Grid (`display: grid`) for robust card alignment.
  - Implements a deterministic formatting utility that transforms `costMicrodollars: bigint` into fractional dollars for display (e.g., `(Number(cost) / 1000000).toFixed(6)`), ensuring zero floating-point math issues during accumulation.
  - Avoids color-only indicators (e.g., using warning icons alongside textual statuses for velocity controls).

### 2.3 `src/ui/PricingTable.svelte`
- **Role**: Tabular layout for displaying various tier rates and token costs.
- **Design Specifications**:
  - Uses CSS `display: grid` with `grid-template-columns: subgrid` (where supported) to ensure that pricing columns perfectly align with the parent container’s metrics layout.
  - Follows strict 4.5:1 text contrast for all pricing text elements.

### 2.4 `src/ui/KeysTable.svelte` & `src/ui/PoolCommonsTab.svelte`
- **Role**: High-density data tables displaying API keys (`EncryptedKey`) and community pool routing info.
- **Design Specifications**:
  - **Performance**: Implements `content-visibility: auto` combined with `contain-intrinsic-size` on table rows (or virtualized wrapper components) to drastically reduce Interaction to Next Paint (INP) times when handling hundreds of keys.
  - **State Transitions**: Applies debouncing strategies (e.g., `setTimeout` or `requestAnimationFrame`) when rapidly switching key statuses.
  - **A11y**: Enforces native HTML table semantics. Sortable headers must utilize the `aria-sort` attribute (`ascending`, `descending`, `none`).

### 2.5 `src/ui/TelemetryCharts.svelte`
- **Role**: Time-series visualization of events mapped to the `TelemetryEvent` contract.
- **Design Specifications**:
  - Subscribes to time-series data or polls via `api.ts`.
  - **Accessibility**: Listens to `@media (prefers-reduced-motion: reduce)` in CSS to disable heavy stroke animations or charting transitions, opting for instant data rendering.
  - Employs textural or patterned fills in charts instead of relying solely on solid colors to represent "Rate Limited" vs "Success" bars.

### 2.6 `src/ui/CodePlayground.svelte`
- **Role**: Interactive API execution and snippet visualization.
- **Design Specifications**:
  - **Modals**: Configuration settings (e.g., choosing a mock tenant or key) use the native HTML `<dialog>` element, invoked via `.showModal()` to enforce native focus trapping and backdrop management.
  - **Rendering**: Employs `content-visibility: auto` on off-screen code snippets.
  - **Theming**: Syncs with `prefers-color-scheme: dark` to swap syntax highlighting palettes automatically.

## 3. Adherence to GEMINI.md Guidelines
- No plaintext keys will be stored or handled unnecessarily. All interactions map to encrypted IDs and standard protocols defined by the backend router.
- Fully relies on fixed-point microdollars (`bigint`) for frontend presentation.

## 4. Testing & Verification
- **Unit Tests**: Svelte component tests via Vitest/Testing Library to assert DOM elements and accessibility constraints (`aria-sort`, `<dialog>` usage).
- **Type Checking**: Strict TypeScript validation leveraging the `EncryptedKey` and `TelemetryEvent` interfaces in `src/contracts/`.
