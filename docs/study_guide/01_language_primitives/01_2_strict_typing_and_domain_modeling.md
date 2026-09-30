# 1.2 Strict Typing and Domain Modeling

If there is one absolute truth in the Key Collective codebase, it is this: **the compiler is your best friend, and you must give it as much information as possible.**

We are building financial infrastructure. A proxy request isn't just a network hop; it's a micro-transaction. If a string is parsed incorrectly, or a state transition is missed, tenants lose money, or we leak access. 

This requires a rigorous approach to how we model our domain in TypeScript. 

## The Zero-`any` Mandate

You will not use `any` in this codebase. Ever. 

Using `any` is telling the compiler, "Trust me, I know what I'm doing." You don't. The system is too complex for human working memory to guarantee safety across refactors. 

If you don't know the shape of incoming data, you use `unknown` and you validate it using a runtime schema validator like Zod or custom type guards. 

### Strict Compiler Flags

Our `tsconfig.json` enforces maximum strictness. These two flags are the foundation:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`noUncheckedIndexedAccess` is particularly brutal but necessary. It means if you access `const item = myArray[0]`, the type of `item` is `T | undefined`, not just `T`. You must prove to the compiler that the element exists. 

## Branded Types: Protecting Financial Math

In a standard system, a balance might just be a `number`. 

```typescript
let balance = 1000;
let latencyMs = 45;
// Nothing stops you from doing this:
let newBalance = balance - latencyMs; // Nonsense, but perfectly valid TS
```

We deal in **microdollars** (1 USD = 1,000,000 µ$). We also deal in milliseconds, bytes, and tokens. Mixing these up is a catastrophic bug. 

To prevent this, we use **Branded Types** (sometimes called Nominal Typing). We attach a phantom symbol to a primitive type so the compiler treats it as a distinct type, even though at runtime it's just a number.

```typescript
// 1. Define the brand
declare const __brand: unique symbol;
export type Brand<B> = { readonly [__brand]: B };

// 2. Define our specific types
export type Microdollars = number & Brand<"Microdollars">;
export type Milliseconds = number & Brand<"Milliseconds">;
export type TenantId = string & Brand<"TenantId">;

// 3. Create safe constructor functions
export function toMicrodollars(val: number): Microdollars {
  if (!Number.isInteger(val)) {
    throw new Error("Microdollars must be an integer");
  }
  return val as Microdollars;
}

export function toMilliseconds(val: number): Milliseconds {
  return val as Milliseconds;
}

// 4. Now the compiler protects us
const balance = toMicrodollars(5000000); // $5.00
const ping = toMilliseconds(120);

// TS ERROR: Type 'Milliseconds' is not assignable to type 'Microdollars'.
// const invalid = balance - ping; 
```

Notice that `toMicrodollars` enforces that the number is an integer. We NEVER use floating-point math for financials. 

## Discriminated Unions: Exhaustive Routing States

When a request flows through the proxy, it goes through various states: authentication, quota checking, rate limiting, and upstream routing. 

Many developers model this with a single interface containing lots of optional fields:

```typescript
// BAD: Do not do this
interface ProxyResult {
  success: boolean;
  rateLimited?: boolean;
  quotaExceeded?: boolean;
  upstreamResponse?: Response;
  fallbackTriggered?: boolean;
  error?: string;
}
```

This is a nightmare to work with. If `success` is true, is `rateLimited` guaranteed to be undefined? What if `fallbackTriggered` is true, does `upstreamResponse` exist? The compiler can't help you, and you end up writing endless `if (result.success && !result.rateLimited)` checks.

We use **Discriminated Unions**. We define exact, mutually exclusive states, identified by a common literal property (usually `type` or `status`). 

```typescript
// GOOD: Precise state modeling
export type ProxyResult = 
  | { status: "DirectSuccess"; response: Response; cost: Microdollars }
  | { status: "CascadeFallback"; response: Response; cost: Microdollars; fallbackProvider: string }
  | { status: "RateLimited"; retryAfterMs: Milliseconds }
  | { status: "QuotaExceeded"; tenantId: TenantId; currentBalance: Microdollars };

export async function handleRequest(result: ProxyResult): Promise<Response> {
  // We switch on the discriminant property
  switch (result.status) {
    case "DirectSuccess":
      // TS knows `result` has `response` and `cost` here.
      return result.response;
      
    case "CascadeFallback":
      console.log(`Fell back to ${result.fallbackProvider}`);
      return result.response;
      
    case "RateLimited":
      // TS knows `retryAfterMs` exists, and it's a Milliseconds type!
      return new Response("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": String(result.retryAfterMs / 1000) }
      });
      
    case "QuotaExceeded":
      return new Response(`Quota Exceeded for tenant ${result.tenantId}`, { status: 402 });
      
    default:
      // Exhaustiveness check!
      // If someone adds a new state to ProxyResult but forgets to handle it here,
      // the compiler will throw an error on this line.
      const _exhaustiveCheck: never = result;
      return new Response("Internal Error", { status: 500 });
  }
}
```

This pattern is non-negotiable. Every complex state machine in the Key Collective uses discriminated unions combined with exhaustive switch statements. 

By modeling our domain this strictly, we eliminate entire classes of bugs before the code ever runs. We make illegal states unrepresentable.

### 4. Type Predicates & Exhaustive Pattern Matching

When handling polymorphic responses from upstream LLM providers, type predicates guarantee type safety at runtime without unsafe casts:

```typescript
// Strict runtime type predicate for error checking
export interface UpstreamRateLimitError {
  type: "rate_limit_exceeded";
  retryAfterSeconds: number;
  provider: string;
}

export interface UpstreamAuthError {
  type: "authentication_failed";
  provider: string;
}

export type UpstreamError = UpstreamRateLimitError | UpstreamAuthError;

export function isRateLimitError(err: unknown): err is UpstreamRateLimitError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { type?: string }).type === "rate_limit_exceeded"
  );
}

export function handleUpstreamError(err: UpstreamError): string {
  switch (err.type) {
    case "rate_limit_exceeded":
      return `Retry after ${err.retryAfterSeconds}s`;
    case "authentication_failed":
      return "Invalid API key";
    default: {
      const _exhaustiveCheck: never = err;
      throw new Error(`Unhandled error type: ${_exhaustiveCheck}`);
    }
  }
}
```
