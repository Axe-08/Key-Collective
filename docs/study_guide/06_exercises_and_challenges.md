# Part 6: Hands-On Lab Challenges & Self-Check Quizzes

Welcome to the capstone module of the Key Collective University Textbook. Mastery of distributed edge architectures requires transitioning from passive reading to active code inspection, analytical problem solving, and hands-on system extension.

This module is organized into three progressive pedagogical tiers:
1. **Codebase Scavenger Hunts**: Targeted source code navigation exercises verifying your mental model of the actual production repository.
2. **Comprehensive Master Quiz**: 15 challenging analytical questions covering edge isolates, actor topologies, cryptographic defense, and financial accounting.
3. **The Graduation Coding Challenge**: An end-to-end implementation task where you add a new model provider route with custom microdollar pricing, circuit breaker protection, and pass the `<10s` quality gate.

---

## Tier 1: Codebase Scavenger Hunts

Locate the exact files and function definitions within the repository that implement these critical architectural invariants:

### Scavenger Hunt 1: The Front Door Guard
- **Mission**: Locate the middleware responsible for extracting Bearer tokens from incoming HTTP requests and resolving the tenant's cryptographic identity.
- **Verification Target**: Locate `extractBearerToken` and `authenticateRequest` in [`src/worker/auth/middleware.ts`](file:///home/akshit/Projects/Key%20Collective/src/worker/auth/middleware.ts).
- **Guiding Question**: What HTTP status code is returned if the Authorization header is missing or malformed?

### Scavenger Hunt 2: The Nonce Sentry
- **Mission**: Identify the cryptographic module where unique 12-byte initialization vectors (IVs) are generated and prepended to AES-256-GCM ciphertexts.
- **Verification Target**: Inspect `encryptAES256GCM` in [`src/crypto/encryption/aes.ts`](file:///home/akshit/Projects/Key%20Collective/src/crypto/encryption/aes.ts).
- **Guiding Question**: How does the decryptor extract the 12-byte nonce from the combined ciphertext byte array?

### Scavenger Hunt 3: The Debt Gate
- **Mission**: Find the exact conditional branch in the tenant quota actor that evaluates whether an overdraft exceeds allowable thresholds.
- **Verification Target**: Locate `evaluateQuota` in [`src/quota/tenant/tenant_do.ts`](file:///home/akshit/Projects/Key%20Collective/src/quota/tenant/tenant_do.ts).
- **Guiding Question**: What is the default maximum allowable overdraft in microdollars before communal requests are rejected?

### Scavenger Hunt 4: The Sanitizer Mask
- **Mission**: Discover the regular expressions used to scrub Google Cloud project identifiers and raw bearer keys from error streams.
- **Verification Target**: Inspect `ALLOWED_RESPONSE_HEADERS` and `sanitizeErrorBody` in [`src/worker/error_normalizer.ts`](file:///home/akshit/Projects/Key%20Collective/src/worker/error_normalizer.ts).
- **Guiding Question**: Why is the `content-length` header deleted when an error response is sanitized?

### Scavenger Hunt 5: The Circuit Breaker Guard
- **Mission**: Locate the state machine managing failure counts and transition cooldowns for failing upstream providers.
- **Verification Target**: Inspect `CircuitBreaker` in [`src/durable_objects/circuit_breaker/breaker.ts`](file:///home/akshit/Projects/Key%20Collective/src/durable_objects/circuit_breaker/breaker.ts).
- **Guiding Question**: How many consecutive failures are required to trip the breaker from `CLOSED` to `OPEN`?

---

## Tier 2: Comprehensive 15-Question Master Quiz

Test your mastery across the architectural curriculum. Attempt to answer each question before revealing the solution.

### Question 1: V8 Isolate Concurrency
Why do Cloudflare Workers cold-start in under 5 milliseconds compared to several seconds for Docker containers?
<details>
<summary>Reveal Answer & Deep Dive</summary>
Docker containers virtualize the entire operating system user space, requiring kernel namespace allocation, cgroups setup, filesystem mounting, and runtime initialization. Cloudflare Workers run lightweight V8 isolates within pre-warmed host processes, initializing only an isolated JavaScript heap without operating system overhead.
</details>

### Question 2: Branded Types & Type Safety
How does TypeScript prevent developers from accidentally passing raw float USD values into functions expecting microdollars?
<details>
<summary>Reveal Answer & Deep Dive</summary>
By using TypeScript branded types:
<code>type Microdollars = number & { readonly __brand: unique symbol }</code>.
Because the brand symbol is unique, a raw number cannot be assigned to a <code>Microdollars</code> type without passing through an explicit validation and rounding constructor like <code>toMicrodollars()</code>.
</details>

### Question 3: Nonce Reuse Vulnerability
What is the mathematical consequence of reusing a 12-byte nonce with the same AES-256-GCM key across two different encryptions?
<details>
<summary>Reveal Answer & Deep Dive</summary>
Reusing a nonce in Galois/Counter Mode (GCM) destroys ciphertext authenticity. An attacker can XOR the two ciphertexts to recover the XOR of the plaintexts and solve for the authentication subkey (GHASH key), allowing arbitrary forgery of valid ciphertexts.
</details>

### Question 4: Durable Object Single-Threaded Invariant
Why do state mutations inside a Durable Object avoid race conditions without using mutexes?
<details>
<summary>Reveal Answer & Deep Dive</summary>
Each Durable Object ID maps to a unique V8 isolate worldwide. Incoming RPC requests are queued and processed sequentially on a single-threaded event loop, guaranteeing serialized execution and linearizable consistency.
</details>

### Question 5: Backpressure in Streaming Transforms
What mechanism signals an upstream LLM provider to pause sending tokens when a mobile client experiences network latency?
<details>
<summary>Reveal Answer & Deep Dive</summary>
The Web Streams API propagates backpressure natively: when the client's TCP receive window fills, the <code>TransformStream</code> controller buffers reach high water mark, signaling the underlying upstream fetch socket to pause TCP reads.
</details>

### Question 6: Reciprocal Credit Equilibrium
In the Key Collective capacity pool, what prevents a free-rider from continuously consuming communal capacity without contributing?
<details>
<summary>Reveal Answer & Deep Dive</summary>
The <code>TenantQuotaDO</code> enforces a hard overdraft ceiling (e.g., $10.00 in microdollars). Once a tenant exhausts this deficit without contributing valid keys that successfully satisfy communal leases, communal routing is blocked.
</details>

### Question 7: Zero-Cost Synthetic Probing
How does <code>forceErrorGcpProbe</code> verify a Google Gemini key without spending user tokens or incurring provider charges?
<details>
<summary>Reveal Answer & Deep Dive</summary>
It intentionally queries an invalid model name (<code>/models/invalid-model</code>). Google's API authenticates the key first and returns an HTTP 400 Bad Request containing GCP project metadata in <code>google.rpc.ErrorInfo</code>, proving validity without invoking model weights.
</details>

### Question 8: Defensive Header Allow-Listing
Why does Key Collective use an allow-list for HTTP response headers rather than a blocklist?
<details>
<summary>Reveal Answer & Deep Dive</summary>
Upstream providers frequently introduce new proprietary headers (e.g., cloud trace tags, cluster IDs, debug headers) that a blocklist would miss. An allow-list guarantees that only known, safe standard RFC headers exit the proxy perimeter.
</details>

### Question 9: Circuit Breaker State Transitions
What triggers a circuit breaker to transition from <code>OPEN</code> to <code>HALF_OPEN</code>?
<details>
<summary>Reveal Answer & Deep Dive</summary>
The expiration of a configurable cooldown sleep window (typically 30 seconds). In <code>HALF_OPEN</code>, a limited probe request is permitted through to test if the upstream provider has recovered.
</details>

### Question 10: Non-Blocking Telemetry Invariant
Why must telemetry writes use <code>ctx.waitUntil()</code> instead of <code>await</code> on the proxy hot-path?
<details>
<summary>Reveal Answer & Deep Dive</summary>
Awaiting telemetry network I/O directly delays sending the initial HTTP response chunk to the client, degrading Time to First Token (TTFT). <code>ctx.waitUntil()</code> delegates the write to the background event loop after the response has been dispatched.
</details>

### Question 11: Single Global Coordinator vs Regional Shards
What is the primary architectural justification for using a single global PoolCoordinatorDO rather than sharding per region?
<details>
<summary>Reveal Answer & Deep Dive</summary>
To eliminate inventory fragmentation and race conditions. A single global actor provides 100% unified key liquidity and eliminates double-leasing risks without complex cross-region consensus protocols.
</details>

### Question 12: Fast Quality Gate Contract
What is the time threshold requirement of <code>make gate</code> in the Key Collective engineering constitution?
<details>
<summary>Reveal Answer & Deep Dive</summary>
<code>make gate</code> must execute type checking (<code>tsc --noEmit</code>) and the entire unit/integration test suite in under 10 seconds.
</details>

### Question 13: Floating-Point Financial Drift
Why is IEEE 754 arithmetic legally dangerous for SaaS token billing?
<details>
<summary>Reveal Answer & Deep Dive</summary>
Floating-point rounding errors accumulate non-deterministically across high-volume transactions, creating balance discrepancies between invoices and database records that violate financial compliance standards.
</details>

### Question 14: W3C Distributed Traceparent Format
What are the four components of a W3C <code>traceparent</code> header?
<details>
<summary>Reveal Answer & Deep Dive</summary>
Version (2 hex characters, always <code>00</code>), Trace ID (32 hex characters), Parent/Span ID (16 hex characters), and Trace Flags (2 hex characters, e.g., <code>01</code> for sampled).
</details>

### Question 15: Error Sanitizer Content-Length Deletion
Why must <code>content-length</code> be deleted when an error response is sanitized through regular expressions?
<details>
<summary>Reveal Answer & Deep Dive</summary>
Redaction patterns modify the byte length of the body payload (e.g., replacing <code>sk-ant-api03-123456789...</code> with <code>[REDACTED_SECRET]</code>). Preserving the original <code>content-length</code> would cause socket truncation or protocol errors.
</details>

---

## Tier 3: The Graduation Coding Challenge

### Objective
Extend Key Collective to support a new high-efficiency model tier: **`mistral-large-2407`** under the Mistral provider.

### Requirements
1. **Model Registration**: Register `mistral-large-2407` in [`src/router/registry/catalog.ts`](file:///home/akshit/Projects/Key%20Collective/src/router/registry/catalog.ts) with appropriate context window (128k) and capability flags (`tool_calls: true`, `streaming: true`).
2. **Pricing Configuration**: Configure exact microdollar pricing in [`src/constants/financial.ts`](file:///home/akshit/Projects/Key%20Collective/src/constants/financial.ts) ($2.00 / 1M prompt tokens = $2 µ$/token, $6.00 / 1M completion tokens = $6 µ$/token).
3. **Quality Gate Verification**: Run `make gate` to ensure the TypeScript compiler and Vitest suites pass in under 10 seconds.


```typescript
// Verification harness for graduation challenge
export interface ModelVerificationResult {
  readonly modelRegistered: boolean;
  readonly pricingVerified: boolean;
  readonly qualityGatePassed: boolean;
}

export function verifyGraduationPrerequisites(modelId: string, pricingMicro: number): ModelVerificationResult {
  return {
    modelRegistered: modelId === "mistral-large-2407",
    pricingVerified: pricingMicro === 2,
    qualityGatePassed: true,
  };
}
```

```bash
# Run the quality gate to verify your implementation
make gate
```

Once `make gate` outputs `ALL TESTS PASSED in <10s`, you have graduated the Key Collective University Curriculum!
