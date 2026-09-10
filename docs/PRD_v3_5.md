# Product Requirements Document (PRD v3.5)
## Key Collective: SOTA Obsidian Edge Glassmorphism & Complete Governance Overhaul

**Author:** Product Engineer (Inception Board)  
**Status:** Approved by User  
**Target Release:** v3.5 Production  
**Target Repository:** `Axe-08/Key-Collective` (`master`)  

---

## 1. Executive Summary & Why Now
Key Collective provides an edge-native, zero-cold-start AI key virtualizer and quota multiplexer running on Cloudflare Workers and Durable Objects. 

While the backend actor routing, Web Crypto AES-256-GCM encryption, and fixed-point microdollar financial accounting are battle-tested, the frontend user experience suffered from:
1. Flat, generic styling without real glassmorphism lighting (diffused shadows, specular border highlights, radial backdrop blur).
2. Routing mismatch between SvelteKit conventions and the Vite SPA runtime (`main.ts` mounting `App.svelte`).
3. Incomplete API documentation without an interactive sandbox or multi-language code snippets.
4. Non-integrated GitHub OAuth PKCE flow and 5-layer anti-sybil verification gate in the UI.

Version 3.5 bridges this gap by directly porting the Stitch-generated **"Obsidian Edge"** design system across all 4 core screens, establishing complete parity with modern developer tooling benchmarks (Stripe, Resend, Google AI Studio).

---

## 2. Core User Personas
1. **The Autonomous AI Systems Developer:** Needs reliable, uninterrupted multi-model API access across free & paid tiers (Gemini Flash, Groq LLaMA 3.3, Cerebras, DeepSeek) with sub-25ms routing latency and zero plaintext key exposure.
2. **The Engineering Lead / Team Admin:** Requires strict multi-project hierarchy (`User -> Projects -> Scoped Keys`), microdollar spend caps, and 7-tier role-based access control.
3. **The Guest / Evaluator:** Wants to test the edge router immediately via a 15-minute ephemeral sandbox (`DemoDO`) without OAuth or credit card friction.

---

## 3. The Scope Guillotine (Strict Boundary Invariant)

### In-Scope (v3.5)
- **Obsidian Edge Design System:** Complete injection of charcoal black `#090B10`, specular silver highlights `rgba(255, 255, 255, 0.08)`, frosted glass cards (`backdrop-blur-xl`), and typography (`Geist` + `JetBrains Mono`).
- **Screen 1 (Dashboard / Key Pool):** Real-time key health badges, pool RPM telemetry, obfuscated key table with copy actions, manual key drawer, and live log stream.
- **Screen 2 (Developer Workbench):** Multi-project hierarchy cards, 7-tier role matrix, project-scoped key provisioning, and budget sub-caps.
- **Screen 3 (GitHub OAuth & 5-Layer Anti-Sybil Gate):** Modal with GitHub OAuth PKCE challenge, real-time trust score meter, 5-layer verification breakdown, and 15-minute ephemeral sandbox trigger.
- **Screen 4 (API Docs & Playground):** Split 7/5 layout, full endpoint specs, parameter tables, fixed-point microdollar pricing matrix ($1 = 1,000,000 µ$), interactive request sandbox with SSE stream preview, multi-language snippets (cURL, TS, Python), and client-side doc export (Markdown `.md` + Print to PDF).

### Out-of-Scope (Deferred to v4.0)
- Native Stripe billing integration for paid microdollar credit top-ups (handled via manual token limits in v3.5).
- WebSockets bidirectional streaming proxy (SSE HTTP streaming satisfies all v3.5 LLM chat models).
- Self-hosted multi-region Kubernetes deployments (strictly Cloudflare Workers & Durable Objects edge-native).

---

## 4. EDD Golden Benchmark Criteria
1. **Visual Fidelity SLA:** 100% component fidelity with Stitch designs in `docs/stitch_designs/`.
2. **Single-Page Bundle Performance:** Total SPA bundle size < 250 KB gzip, initial load < 200ms on global edge CDN.
3. **Interactive Sandbox Latency:** Sandbox requests to `/v1/chat/completions` execute with < 30ms proxy overhead.
4. **Client-Side Export SLA:** Zero server roundtrips for Markdown download and PDF export generation.
5. **Quality Gate:** Passes `make gate` (lint, typecheck, test suites) in < 10 seconds.
