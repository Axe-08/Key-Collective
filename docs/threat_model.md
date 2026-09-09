# Threat Model & Architecture Critique (v2.0)

## Front 1: Simplicity Challenge
### Can we use a simpler deterministic approach?
*   **KV Store vs D1 for Key Pool:** While a Cloudflare Worker KV store is simpler and offers low-latency reads, it suffers from eventual consistency (up to 60s propagation delay). For a distributed key pool that requires precise rotation, rate limit tracking, and immediate state invalidation upon 429s, eventual consistency would lead to concurrent requests burning rate-limited keys. D1 offers strong consistency necessary for the source of truth, though it adds latency.
*   **KV TTL for Circuit Breaker vs DO:** A KV TTL key is simple but eventual consistency makes it unsuitable for high-frequency distributed locks or circuit breakers. A Durable Object provides a single-threaded execution context, ensuring atomic state updates and consistent circuit breaker states globally.
*   **Minimum Viable Cloudflare-Native Architecture:** The absolute minimum would be a single Worker + KV for everything. However, to handle Go's requirement for SSE passthrough and AES decryption efficiently, the proxy container is justified if Wasm cannot be used.
*   **Premature Complexity:** The DO might be a bottleneck if not sharded per tenant or per provider. Using D1 for *every* read is premature; D1 should load keys into the DO's memory, which then serves requests.

## Front 2: Fragility (Upstream Failure Modes)
*   **All keys RateLimited:** The DO must immediately trip the provider-level circuit breaker and return a 429 to the client with a `Retry-After` header, avoiding further upstream calls until the cooldown expires.
*   **D1 Unavailable during Auth:** The Worker should cache validated tenant tokens in memory or KV (with a short TTL) to gracefully degrade during D1 outages. If a token isn't cached, requests will fail with 503.
*   **Container fails mid-SSE stream:** The client connection drops abruptly. Since the request reached the LLM, cost was incurred but might not be reported if the container crashes before the DO cost ledger updates. We need to ensure cost accumulation happens proactively or via reliable queues (e.g., Cloudflare Queues).
*   **DO Eviction during Burst:** When Cloudflare evicts a DO, the next request will instantiate it cold. If state isn't restored fast enough from D1, requests might stall or use stale rate limits. The DO must aggressively checkpoint critical state to its persistent storage and hydrate synchronously on startup.
*   **Pricing sync failure:** Fall back to the last known pricing in D1. The system must never block proxy requests for a pricing sync.

## Front 3: Latency Budget Dissection
### Call Stack Timing
*   **Worker auth + D1 token lookup:** 15ms (using D1 cache/read replica)
*   **Worker → DO RPC:** 5ms
*   **DO key selection + RPM check (in-memory):** < 1ms
*   **DO → Container dispatch:** 5ms
*   **Container AES-256-GCM decrypt:** 2ms
*   **Container → upstream LLM (network):** Excluded
*   **Container → SSE stream to client:** 5ms
*   **DO async cost ledger update:** 0ms (non-blocking)
*   **Total Proxy Overhead:** ~32-35ms.
*   **Target:** < 50ms P95 is achievable. The budget is primarily spent on intra-Cloudflare network hops (Worker -> DO -> Container) and D1 reads. Caching at the Worker layer is critical to maintain this.

## Front 5: Security & Injection Vectors
### 1. Prompt injection via crafted `model` field
*   **Severity:** Medium | **Likelihood:** Low
*   **Mitigation:** Strict allowlist validation of the `model` field against the D1 model registry in the Worker before passing to the DO.
*   **Action:** Enforce strict regex and length limits on model aliases.

### 2. SSRF via crafted upstream URL
*   **Severity:** Critical | **Likelihood:** Low
*   **Mitigation:** Container only routes to a hardcoded list of domains (e.g., `api.openai.com`, `api.anthropic.com`).
*   **Action:** Implement network egress filtering in the Container and strict URL parsing.

### 3. Timing attack on Bearer token comparison
*   **Severity:** High | **Likelihood:** Low
*   **Mitigation:** Unknown in v2 design.
*   **Action:** Ensure the Worker uses `crypto.subtle.timingSafeEqual` (Web Crypto API) for all token comparisons.

### 4. AES-256-GCM nonce reuse
*   **Severity:** Critical | **Likelihood:** Medium
*   **Mitigation:** Relies on proper DB schema and Go cryptography practices.
*   **Action:** Generate a random 12-byte nonce for *every* encryption operation using `crypto/rand`. Prepend the nonce to the ciphertext stored in D1.

### 5. Tenant data isolation
*   **Severity:** Critical | **Likelihood:** Medium
*   **Mitigation:** Unknown DO internal structure.
*   **Action:** Instantiate one DO *per tenant* instead of a global DO, or partition the in-memory state strictly by Tenant ID, enforcing tenant checks on every DO method.
