# Product Requirements Document (PRD) — Key Collective v3.5
## Two-Phase Identity, Hidden Governance Tiers & Obsidian Edge Admin Surveillance

> **Version:** 3.5.0  
> **Status:** Approved (Inception Board v2.0)  
> **Lead Architect:** User  
> **Target Date:** September 2026  

---

## 1. Problem Statement & Product Vision
Key Collective multiplexes free-tier LLM API keys (Gemini, Groq, Cerebras, DeepSeek) through a Cloudflare Edge isolate mesh with hardware Web Crypto AES-256-GCM encryption and fixed-point microdollar accounting ($1.00 = 1,000,000 µ$). 

While the underlying proxy mechanics are robust, the platform faces two critical vulnerabilities:
1. **Sybil Quota Exhaustion:** Unchecked free API access without credit cards invites automated botnets to drain shared key quotas.
2. **Visual Drift & Control Invisibility:** The previous deployment lost the Stitch desktop dual-rail geometry (`SideNavBar`), used mock authentication, and lacked an administrative control plane.

**Product Vision for v3.5:** Establish a production-grade developer platform featuring frictionless two-phase evaluation (Email Probationary $\rightarrow$ GitHub Builder), strict hidden tier RBAC (Ultra/Admin obscured), a dedicated Admin Surveillance Panel on `admin.key-col.axe08.tech`, and 100% pixel-perfect fidelity with the Stitch designs.

---

## 2. Core Functional Requirements

### 2.1 Subdomain Host Routing
- `api.key-col.axe08.tech`: Dedicated LLM proxy hot path. High-speed passthrough to `KeyPoolDO`.
- `console.key-col.axe08.tech`: Developer Console SPA (Pool & Shield, Developer Workbench, Sybil Gate Modal, API Console).
- `admin.key-col.axe08.tech`: Admin Surveillance Panel. Non-admin requests receive HTTP 404 Not Found at the edge isolate.
- `key-col.axe08.tech`: Apex redirect to `console.key-col.axe08.tech`.

### 2.2 Two-Phase Identity & Tier Promotion
- **Phase 1 (Probationary Ingress):** User registers with Email or Google OAuth $\rightarrow$ assigned `tier = 'probationary'` (2 RPM, 50 RPD, 50,000 µ$ budget cap, Cloudflare Turnstile bot check).
- **Phase 2 (Elevation Gate):** User links GitHub account via OAuth 2.0 PKCE $\rightarrow$ backend checks:
  - Account age $\ge 60$ days
  - Public commits $\ge 15$ in past year
  - Verified non-disposable primary email
  - `UNIQUE(github_user_id)` constraint in D1
  - Passing promotes account to `tier = 'builder'` (20 RPM, 2,000 RPD) or `tier = 'max'` (60 RPM, 10,000 RPD).

### 2.3 Hidden Tiers & Security by Obscurity
- `ultra` (unlimited RPM/RPD) and `admin` are completely stripped from public schemas and client bundles.
- Client attempts to set `tier: "ultra"` return HTTP 400.
- Only an administrator can assign `ultra` to a tenant.

### 2.4 Admin Surveillance Panel (`admin.key-col.axe08.tech`)
- **Tenant Surveillance Table:** Real-time RPM velocity, today's spend ($1 = 1,000,000 µ$), auth provider, tier badge, active keys.
- **Role Control:** 1-click tier override (promote to `ultra`, downgrade, or reset quotas).
- **Abuse Quarantine:** 1-click freeze that flips `is_quarantined = 1` in D1 and evicts the tenant from DO isolate memory within 5ms.
- **Key Pool Telemetry:** Status badges for all AES-256-GCM encrypted keys with rotation fairness metrics.
- **Provider Circuit Breakers:** Global kill switch and per-provider manual overrides (trip Gemini, trip Groq).
- **Bootstrapping:** The initial developer account is seeded as Admin; `ADMIN_EMAILS` secret provides runtime authorization.

### 2.5 100% Stitch Design System Parity
- Restore fixed 256px `SideNavBar` with live cluster status (`SIN-01 Edge Operational • 12ms`) and `+ New Virtual Pool` CTA.
- Restore Top Navigation Header with search bar (`⌘K`) and brand pill.
- Restore Screen 1 8/4 grid (`KeysTable` 8 cols / `TelemetryLogs` 4 cols).
- Restore Screen 2 4/3/5 identity card with circular SVG trust gauge (92/100).
- Restore Screen 3 wide 7/5 two-column split OAuth modal.
- Restore Screen 4 7/5 API docs split with the live streaming Response Viewer panel.
- Inject Material 3 tokens into Tailwind v4 `@theme` in `ui/src/app.css`.

---

## 3. Non-Functional Invariants
- **Strict TypeScript (No `any`):** Cloudflare Workers & Durable Objects.
- **Zero Plaintext Keys:** AES-256-GCM encryption with 12-byte CSPRNG nonces in D1.
- **Fixed-Point Microdollars:** 64-bit integer microdollars ($1.00 = 1,000,000 µ$). Zero floating-point math.
- **Edge Latency SLA:** Total proxy routing overhead <20ms, cold starts 0ms.
- **Bundle Size Budget:** Frontend total gzipped bundle <45KB.
