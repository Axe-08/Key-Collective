# Language Primitives and Idioms 101: TypeScript on V8 Isolates

Welcome to the trenches. Before we can talk about routing logic, load balancing algorithms, or cryptographic nonces, we must establish a firm, first-principles understanding of the ground we stand on. 

We write TypeScript, but we do not write it for Node.js. We write for Cloudflare V8 Isolates. If you treat an Isolate like a Node process, your code will be slow, your memory will leak, and your application will fail under load. The paradigms you learned building Express backends simply do not apply here.

## The Reality of V8 Isolates vs Node.js

In traditional Node.js runtimes, an OS process multiplexes concurrent requests through an asynchronous event loop. Node relies heavily on C++ bindings for cryptography, file system access, and network I/O. When a massive spike of traffic hits a Node server, the event loop can lag, memory usage balloons wildly, and requests queue up behind one another. If you need more capacity, you spin up another heavy Docker container, which takes precious seconds or even minutes to become ready to serve traffic.

A V8 Isolate is fundamentally different. Imagine a tiny, sandboxed JavaScript environment that boots up in zero milliseconds. It has no access to a local file system. It has no heavy OS process wrapped around it. It executes your code, transforms the incoming payload, and then goes to sleep. Cloudflare spins up these Isolates at the edge, physically close to the user requesting the data.

However, this raw speed comes with severe constraints that you must respect. You have strict memory ceilings, often capped at 128MB. You cannot use the bloated Node `crypto` module; you must use the native, standard `crypto.subtle` (Web Crypto API) which runs significantly faster. You cannot rely on long-lived global variables surviving indefinitely across requests in a standard Worker. You must think about memory allocation carefully. Every single byte counts when you are parsing massive JSON payloads or streaming megabytes of Server-Sent Events. The garbage collector in V8 is efficient, but if you create excessive object churn during a stream, you will hit CPU limits and Cloudflare will aggressively terminate your process with a 1102 error.

## Physical Analogies for Code Structures

To survive in this strict, constrained environment, we rely heavily on TypeScript type system to enforce physical boundaries and prevent runtime chaos. The compiler is our first line of defense against production outages. We do not use TypeScript as a mere suggestion; we use it as a mathematical proof of correctness.

### The Unchecked Object vs The Strict Interface

Think of a raw, untyped JavaScript object as a flimsy cardboard box. You can throw anything inside it: strings, numbers, functions, other nested boxes. In a dynamically typed world, you pass this unlabelled box around your system, hoping the receiver function knows what to expect when it opens the flaps. This is a recipe for catastrophic disaster in a high-stakes proxy server routing sensitive data. 

In Key Collective, we treat data structures like custom-machined, titanium engine parts. They must fit together perfectly down to the micron, or the engine seizes immediately. We use strict TypeScript interfaces to guarantee the absolute shape of our data.

Consider the AST symbols that form the backbone of our domain model:
- `APIKey`: A securely encrypted key belonging to a specific tenant. We never pass this as a string; it is a verified object.
- `AuthToken`: The credential used to authenticate an inbound request.
- `CreateKeyPayload`: The exact shape of data required to provision a new key. If a field is missing, it fails at the edge.
- `KeyInput`: The raw material provided by a user before it undergoes AES-256-GCM encryption.
- `ModelDef`: The strict definition of a supported LLM model, its context window, and capabilities.
- `StreamMetadata`: The contextual information attached to an active SSE stream to track latency and chunk counts.
- `TenantConfig`: The overarching configuration rules for a single isolated tenant.

When a request enters the system, we immediately parse and validate it against these strict interfaces. We create an `AuthenticatedContext` (which securely wraps an `AuthContext`) that is mathematically guaranteed to contain a verified tenant identity. If the incoming data does not perfectly match the defined interface, we reject the request immediately with a 400 Bad Request. We do not attempt to make it work. We do not coerce types. We fail fast.

### The Peril of Floating-Point Math: IEEE-754 vs Microdollars

If you have spent any significant amount of time writing JavaScript, you have likely encountered the infamous addition error: `0.1 + 0.2 === 0.30000000000000004`. This anomaly happens because JavaScript natively uses the IEEE-754 double-precision floating-point format to represent all numbers under the hood. 

Imagine you are a banker tasked with tracking millions of micro-transactions. If you use a physical scale that is slightly imprecise, eventually, a fraction of a cent is lost or gained on every single transaction. Over the course of millions of API requests, this systemic error compounds into massive financial discrepancies. When you are billing enterprise tenants for LLM usage across varying `ModelPricing` tiers based on exact `TokenUsage` and `StreamUsage`, relying on floating-point math is absolutely unacceptable. It is professional negligence.

To permanently solve this, we rely on **Fixed-Point Microdollars**. 
We represent all financial values exclusively as integers, specifically `int64` microdollars. 
A value of `$1.00 USD` is represented exactly as `1,000,000 µ$`. 
A fraction of a cent, say `$0.001`, is perfectly represented as `1,000 µ$`. 

```typescript
// An example of how we define model pricing strictly using microdollars
export interface ModelPricing {
  promptTokenPriceMicrodollars: number; // Price per 1,000,000 prompt tokens in µ$
  completionTokenPriceMicrodollars: number; // Price per 1,000,000 completion tokens in µ$
}

// A theoretical calculation enforcing fixed-point math
function calculateCost(tokens: number, pricePerMillionTokensMicrodollars: number): number {
  // Integer division via Math.floor ensures we never drift into floating point errors
  // We multiply first, then divide, dropping any fractional remainder.
  const totalCostMicrodollars = Math.floor((tokens * pricePerMillionTokensMicrodollars) / 1_000_000);
  return totalCostMicrodollars;
}
```

By strictly enforcing integer math for all financial calculations throughout the entire codebase, we guarantee that billing is perfectly accurate, totally deterministic, and entirely free from the bizarre rounding errors of floating-point arithmetic. If you ever find yourself using `Math.round()` on a financial figure in this codebase, you have made a fundamental architectural mistake.

### The Ephemeral Worker vs The Stateful Durable Object

A Cloudflare Worker operates as an ephemeral isolate. It boots on demand, executes request logic, and terminates promptly. If you store a standard variable in memory, it will vanish into the ether when the Isolate spins down. 

But what if you explicitly need state? What if you need to carefully coordinate access to a highly contended shared resource, like a rotating pool of API keys? What if you need to maintain a strict rate limit across hundreds of concurrent requests arriving at the exact same millisecond from distributed locations?

Enter the **Durable Object**. 
Think of an ephemeral Worker like a short-order cook in a busy diner. They get an order ticket, cook the meal, serve it to the counter, and immediately move on to the next ticket. They do not remember you tomorrow. 
Think of a Durable Object like a heavily fortified bank vault located at a specific physical address in a specific city. It is a globally unique, stateful singleton instance. All requests for a specific tenant are routed seamlessly by Cloudflare network to the exact same bank vault, regardless of where they originated in the world. 

We utilize Durable Objects to maintain critical, transactional hot state that absolutely must survive between individual requests:
- `KeyPoolDO`: Holds the decrypted, active API keys in local memory for a specific tenant. It constantly applies a `KeySelectionStrategy` (like weighted round-robin) to distribute request load, while actively tracking the `KeyStatus` to instantly disable exhausted or rate-limited keys without needing to query a slow database.
- `CircuitBreaker`: Maintains a highly consistent `CircuitBreakerState` to instantly stop routing traffic to a failing upstream provider (for example, if an AI provider API goes down globally, we trip the breaker to prevent cascading failures).
- `RateLimiter`: Accurately counts requests per minute and tokens per minute in memory to enforce strict tenant limits without hammering a remote database. The state is safe because the Durable Object processes requests linearly.

```typescript
// A conceptual snippet showing the strict interface for a model provider
// and how we define capabilities that might be used by a routing Durable Object
export interface ModelProvider {
  id: string;
  name: string;
  baseURL: string;
  models: ModelCapabilities[];
}

export interface ModelCapabilities {
  modelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsStreaming: boolean;
}

// Example usage of tracking token usage securely
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StreamUsage {
  totalStreamedBytes: number;
  chunkCount: number;
  durationMs: number;
}
```

### Discriminated Unions & Exhaustive Type Narrowing

To eliminate runtime `undefined is not a function` errors, we structure all variant outcomes as discriminated unions with a discriminant tag:

```typescript
export type AuthMiddlewareResult = 
  | { success: true; context: AuthenticatedContext }
  | { success: false; error: AuthenticationError; status: 401 | 403 };

export type RouterDecision = 
  | { action: "forward"; provider: ModelProvider; keyId: string; targetUrl: string }
  | { action: "cascade"; primaryFailed: string; fallbackProvider: ModelProvider; reason: string }
  | { action: "reject"; error: CircuitBreakerTrippedError; retryAfterMs: number };

// Exhaustive pattern matching ensures compiler fails if a branch is unhandled:
function assertUnreachable(x: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
}
```

### Timing-Safe Comparisons in Web Crypto

When verifying API tokens, standard JavaScript string comparison leaks character matching time, enabling statistical side-channel timing attacks. In Key Collective, we convert tokens to UTF-8 buffers and compare them using constant-time bitwise operations:

```typescript
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    mismatch |= aBuf[i] ^ bBuf[i];
  }
  return mismatch === 0;
}
```

## Practical Development Workflow and Quality Gates

We do not test in production. We do not push code that works on my machine. We maintain a rigid, unyielding development workflow to guarantee absolute correctness before a single line of code reaches the edge.

Here are the precise, copy-pasteable commands you will use daily to validate your work locally:

- `pnpm install`: Installs the exact dependency tree securely based on the lockfile.
- `pnpm run build`: Compiles the strict TypeScript into highly V8-optimized JavaScript.
- `pnpm test`: Runs the comprehensive test suite utilizing vitest or wrangler test tools. If a single assertion fails, you do not merge. Period.
- `make gate`: The ultimate arbiter of truth. This command runs the linter, the strict type checker, the formatter, and the tests in under 10 seconds. All changes must pass `make gate` before they are even considered for a pull request review.

When you write code for Key Collective, you are not writing a weekend script. You are forging a highly durable, high-performance distributed system designed to handle millions of requests without a single dropped connection, corrupted byte, or leaked key. Write your code with the immense respect that this hostile environment demands. Read the interfaces. Trust the compiler. Deploy with confidence.

The journey continues. In the next chapter, we will take these strict types and apply them to the chaotic reality of routing unstable, third-party LLM streams. Prepare for network volatility.

[Next: Part 2 — Architecture Blueprint & Mental Models →](02_architecture_and_whys.md)
