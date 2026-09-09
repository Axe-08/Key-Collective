# 05 Idioms, Patterns, and Trade-offs

Every codebase has a "grain" to it—a set of established patterns that dictate how problems should be solved. Fighting the grain leads to technical debt, confusing bug reports, and difficult migrations; working with it leads to maintainable, robust, and predictable software.

This document outlines the core engineering patterns that define Key Collective v2. It also candidly documents the architectural trade-offs we accepted, because no system is perfect, and understanding the weaknesses is just as important as understanding the strengths.

## Core Engineering Patterns

### Pattern 1: Per-Tenant Actor Isolation via Durable Objects

In standard Node.js/Express applications, state is global or request-scoped. In Key Collective, state is **tenant-scoped**. We natively use the Actor Model pattern, implemented via Cloudflare Durable Objects.

Whenever you need to interact with a tenant's data (their keys, their limits, their spend), you do not query a central database and mutate a global cache. Instead, you route the request to the tenant's specific `KeyPoolDO` using `env.KEY_POOL.idFromName(tenantId)`.

This creates strict memory isolation. If Tenant A manages to crash their DO due to an edge-case bug, Tenant B is completely unaffected because they exist in an entirely different memory space. This is a massive reliability win.

### Pattern 2: Transactional Storage Hydration & Survivability

Durable Objects can be evicted from memory by Cloudflare at any time to manage cluster resources. Therefore, you can never assume that class properties will survive indefinitely in RAM.

The pattern for hot state (like RPM counters or the `CircuitBreakerState`) is to hydrate from `this.ctx.storage` on instantiation, and to periodically sync mutations back to storage.

```typescript
// The Hydration Pattern
export class KeyPoolDO {
  private totalTokensConsumed = 0;

  async fetch(request: Request) {
    // 1. Hydrate if necessary. We use blockConcurrencyWhile to ensure
    // we don't process requests while state is still loading.
    this.ctx.blockConcurrencyWhile(async () => {
      this.totalTokensConsumed = await this.ctx.storage.get("tokens") || 0;
    });
    
    // 2. Mutate in memory for extreme speed. We avoid awaiting DB writes here.
    this.totalTokensConsumed += 100;
    
    // 3. Flush to transactional storage asynchronously to survive eviction.
    // The DO environment guarantees this will complete before eviction.
    this.ctx.storage.put("tokens", this.totalTokensConsumed);
    
    return new Response("OK");
  }
}
```
`this.ctx.storage` is transactional and durable. D1 is used for analytics and long-term persistence, but `ctx.storage` is the single source of truth for the DO's immediate operational state.

### Pattern 3: Fixed-Point Microdollar Arithmetic

Never, ever use standard JavaScript floating-point numbers to calculate costs. IEEE-754 floats will inevitably introduce drift, and your billing ledgers will become corrupted.

Every data contract (`KeyPoolContract`, `RouterContract`, `ModelPricing`, `TenantSpendSummary`) that references money must rigidly use the microdollar pattern. 
1 USD = exactly 1,000,000 microdollars.

If a model costs $2.50 per million tokens, the configuration should store `2500` (which represents the cost of 1000 tokens in microdollars). All aggregations, subtractions, and budget limits must be calculated strictly as `int64` integers.

### Pattern 4: Non-blocking Edge Telemetry

When proxying LLM requests, latency is the primary metric users care about. We absolutely cannot block the response stream to wait for a database insert or a logging network call to complete.

Any operation that does not strictly need to complete before the user receives their response must be wrapped in `ctx.waitUntil()`. This signals to the Cloudflare runtime that the worker should stay alive to finish the background task even after the HTTP response has already been sent to the client.

We use the `TelemetryContract` to define strict schemas for what we log, and the `TelemetryEmitter` pushes these events using `waitUntil`.

```typescript
// The Non-blocking Telemetry Pattern
export function handleRequest(request: Request, env: Env, ctx: ExecutionContext) {
  const response = performComplexRoutingLogic();
  
  // Do NOT await this! The user shouldn't wait for our analytics.
  ctx.waitUntil(
    env.ANALYTICS_QUEUE.send({
      tenantId: "123",
      latencyMs: 450,
      timestamp: Date.now()
    })
  );
  
  // Return immediately to the client
  return response;
}
```

### Pattern 5: Zero-Plaintext Cryptographic Invariant

This is a non-negotiable security invariant. A plaintext API key must never exist in persistent storage, and it must never be logged to any observability platform.

We use AES-256-GCM via the Web Crypto API. The pattern requires generating a cryptographically secure, unique 12-byte CSPRNG nonce for every single encryption operation. The nonce is stored alongside the ciphertext. 

The `AuthContract` enforces that any key payload leaving the system boundary is redacted (e.g., `sk-ant-api03-...abcd`). Plaintext keys only exist in the exact local scope where `fetch()` is called inside the `UpstreamClient`. They must not be attached to classes or global objects.

### Pattern 6: Zero-Tautology Error Messages

Do not write error messages that merely restate the code. For instance, throwing `Error("Failed to fetch")` from a `fetch()` call is a tautology and useless for debugging. 

Our pattern dictates that errors must include the *intent*, the *cause*, and the *resolution* if possible. Always wrap upstream errors with context about what the router was attempting to achieve.

```typescript
// Bad
throw new Error("D1 insert failed");

// Good
throw new Error(`Failed to persist ledger for tenant ${tenantId}. Cause: D1 uniqueness constraint violation. Ensure nonces are not reused.`);
```

### Pattern 7: Defensive Default Fallbacks

When configurations are missing or D1 lookups fail unexpectedly, the system should not crash hard if a safe default exists. The `ModelRegistry` relies on safe default configurations to avoid breaking the routing pipeline if a specific pricing entry is accidentally deleted.

### Pattern 8: Integration Testing over Mocking

We rely heavily on Cloudflare's specific runtime APIs (`env.KEY_POOL.idFromName`). Mocking these extensively in Jest leads to tests that pass in CI but fail in production because the mock doesn't accurately represent the complex concurrency model of Durable Objects. 

We heavily bias towards integration testing using Miniflare, testing the actual HTTP proxy surface area rather than deeply mocking internal functions. This is our primary testing pattern.

### Pattern 9: Strong Type Guards for External Data

Data crossing the network boundary (either from a client or from an upstream AI provider) must never be trusted. We use Zod schemas to define strict boundaries. If an upstream provider sends a malformed `StreamUsage` block, the Zod parser will catch it and drop the invalid chunk, rather than propagating `NaN` into our billing ledgers.

```typescript
// Zod parsing example
const StreamUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

// Always parse, never cast using 'as'
const safeUsage = StreamUsageSchema.parse(rawJson);
```

### Pattern 10: Idempotent Ledger Writes

Because Cloudflare Workers can retry tasks internally when using Queues or `ctx.waitUntil()`, all writes to the D1 billing ledger must be idempotent. We include a unique idempotent UUID in every cost payload. If the write fails and is retried, the unique ID ensures we do not double-bill the tenant. This is a foundational distributed systems pattern that prevents silent financial corruption.

## Architectural Trade-offs Table

There is no free lunch in systems design. Every architectural decision carries a cost. Here are the deliberate trade-offs we accepted in Key Collective v2.

| Decision | What we gained | What we sacrificed (The Trade-off) |
| :--- | :--- | :--- |
| **In-memory DO vs Redis** | Zero-latency reads, strict tenant isolation, no external network hops for state. | DOs have a single point of concurrency per tenant. A single tenant cannot easily handle 10,000 concurrent requests without careful sharding logic, whereas Redis scales horizontally. |
| **D1 SQLite vs Postgres** | Native edge integration, zero connection pooling issues, globally distributed reads. | SQLite lacks advanced JSON indexing and concurrent write throughput compared to a tuned Postgres cluster. Writes are funneled through a single primary region, leading to write latency. |
| **Edge Streaming vs Buffering** | Unbeatable Time-To-First-Token (TTFT), extremely low memory footprint on the worker. | Calculating exact token usage requires custom stream interceptors (`SSEStreamTransformer`) because we can't just count the final string length. If the connection drops mid-stream, precise billing gets complicated. |
| **Strict TypeScript (`noImplicitAny`)** | Confidence in refactoring, self-documenting data contracts, far fewer runtime crashes. | Higher friction during rapid prototyping. You cannot simply pass arbitrary JSON objects around; everything must go through a validator first, slowing down initial development speed. |

## Beginner Traps and Gotchas

If you are new to this codebase, watch out for these very common pitfalls that have burned developers before:

1. **Awaiting `waitUntil`**: A common mistake is writing `await ctx.waitUntil(...)`. This defeats the entire purpose. `waitUntil` takes a promise, but you should not `await` the `waitUntil` call itself. It turns non-blocking code into blocking code.
2. **Floating Point Math in UI**: You might see microdollars in the backend, but forget to divide by 1,000,000 in the frontend UI. Always ensure the presentation layer formats the `int64` correctly, otherwise a $5.00 charge will display as a $5,000,000 charge.
3. **Global State in Workers**: Do not use `let` or `const` outside of the request handler to store tenant data. Workers are reused across requests. Global variables will leak data between different requests and entirely different tenants. Always use the Durable Object for state.
4. **Swallowing Upstream Errors**: When an LLM provider fails, do not just return a generic 500 status code. The `CascadeRouter` needs the specific status code (429 vs 500) to know whether it should retry the same provider later or switch entirely. Always propagate the specific error type to the routing layer.
5. **Ignoring Memory Leaks in Transforms**: If your `SSEStreamTransformer` maintains internal arrays that grow indefinitely during a stream, a sufficiently long AI response will OOM the edge worker. Ensure transformations are purely stream-based without unbounded accumulations.
6. **Bypassing the Contract Layer**: Bypassing the Zod validation in `src/contracts` by using `any` or `as type` is strictly forbidden. It defeats the type safety guarantees and re-introduces the class of runtime bugs we explicitly architected this system to eliminate.

By internalizing these patterns and trade-offs, you will write code that feels native to the Key Collective environment and avoids introducing systemic risk.

### Final Words
These patterns form the bedrock of the Key Collective architecture. Straying from them should only be done with significant, documented justification.
