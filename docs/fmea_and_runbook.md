# FMEA and Runbooks

## Front 4: Unit Economics (FMEA)
### Cost Ledger Event Dropped
*   **Failure:** Buffered channel for cost tracking is full and drops events.
*   **Business Impact:** Underbilling. If 1% of events drop at 10M req/mo (assuming $0.01 avg cost), loss is $1,000/mo. 
*   **Mitigation:** Use Cloudflare Queues for guaranteed delivery of cost events instead of simple in-memory channels.

### DO Eviction Causes Circuit Breaker State Reset
*   **Failure:** DO evicts, losing in-memory rate-limit trackers.
*   **Business Impact:** If 5% of requests hit rate-limited keys before state rebuilds, causing 429s, it degrades SLA. High impact on reliability, low direct financial cost.
*   **Mitigation:** DO must flush rate-limit states to its durable storage API on change, hydrating on startup.

### D1 Write Overage (Batch Logging Fails)
*   **Failure:** Batch logging fails, falling back to per-request D1 writes.
*   **Business Impact:** Cloudflare D1 charges per write. 10M writes = $10.00. Batching 100-to-1 reduces this to $0.10. Overage cost is small ($10/mo) but scale could amplify it.
*   **Mitigation:** Implement aggressive exponential backoff for batch writes. Drop logs before falling back to per-request writes if cost is strict.

### Container Cold Start (1-3s)
*   **Failure:** Traffic spikes trigger a cold start of the Go container.
*   **Business Impact:** 1-3s latency violates the <50ms P95 SLA. If this happens to 0.1% of requests at 10M req/mo, 10,000 requests suffer high latency.
*   **Mitigation:** Keep a warm pool of minimum instances or use Cloudflare Workers for the entire path if AES/SSE can be optimized in WASM.

### AES-256-GCM on 1/16 vCPU (Go Container)
*   **Failure:** Decryption takes too long on constrained CPU.
*   **Business Impact:** Consumes latency budget, reducing concurrent request capacity. 
*   **Mitigation:** Benchmark `crypto/cipher` on 1/16 vCPU. It typically handles MBs per second, so a 100-byte key should decrypt in < 1ms, fitting the budget.

## Front 5: Runbooks

### Runbook 1: SSRF / Malicious Upstream URL Detected
1. **Identify:** Review Cloudflare Analytics Engine logs for egress to non-standard domains.
2. **Mitigate:** Immediately patch the Container's allowed domain list. Redeploy via CI.
3. **Audit:** Query D1 `model_registry` table for any unauthorized upstream URLs. Delete them.
4. **Post-Mortem:** Determine how the registry was tampered with (API vulnerability or compromised admin token).

### Runbook 2: All Provider Keys Rate-Limited (Systemic 429)
1. **Identify:** DO circuit breaker metrics show `OPEN` state for a specific provider (e.g., Anthropic).
2. **Mitigate:** Check provider status page. If the provider is up, verify billing status and key limits.
3. **Recover:** If keys are permanently disabled, generate new keys, encrypt them, and insert them into D1.
4. **Action:** Send a DO RPC command to flush the in-memory cache and re-hydrate keys from D1.

### Runbook 3: Cryptographic Key Compromise
1. **Identify:** Suspected exposure of the Master AES-256-GCM key.
2. **Mitigate:** Shut down the proxy container traffic (route to maintenance page) to prevent unauthorized decryption.
3. **Recover:** Rotate the Master Key in Cloudflare Secrets.
4. **Remediate:** All existing keys in D1 are invalid. Tenants must provide new API keys. Wipe the `keys` table in D1.

### Runbook 4: DO Eviction Loop (OOM / Thrashing)
1. **Identify:** DO error rate spikes; logs show "Exceeded Memory Limit".
2. **Mitigate:** The DO state is too large (likely holding too many keys in memory). 
3. **Recover:** Push an emergency configuration to the Worker to route traffic away from the affected DO shard.
4. **Action:** Refactor DO to shard by Tenant ID rather than maintaining a global key pool.
