# Pod UI Stitch Overhaul - Low Level Design (LLD)

## 1. Overview
This LLD defines the Svelte 5 Native-DOM visual overhaul for the Key Collective Pod UI, matching the Stitch designs 1:1.

## 2. Core Theming & Typography
- **HTML (`ui/index.html`)**: Incorporates Google Fonts including Geist (sans-serif), JetBrains Mono (monospace), and Material Symbols Outlined for iconography.
- **CSS (`ui/src/app.css`)**: Tailwind v4 theme utilizing charcoal backgrounds, subtle silver borders (`border-white/[0.08]`), and specular glass gradients for depth and premium aesthetic.

## 3. Layout & Navigation
- **Dual-Rail Navigation System**:
  - `SideNavBar.svelte`: Docked navigation rail on the left.
  - `TopNavBar.svelte`: Header bar for contextual actions, search, and user profile.

## 4. Screens & Components

### 4.1. Dashboard (Screen 1)
- **Layout**: 8/4 grid system.
- **Components**:
  - Microdollar Spend Rings: Visualizing usage limits and current expenditure.
  - Live Keys Table: Real-time listing of active API keys and their statuses.
  - Real-Time Telemetry Feed: Streaming log and metrics display using WebSockets.

### 4.2. Developer Workbench (Screen 2)
- **Features**:
  - Project Cards: Managing multi-tenant or multi-project structures.
  - Tier Selectors: UI for selecting tiers (Probationary, Builder, Max).
  - API Keys Management: Issuance, rotation, and revocation controls.

### 4.3. OAuth Modal (Screen 3)
- **Layout**: Wide 7/5 split layout.
- **Features**:
  - Real PKCE redirect initiation flow.
  - 5-layer anti-sybil trust score meter.
  - Email & GitHub progressive authentication states.

### 4.4. API Docs & Playground (Screen 4)
- **Layout**: 7/5 split layout.
- **Features**:
  - Code snippet tabs (cURL, TypeScript, Python).
  - Interactive playground for testing endpoints.
  - Live streaming response pane.
  - Export triggers (Markdown, PDF).

### 4.5. Admin Panel (Screen 5)
- **Component**: `AdminView.svelte` (mapped to admin.key-col.axe08.tech).
- **Features**:
  - Tenant surveillance overviews.
  - Velocity dials indicating throughput and limits.
  - Circuit breaker trip overrides and manual control surfaces.
