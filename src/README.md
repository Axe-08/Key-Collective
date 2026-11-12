# Key Collective Source Architecture (`src/`)

This directory contains the Cloudflare Workers and Durable Objects backend implementation of Key Collective.

---

## 📁 Package & Module Layout

| Directory | Responsibility | Invariants & Patterns |
|---|---|---|
| [`src/contracts/`](file:///home/akshit/Projects/Key%20Collective/src/contracts) | Pure domain contracts, types, and telemetry interfaces | Zero dependencies on runtime or router |
| [`src/crypto/`](file:///home/akshit/Projects/Key%20Collective/src/crypto) | AES-256-GCM encryption, unique 12-byte nonces, PBKDF2/HKDF subkey derivation | Web Crypto API only; zero plaintext keys at rest |
| [`src/durable_objects/`](file:///home/akshit/Projects/Key%20Collective/src/durable_objects) | `KeyPoolDO`, circuit breakers, and rate limiters | Per-tenant compute isolation via `env.KEY_POOL.idFromName(tenantId)` |
| [`src/pool/`](file:///home/akshit/Projects/Key%20Collective/src/pool) | `PoolCoordinatorDO`, 35% surge emergency brake, and contributor capacity credits | Synchronizes communal provider pool states across isolates |
| [`src/quota/`](file:///home/akshit/Projects/Key%20Collective/src/quota) | `TenantQuotaDO` managing sliding window RPM/RPD limits | Durable transactional storage; integer CU accounting |
| [`src/proxy/`](file:///home/akshit/Projects/Key%20Collective/src/proxy) | Upstream HTTP client, SSE stream transformers, and cost settlement | 0ms added streaming latency; failover on 429/5xx |
| [`src/router/`](file:///home/akshit/Projects/Key%20Collective/src/router) | `CascadeRouter`, `ModelRegistry`, capability matching (`auto`, `smart-fast`, etc.) | Transparent fallback across providers |
| [`src/worker/`](file:///home/akshit/Projects/Key%20Collective/src/worker) | Gateway routing, subdomain triage (`api.*`, `console.*`, `admin.*`), auth middleware | Non-blocking telemetry via `ctx.waitUntil()` |
| [`src/storage/`](file:///home/akshit/Projects/Key%20Collective/src/storage) | D1 SQLite repository implementations | Prepared SQL statements; zero raw concatenated queries |

---

## ⚡ Architectural Principles

1. **Isolation of Hot-Path from Heavy Writes:** The OpenAI completions hot-path in [`src/worker/router/chat/`](file:///home/akshit/Projects/Key%20Collective/src/worker/router/chat/) serves client HTTP responses immediately and offloads credit consumption rollups and logging to `ctx.waitUntil()`.
2. **Deterministic Shard Addressing:** Global coordination in [`src/pool/coordinator_do.ts`](file:///home/akshit/Projects/Key%20Collective/src/pool/coordinator_do.ts) extracts the provider directly from the DO ID string (`pool:google`, `pool:groq`) without blocking on cold storage lookups.
3. **Fail-Closed Upstream Resilience:** If an upstream provider rate-limits (`429`), the key is quarantined for 60s, and the lease is automatically escalated to a sibling key or fallback candidate model without terminating client connections.
