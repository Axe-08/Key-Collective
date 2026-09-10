# System Design Specification (v3.5)
## Key Collective: Frontend Component Architecture & Stitch Token Integration

**Author:** Principal Systems Architect (Inception Board)  
**Status:** Approved by User  

---

## 1. Architectural Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │            Cloudflare Global Edge            │
                    │               (V8 Isolates)                  │
                    └──────────────────────┬───────────────────────┘
                                           │
                        ┌──────────────────▼──────────────────┐
                        │        Single Page App (SPA)        │
                        │           ui/src/App.svelte         │
                        └──────────────────┬──────────────────┘
                                           │
         ┌──────────────────┬──────────────┴─────┬─────────────────┐
         │                  │                    │                 │
┌────────▼─────────┐ ┌──────▼──────────┐ ┌───────▼────────┐ ┌──────▼──────────┐
│  Screen 1 (Tab)  │ │ Screen 2 (Tab)  │ │ Screen 3 (Mod) │ │  Screen 4 (Tab) │
│ Dashboard & Pool │ │ Dev Workbench   │ │ GitHub OAuth   │ │ API Docs & Play │
│ KeyPoolTable     │ │ ProjectCards    │ │ 5-Layer Sybil  │ │ Interactive Box │
│ Real-Time Logs   │ │ 7-Tier Matrix   │ │ Ephemeral Sand │ │ Multi-Lang Tab  │
└──────────────────┘ └─────────────────┘ └────────────────┘ └─────────────────┘
```

## 2. Design Token System (`ui/src/app.css`)
- **Canvas Base:** `#090B10` with subtle ambient radial glow (`radial-gradient(ellipse at 50% 0%, rgba(99, 102, 241, 0.12) 0%, transparent 70%)`).
- **Glass Surfaces:**
  - Base Surface: `rgba(12, 15, 23, 0.70)` with `backdrop-filter: blur(16px)` and border `1px solid rgba(255, 255, 255, 0.06)`.
  - Raised Surface / Modals: `rgba(19, 23, 34, 0.82)` with `backdrop-filter: blur(24px)` and border `1px solid rgba(255, 255, 255, 0.12)`.
  - Specular Hairline: Top border accent running gradient `from-transparent via-white/15 to-transparent`.
- **Typography Tokens:**
  - Headings: `Geist`, negative tracking `-0.02em` to `-0.03em`.
  - Telemetry & Data: `JetBrains Mono`, uppercase for labels with `+0.04em` tracking.

## 3. Component Hierarchy
- `App.svelte`: Root shell with top navigation bar, tenant selector, live status ping, and view router.
- `Header.svelte`: Obsidian edge bar with live Cloudflare edge node indicator, mode pills, and OAuth/Account trigger.
- `MetricCards.svelte`: Frosted KPI cards with SVG sparklines and microdollar financial formats ($1 = 1,000,000 µ$).
- `KeysTable.svelte`: Monospace obfuscated key display with copy actions and rate limit meters.
- `Workbench.svelte`: Multi-project container with project cards, 7-tier role matrix, and API key generator.
- `SybilModal.svelte`: 5-layer anti-sybil modal with PKCE GitHub login, trust score meter, and ephemeral sandbox toggle.
- `ApiDocs.svelte`: Split 7/5 layout with endpoint documentation, request sandbox, multi-language snippets, and zero-server client-side exports.
