# Frontend Architecture & Stitch Design Fidelity: SOTA Evaluation & Implementation Blueprint

**Target:** `docs/research/frontend_stack_and_stitch_fidelity.md`  
**Author:** Systems Researcher — Workflow 1: Project Inception v2.0  
**Project:** Key Collective (Edge-Native Virtual AI Key Pool & Latency Shield)  
**Date:** September 2026  
**Status:** Canonical Architectural Recommendation  

---

## 1. Executive Summary & Problem Statement

Key Collective's web interface was prototyped in Stitch across four canonical desktop screens:
1. **Screen 1 (`screen1_dashboard.html`):** Virtual Key Inventory, KPI Metric Cards, and Real-time Telemetry Log Console (8/4 split grid).
2. **Screen 2 (`screen2_workbench.html`):** Developer Governance, 4/3/5 Anti-Sybil Trust Gauge, 7-Tier Authorization Matrix, and Multi-Project Gateway Manager.
3. **Screen 3 (`screen3_oauth_sybil.html`):** Developer Gateway Modal, 1-Developer 1-Account Quota Provisioning, and Sybil Biometric Inspection.
4. **Screen 4 (`screen4_api_docs.html`):** Interactive API Reference, Universal Edge Gateway Endpoints, and 7/5 Split Sticky Sandbox Console.

When this interface was initially migrated into Svelte, the implementation suffered from **critical visual drift**:
- The dual-rail fixed navigation (`SideNavBar`) completely vanished.
- The 8/4 dashboard grid and 7/5 API docs split collapsed into an unstyled single-column vertical stack.
- The chiseled specular reflections (`.specular-border`, `.specular-card`), atmospheric radial glows, and typography completely disintegrated.
- Container elements shrank from an edge-native full-width canvas into an arbitrary `max-w-7xl` centered box.

---

## 2. Frontend Framework Evaluation for Stitch Component Porting

### 2.1 Detailed Architectural Matrix

| Evaluation Dimension | Svelte 5 (with Runes) | React 19 / Vite | Preact 10 / Vite | Pure Web Components / Vanilla |
| :--- | :--- | :--- | :--- | :--- |
| **Production Bundle (Gzip)** | **28 KB – 42 KB** (Micro-bundle) | 185 KB – 320 KB (Heavy) | 38 KB – 60 KB (Light) | **< 15 KB** (Minimal) |
| **Edge Cold Start (TTFB + Hydration)** | **< 25 ms** on V8 Isolates | 85 ms – 160 ms (Script parse lag) | 30 ms – 45 ms | < 15 ms |
| **Stitch HTML Porting Friction** | **Zero Friction:** Valid HTML is valid Svelte. Direct DOM copy-paste. | **Severe Friction:** Must rewrite to JSX (`className`, SVG camelCase, style objs). | **High Friction:** Identical JSX conversion overhead as React. | **Extreme Friction:** Manual DOM wiring, boilerplate web component templates. |
| **Reactivity Paradigm** | Fine-grained Signals (`$state`, `$derived`, `$effect`). Zero VDOM. | Virtual DOM diffing, Hook rules (`useEffect`, dependency arrays, memoization). | Virtual DOM with lightweight diffing. | Manual imperative event listeners or CustomEvent dispatching. |
| **Edge Asset Serving (`env.ASSETS`)** | **Optimal:** Fits effortlessly in Cloudflare KV edge cache layer. | Sub-optimal: Heavy asset transmission over mobile edge connections. | Good: Fast asset transfer, modest footprint. | Optimal: Tiny static assets. |
| **Dynamic Chunk Splitting** | Native dynamic `import()` with `{#await}` blocks. | Native dynamic `import()` with `React.lazy` + `Suspense`. | Native dynamic `import()` with `lazy`. | Manual script injection or module loading. |
| **SVG & Icon Fidelity** | Direct inline SVG or Material Symbols text literals (`vpn_key`). | Requires Lucide icon wrappers or JSX SVG sanitization. | Requires JSX SVG sanitization. | Direct inline SVG. |

### 2.2 Framework Verdict
- **Retain Svelte 5 + Vite + Tailwind v4**: Svelte's template syntax is 100% native HTML. This allows direct 1:1 porting of the Stitch HTML DOM without converting thousands of SVG attributes and CSS classes into JSX. The previous bug was not Svelte—it was omitting the `SideNavBar` component, omitting the `@theme` definitions in Tailwind v4, and replacing the grid with a vertical stack.

---

## 3. Forensic Root-Cause Analysis of Previous Visual Drift

1. **Defect 1: The Disappearance of the `SideNavBar` & Viewport Shrinkage:**
   - Stitch had a fixed `w-64` left sidebar and main canvas with `md:ml-64`.
   - The implementation omitted the component entirely and wrapped the canvas in `max-w-7xl mx-auto`.
2. **Defect 2: Destruction of the 8/4 Dashboard Grid:**
   - Stitch Screen 1 docks the Keys Table (`xl:col-span-8`) side-by-side with the Telemetry Console (`xl:col-span-4`).
   - The implementation flattened this into a single vertical stack.
3. **Defect 3: Compression of the 7/5 API Docs Split Layout:**
   - Stitch Screen 4 places the documentation on the left (`lg:col-span-7`) and the sticky interactive sandbox on the right (`lg:col-span-5`).
   - Squeezing it inside `max-w-7xl` broke the playground into an unreadable narrow strip.
4. **Defect 4: The Tailwind v4 Token Blackhole:**
   - Stitch uses Material Design tokens (`bg-surface-container-low`, `text-on-surface`, `border-outline-variant/30`).
   - `ui/src/app.css` did not define these tokens under `@theme`, resulting in **zero CSS rules being emitted by Tailwind v4**.
5. **Defect 5: Missing Fonts and Icons:**
   - `ui/index.html` lacked Google Fonts for `Material Symbols Outlined`, `Geist`, and `JetBrains Mono`.

---

## 4. The Immutable Component Template Contract

1. **Immutable Shell:** `TopNavBar` (fixed `h-14`), `SideNavBar` (fixed `w-64`), and main canvas (`md:ml-64 pt-14`).
2. **Zero Class Renaming:** Use the exact Material 3 classes from Stitch.
3. **Token Integrity:** Inject the full `@theme` palette into `app.css`.
4. **Dynamic Data Binding:** Replace only dynamic text and array loops (`{#each}`) while leaving DOM tags and classes untouched.

---

## 5. Secure Admin Panel Architecture (`activeTab = 'admin'`)

1. **Rollup Manual Chunk Isolation:** Vite packages `AdminView.svelte` into `assets/admin-edge-shield-[hash].js`.
2. **Edge Asset Gatekeeper:** In `src/worker/index.ts`, requests for `admin-edge-shield` or `/admin` are verified against D1 (`tier === 'admin'`).
3. **Zero-Knowledge 404 Denial:** Unauthenticated or non-admin requests receive HTTP 404 Not Found (never 401/403) to prevent route and asset enumeration.
