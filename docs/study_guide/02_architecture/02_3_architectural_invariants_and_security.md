# Chapter 2.3: Architectural Invariants and Security








## 1. Introduction








In a system designed to pool and route thousands of highly sensitive, high-value API keys, trust is paramount.
A single security breach or mathematical rounding error can destroy the economic equilibrium of the collective and result in massive financial liability. 








To prevent this, the Key Collective architecture is governed by five **Non-Negotiable Architectural Invariants**.
These are not merely guidelines; they are strict engineering laws.
Any code change that violates these invariants will fail the mandatory quality gates (`make gate`) and will be rejected.








This chapter details each invariant, its justification, and its technical implementation.








## 2. Invariant 1: No Plaintext Keys (AES-256-GCM)








**The Rule:** A raw API key must never exist in plaintext in any persistent storage (D1 database, KV, or DO storage).








### 2.1 The Threat Model
If the D1 database is compromised, dumped, or accidentally logged, exposed plaintext keys would allow attackers to bypass the Key Collective and directly rack up millions of dollars in charges on the tenants' accounts.








### 2.2 The Implementation
All keys are encrypted at the edge immediately upon ingestion using the Web Crypto API.
- **Algorithm:** AES-256-GCM (Galois/Counter Mode).
- **Nonce:** A unique, cryptographically secure 12-byte nonce (`crypto.getRandomValues`) is generated for *every single key*.
- **Storage:** The ciphertext and the 12-byte nonce are stored together in the database. The master encryption key (the symmetric secret) is provided to the Workers via secure environment variables (`env.MASTER_KEY`) and is never committed to code or stored in the database.








When a KeyPoolDO selects a key for routing, it passes the ciphertext and nonce back to the stateless Proxy Worker.
The Proxy Worker decrypts the key in memory, uses it for the upstream HTTP request, and allows the garbage collector to immediately wipe the plaintext key from RAM.








## 3. Invariant 2: Strict Per-Tenant DO Isolation








**The Rule:** A TenantQuotaDO must only contain state, memory, and execution context for a single tenant.
Zero cross-tenant state is permitted.








### 3.1 The Threat Model
Memory leakages or logical bugs in a shared multi-tenant memory space could result in "Cross-Tenant Contamination," where Tenant A is billed for Tenant B's usage, or Tenant A gains access to Tenant B's trust score parameters.








### 3.2 The Implementation
We enforce strict isolation at the infrastructure level using Cloudflare's DO namespace instantiation:
```typescript
// The ONLY allowed way to instantiate or communicate with a Tenant DO
const tenantId = request.headers.get("X-Tenant-ID");
const doId = env.TENANT_QUOTA.idFromName(tenantId);
const tenantStub = env.TENANT_QUOTA.get(doId);
```
Because the `idFromName` derivation mathematically guarantees a unique execution environment per `tenantId`, it is physically impossible for the runtime of Tenant A to access the memory heap of Tenant B.
This provides hard sandbox isolation equivalent to microVMs.








## 4. Invariant 3: Fixed-Point Microdollars (int64)








**The Rule:** All financial, cost, and quota calculations must use integer arithmetic representing microdollars (`µ$`).
Floating-point math (`float`, `double`) is strictly forbidden for financials.

### 4.1 The Threat Model
The IEEE 754 floating-point standard cannot accurately represent base-10 decimals (e.g., `0.1 + 0.2 === 0.30000000000000004`).
In a system processing billions of micro-transactions a day, floating-point drift will cause the Credit/Debt equilibrium (\(\sum_{i=1}^{N} \text{NP}_i \equiv 0\)) to diverge, creating ghost money or destroying real value.

### 4.2 The Implementation
1 USD is defined as 1,000,000 `µ$` (microdollars).
If an OpenAI GPT-4o request costs $0.0015, it is recorded as `1500` `µ$`.
All variables tracking debt, credit, and costs must be typed as `int64` (or `BigInt` in TypeScript if exceeding safe integer bounds, though standard JS numbers are safe up to \(9 \times 10^{15}\) microdollars, which is over $9 billion USD).
No division operations are permitted on cost integers unless explicitly bounded with `Math.floor()`.









## 5. Invariant 4: Transactional DO Storage for Hot State








**The Rule:** In-memory state mutations critical to the economic equilibrium (quotas, RPM counters) must be synchronized to the DO's transactional storage (`this.ctx.storage`).
D1 is strictly for persistence and cold analytical rollups.








### 5.1 The Threat Model
If a DO crashes or is migrated by the orchestrator, its memory heap is destroyed.
If the debt counter was only in memory, the tenant gets free requests, breaking the equilibrium.
If we try to write hot state directly to D1 on every request, the SQLite global lock will bottleneck the entire edge, violating the <15ms latency budget.








### 5.2 The Implementation
State mutations happen instantly in memory, followed by asynchronous, coalesced commits to `this.ctx.storage`. 
Cloudflare DO storage is locally attached to the actor and provides strictly serializable transactions.
If the DO is relocated, Cloudflare guarantees the `ctx.storage` is fully hydrated at the new location before a single request is accepted.








## 6. Invariant 5: Non-Blocking Telemetry








**The Rule:** Telemetry, logging, and analytics data extraction must never block the proxy hot path.








### 6.1 The Threat Model
Logging to external observability platforms (Datadog, Sentry, or even internal D1 analytics tables) requires network I/O.
If the proxy worker awaits this network I/O before returning the HTTP 200 response to the client, a slowdown in the logging provider will degrade the latency of the entire Key Collective.








### 6.2 The Implementation
All high-frequency telemetry streams use the **Workers Analytics Engine** or the `ctx.waitUntil()` construct.








```typescript
export default {
  async fetch(request, env, ctx) {
    // 1.
Critical hot-path execution
    const response = await handleProxyRequest(request, env);
    
    // 2.
Non-blocking telemetry (NEVER awaited in the hot path)
    ctx.waitUntil(
      recordTelemetry(request, response, env)
    );
    
    // 3.
Immediate return
    return response;
  }
}
```
This guarantees that the client receives their AI generation payload in the absolute theoretical minimum time, while the edge worker continues to flush analytics in the background.








## 7. Conclusion








These five invariants form the constitutional bedrock of the Key Collective's engineering culture.
By cryptographically securing keys, isolating execution per tenant, mandating precise integer math, leveraging local DO storage, and decoupling telemetry, the architecture guarantees a secure, zero-drift, low-latency environment capable of safely operating a communal API economy.
