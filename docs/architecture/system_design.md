# System Design Document: Key Collective v4.0

**Version:** 4.0
**Date:** 2026-09-19
**Status:** Approved — PoolCoordinatorDO Singleton & Decoupled Subsystems
**Archetype:** fintech-compliance

## 1. Executive Summary
Key Collective v4.0 introduces a fundamentally decoupled architecture, moving from a monolithic worker pattern to a distributed, actor-model topology powered by Cloudflare Durable Objects. 
This version hardens multi-tenant isolation, implements a high-performance TenantQuotaDO debt engine, and ensures strict zero-leak security invariants through HKDF encryption and streaming error sanitization. Furthermore, the UI has been entirely decoupled into focused Svelte 5 components with real API wiring and a live OAuth callback integration.

## 2. Component Topology

```mermaid
flowchart TD
    Client((Client / Developer)) -->|"OpenAI-compat API"| Edge[Cloudflare Worker Gateway<br/>api.key-col.axe08.tech<br/>src/worker/gateway]
    ConsoleClient((Browser SPA)) -->|"console.key-col.axe08.tech"| Console[Console Worker<br/>Svelte 5 SPA / Static Assets<br/>ui/src]
    
    Edge --> Auth[Auth Subsystem<br/>JWT / Bearer verify + D1 lookup<br/>src/worker/auth]
    Auth --> D1[(D1 Database<br/>key-collective-d1<br/>src/storage/repositories)]
    Auth --> Router[CascadeRouter<br/>Dynamic Priority & Capability Filter<br/>src/router/cascade]
    
    Router -->|"Own keys available?"| TenantKeyPoolDO[KeyPoolDO<br/>Per-tenant isolation<br/>env.KEY_POOL.idFromName(tenantId)]
    Router -->|"Own keys exhausted?"| DebtCheck[TenantQuotaDO Debt Check<br/>debt <= 1.0x threshold?<br/>src/quota/tenant]
    DebtCheck -->|"Eligible"| PoolCoordinatorDO[PoolCoordinatorDO<br/>Global Singleton<br/>env.POOL_COORDINATOR<br/>src/durable_objects]
    DebtCheck -->|"Jailed"| QuotaJailReject[429 Quota Jail Response]
    
    TenantKeyPoolDO -->|"HKDF decrypt key"| UpstreamProvider[Upstream LLM Provider<br/>OpenAI / Anthropic / Groq]
    PoolCoordinatorDO -->|"Select optimal community key"| UpstreamProvider
    
    Edge -->|"ctx.waitUntil"| Analytics[Workers Analytics Engine<br/>Non-blocking Telemetry Streams]
    Edge -->|"/report endpoint"| TakedownPortal[Takedown Portal & Abuse Handler]
    
    subgraph DemoDO["Demo Sandbox"]
        DemoDO_obj[DemoDO<br/>Ephemeral 25 RPD shared pool<br/>src/auth/demo]
    end
    
    Router -->|"Unauthenticated"| DemoDO_obj
```

## 3. Decoupled Subsystem Architecture

The monolithic structure has been modularized into highly cohesive, loosely coupled domain packages:

| Subsystem Path | Primary Responsibility | Key Files / Entrypoints |
|---|---|---|
| `src/worker/gateway/` | Edge HTTP routing, CORS preflight, subdomain triage (`api.*`, `console.*`, `admin.*`) | `gateway.ts`, `router.ts` |
| `src/worker/auth/` | Token verification, RFC 5321 email validation, live OAuth callback handling, session token lifecycle | `auth_middleware.ts`, `session.ts`, `oauth.ts` |
| `src/router/cascade/` | Dynamic priority routing (`own > debt > parasite > hero`), fallback cascade | `cascade_router.ts`, `resolver.ts` |
| `src/router/capability/` | Model capability filtering (context window, tool calling, vision) | `capability_filter.ts` |
| `src/durable_objects/` | Core actors: Per-tenant `KeyPoolDO`, global `PoolCoordinatorDO`, and rate-limiting infrastructure | `key_pool.ts`, `pool_coordinator.ts` |
| `src/quota/tenant/` | Enforces sliding-window RPM and tracks debt in `TenantQuotaDO` | `tenant_quota.ts` |
| `src/proxy/sse/` | Streaming token counter and zero-leak error sanitizer (`createErrorSanitizerTransform`) | `sse_transformer.ts`, `sanitizer.ts` |
| `src/proxy/upstream/` | Upstream provider HTTP client, retry backoff, latency metrics | `upstream_client.ts` |
| `src/crypto/encryption/` | HKDF per-tenant key derivation & Web Crypto AES-256-GCM | `encryption.ts`, `hkdf.ts` |
| `src/storage/repositories/` | D1 transactional repositories (`api_keys`, `auth_tokens`, `cost_ledger`) | `api_keys.ts`, `auth_tokens.ts`, `cost_ledger.ts` |
| `ui/src/lib/` | Decoupled Svelte UI components fully wired to real APIs | `workbench/`, `api_docs/`, `playground/`, `admin/` |

## 4. DO Topology & Responsibilities

### KeyPoolDO (`env.KEY_POOL.idFromName(tenantId)`)
- **Strict Tenant Isolation:** Stores per-tenant in-memory state: RPM counter, circuit breaker, active key list. Guaranteed zero cross-tenant state.
- **Key Decryption:** Handles HKDF decryption securely at runtime; holds decrypted keys only ephemerally in-memory.
- **Dispatching:** Routes requests to upstream providers, records latency and token counts.
- **Durability:** Syncs circuit breaker state to `ctx.storage` to survive DO eviction.

### PoolCoordinatorDO (`env.POOL_COORDINATOR.idFromName("global")`)
- **Global Coordination:** Single global singleton for communal key pooling and cross-tenant capacity exchange.
- **Dynamic Priority Dispatch:** Selects optimal key using rules: `own > debt > parasite > hero`.
- **Traffic Shaping:** Implements Anomalous Spiker Brake (35% cap) via per-tenant traffic share tracking.
- **Ephemeral Access:** Does NOT hold raw key material; it only coordinates selection and delegates ephemerally.

### TenantQuotaDO (`env.TENANT_QUOTA.idFromName(tenantId)`)
- **Debt Engine:** Enforces sliding-window RPM and daily token quotas.
- **Fixed-Point Financials:** Maintains reciprocal debt ledger strictly in fixed-point microdollars (`int64`, 1 USD = 1,000,000 µ$) to prevent floating-point inaccuracies.
- **Enforcement:** Soft warning at 1.0x debt ratio, hard jail at 1.5x.

### DemoDO (`env.DEMO_POOL.idFromName("global")`)
- **Ephemeral Sandbox:** Serves unauthenticated Demo Mode capped at 25 RPD per IP. No persistent storage.

## 5. Security & Cryptographic Invariants

1. **Zero Plaintext Keys:** Keys are never stored or logged in plaintext. We enforce AES-256-GCM encryption via Web Crypto API with unique 12-byte nonces stored alongside ciphertext in D1.
2. **HKDF Per-Tenant Key Derivation:** Master secret $K_{\text{master}}$ is combined with `tenantId` via HKDF:
   $$K_{\text{tenant}} = \text{HKDF-SHA256}(K_{\text{master}}, \text{salt}=\text{tenantId}, \text{info}=\text{"key-collective-aes-key"})$$
   $K_{\text{tenant}}$ is never persisted; derived ephemerally per request.
3. **Zero-Leak Streaming Error Sanitization:** The `createErrorSanitizerTransform` pipeline intercepts HTTP $\ge 400$ responses from upstream. It comprehensively strips out provider keys, internal URLs, and sensitive error traces before the stream exits the edge.
4. **Live OAuth Integration & Session Isolation:** Real OAuth callbacks are integrated at `/api/auth/github/callback`. Tokens are synced to D1, enforcing strict per-tenant boundaries and full session purges on logout.
5. **Anti-Sybil Turnstile:** Cloudflare Turnstile token validation and forced-error GCP project hash verification prevent duplicate fake key generation.
6. **Telemetry & Latency:** High-frequency non-blocking telemetry streams via Workers Analytics Engine (`ctx.waitUntil`). The proxy hot path is never blocked on D1 writes.
