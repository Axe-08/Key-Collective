# Key Collective AI Constitution (v2)

## 1. Language & Runtime
- **TypeScript (strict mode, no `any`)** on Cloudflare Workers & Durable Objects.

## 2. Non-Negotiable Architectural Invariants
- **No Plaintext Keys:** AES-256-GCM encryption via Web Crypto API with unique 12-byte nonces stored alongside ciphertext in D1.
- **Per-Tenant DO Isolation:** `env.KEY_POOL.idFromName(tenantId)` ensures strict tenant compute & memory isolation. Zero cross-tenant state.
- **Fixed-Point Microdollars:** All costs in `int64` microdollars (1 USD = 1,000,000 µ$). Zero floating-point math for financials.
- **DO Transactional Storage for Hot State:** In-memory circuit breaker and RPM counters must sync to `this.ctx.storage` (survives eviction). D1 is for persistence & rollups.
- **Non-Blocking Telemetry:** High-frequency telemetry streams to Workers Analytics Engine. Never block the proxy hot path on D1 writes.
- **Strict Quality Gate:** All changes must pass `make gate` (<10s) before merge.
