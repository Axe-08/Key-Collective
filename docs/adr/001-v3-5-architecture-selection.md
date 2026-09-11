# ADR 001 (v3.5): Clean Edge Triple-Subdomain Routing, Two-Phase Identity & Svelte 5 Native DOM

## Status
Accepted (Inception Board v2.0 - Round 2 Sign-off)

## Context
Key Collective operates as a low-latency Cloudflare Edge reverse proxy multiplexing free-tier LLM API keys (Gemini, Groq, Cerebras, DeepSeek). Browser automation and visual auditing of the v3 deployment identified critical architectural needs:
1. **Structural Layout Fidelity:** The live site lost the fixed 256px `SideNavBar` edge rail, 8/4 dashboard grid, and 7/5 API docs split, resulting in a squished layout.
2. **Identity & Governance:** Email ingress requires a sandboxed `probationary` tier, elevated to `builder`/`max` only upon GitHub OAuth PKCE verification.
3. **Hidden Tiers & Admin Isolation:** High-throughput tiers (`ultra`, `admin`) must be obscured from public view. The platform requires a dedicated administrative surveillance plane to monitor tenant spend and override quotas.

## Decision
1. **Host Routing via Subdomains on a Single Cloudflare Worker:**
   - `api.key-col.axe08.tech`: High-performance proxy hot path (`/v1/*`, `/health`). Zero static HTML or assets overhead.
   - `console.key-col.axe08.tech`: Developer Console SPA (Pool, Workbench, Docs, Sybil modal).
   - `admin.key-col.axe08.tech`: Internal Admin Surveillance Panel. Edge worker returns **HTTP 404 Not Found** to non-admin visitors (zero-knowledge existence denial).
   - `key-col.axe08.tech`: Apex redirect to `console.key-col.axe08.tech`.

2. **Frontend Framework: Svelte 5 (Runes) + Tailwind v4 `@theme`:**
   - Retain Svelte 5 because its template syntax is 100% native HTML. This allows direct 1:1 copy-pasting of Stitch HTML markup without the error-prone translation overhead of converting 2,500+ SVG attributes to JSX.
   - Inject the full Material 3 color palette into `ui/src/app.css` under `@theme` and link Google Fonts in `ui/index.html`.

3. **Two-Phase Identity Ingress:**
   - Phase 1: Email/Gmail signup creates a D1 record in `tier = 'probationary'` (2 RPM, 50 RPD, 50k µ$ budget cap, Turnstile challenge).
   - Phase 2: GitHub OAuth 2.0 PKCE executes 5-layer sybil verification (account age $\ge 60$d, $\ge 15$ commits, clean domain, `UNIQUE(github_user_id)`). Promotes account to `builder` or `max`.

4. **Hidden Tier Invariant & RBAC:**
   - Public schemas completely scrub `ultra` and `admin`. Client attempts to mutate to `ultra` return HTTP 400.
   - Only admins can grant `ultra`. The initial admin account is bootstrapped via D1 seed and `ADMIN_EMAILS` worker secret.

## Consequences
- **Positive:** Absolute zero-knowledge isolation of administrative controls, sub-40KB total frontend bundle, byte-for-byte visual parity with Stitch, and complete immunity against automated Sybil quota drain.
- **Negative:** Requires managing multi-domain routing in `wrangler.jsonc` and testing host-based routing during local development.
