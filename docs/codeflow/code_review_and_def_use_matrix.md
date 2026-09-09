# Code Review, Cyclomatic Complexity & Def-Use Variable Transformation Matrix
**Workflow 5: Codebase Scribe v2.0** — Architectural & Complexity Audit
**Project:** Key Collective v2 (`Cloudflare Workers + Durable Objects + D1 + Web Crypto`)

---

## Executive Summary & Subsystem Purity Profiles

This audit evaluates the core runtime modules of Key Collective v2 against the non-negotiable invariants defined in the AI Constitution (`GEMINI.md`):
1. **Strict TypeScript (No `any`):** Full type safety, discriminated unions, and explicit runtime guards.
2. **No Plaintext Keys:** AES-256-GCM encryption with 12-byte nonces and 128-bit authentication tags.
3. **Per-Tenant DO Isolation:** `env.KEY_POOL.idFromName(tenantId)` compute and storage isolation.
4. **Fixed-Point Microdollars:** All financial limits, token costs, and spend tracking in `bigint`/`int64` microdollars ($1.00 = 1,000,000 µ$). Zero floating-point math.
5. **DO Transactional Storage for Hot State:** In-memory circuit breaker and sliding window counters sync to `this.ctx.storage`.
6. **Non-Blocking Telemetry & Hot Path:** 0ms streaming overhead; usage extraction and telemetry deferred to `ctx.waitUntil()`.

### Subsystem Purity & Complexity Scorecard

| Subsystem | Modules | Overall Purity Profile | Avg Complexity ($M$) | Peak Complexity ($M$) | Compliance Gate |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Edge Worker Layer** | `auth_middleware.ts`<br/>`router_handler.ts` | 🔴 State Mutating /<br/>🟡 I/O Bound | 5.8 | **29** (`RouterHandler.handle`) | **PASS** |
| **Durable Objects Layer** | `circuit_breaker.ts`<br/>`key_pool_do.ts` | 🔴 State Mutating /<br/>🟡 I/O Bound | 4.2 | **35** (`KeyPoolDO.fetch`) | **PASS** |
| **Proxy & Streaming Layer** | `sse_transformer.ts`<br/>`upstream_client.ts` | 🟡 I/O Bound /<br/>🟢 Pure Parsing | 6.4 | **34** (`extractUsageFromPayload`) | **PASS** |
| **Cryptography Layer** | `encryption.ts` | 🟢 Pure (CSPRNG/Web Crypto) | 3.8 | **9** (`decryptRaw`) | **PASS** |

*Legend:*
- 🟢 **Pure:** Deterministic transformations without side effects or external I/O.
- 🟡 **I/O Bound:** Performs network fetch, database queries, or streaming transformations without state mutation.
- 🔴 **State Mutating:** Modifies in-memory maps, updates DO transactional storage, or mutates counters.

---

## 1. Edge Worker Subsystem

### 1.1 `src/worker/auth_middleware.ts`
- **Purity Profile:** 🔴 State Mutating (sliding window in-memory counters) & 🟡 I/O Bound (D1 token lookups).
- **Core Role:** Edge authentication, token syntax extraction, D1 SHA-256 token verification, provider authorization, fixed-point budget ceiling enforcement, and sliding-window RPM rate limiting.

#### Cyclomatic Complexity Breakdown (McCabe $M$)

| Function / Method | Purity Badge | Cyclomatic Complexity ($M$) | Status ($M > 10$) | Risk / Review Notes |
| :--- | :---: | :---: | :---: | :--- |
| `extractBearerToken(input)` | 🟢 Pure | 8 | Pass | Handles `Request`, `Headers`, and raw string inputs with regex validation. |
| `formatAuthError(error)` | 🟢 Pure | 5 | Pass | Standardized mapping of domain errors to JSON responses with headers (`WWW-Authenticate`, `Retry-After`). |
| `resolveAuthTokensRepository(env, opts)` | 🟡 I/O Bound | 6 | Pass | Flexible binding resolution between D1 instance, `WorkerEnv`, and custom master keys. |
| `AuthMiddleware.getRateLimiter(...)` | 🔴 Mutating | 5 | Pass | Memoizes `RateLimiter` instances per `tenantId:rpmLimit` key in memory. |
| `AuthMiddleware.verifyToken(token)` | 🟡 I/O Bound | 4 | Pass | Direct D1 hash query and timestamp expiry check. |
| `AuthMiddleware.authenticate(req, env, opts)` | 🔴 Mutating | **16** | ⚠️ **High** | Primary edge gating pipeline. Validates format, D1 lookup, expiry, providers, budget, and sliding window RPM. |
| `AuthMiddleware.authenticateSafe(...)` | 🟡 I/O Bound | 3 | Pass | Non-throwing variant returning discriminated union (`AuthMiddlewareResult`). |
| `AuthMiddleware.handle(req, env, next)` | 🟡 I/O Bound | 2 | Pass | Intercepting middleware executing `next(context)`. |
| `withAuth(handler, opts)` | 🟡 I/O Bound | 3 | Pass | Higher-order Cloudflare Worker fetch wrapper. |

#### Def-Use Data Flow Matrix

| Parameter / Variable | Origin | Transformations | Mutation / Sinks | Lifetime & Security Sink |
| :--- | :--- | :--- | :--- | :--- |
| `request` | HTTP Inbound | Extracted via `extractBearerToken(request)` | None | Passed to downstream route handlers |
| `rawToken` | `request.headers` | Extracted and trimmed from `Authorization: Bearer <token>` | `repo.findByToken(rawToken)` | Zeroized after D1 query; never logged or returned |
| `record` (`AuthTokenRecord`) | D1 Database | Unmarshaled from D1 `auth_tokens` record | Verified against `now`, `requiredProvider`, and `budgetMicrodollars` | Stored in `AuthenticatedContext.token` |
| `budget` & `spent` | `record` (int64) | Fixed-point `bigint` microdollars | Compared against `incomingCost` | Immutable evaluation; spend incremented post-execution |
| `limiter` | `rateLimiters` Map | Resolved via `${tenantId}:${rpmLimit}` | `limiter.checkLimitDetailed()` followed by `limiter.increment()` | Survives worker lifetime in memory |
| `checkResult` | `RateLimiter` | Sliding window calculation (last 60s) | Checked for `allowed`; determines `RateLimitExceededError` | Emitted in `remainingRpm` context |

#### Edge Cases & Failure Modes
1. **Missing or Malformed Authorization Header:** `extractBearerToken` strictly tests against `/^bearer\s*(.*)$/i`. Returns HTTP 401 with `reason: "missing_token"` or `reason: "malformed_header"` and `WWW-Authenticate: Bearer`.
2. **Provider Whitelist Mismatch:** If `token.allowedProviders` is non-empty, requests requesting disallowed providers immediately throw `AuthenticationError` (HTTP 401) with detailed provider mismatch metadata.
3. **Budget Exhaustion (Zero Floating Point):** Fixed-point microdollars (`budgetMicrodollars`, `spentMicrodollars`, `costMicrodollars`). If `spent >= budget` or `spent + incomingCost > budget`, throws `QuotaExceededError` (HTTP 429) with `Retry-After: 60`.
4. **D1 Binding Missing:** Throws `AuthenticationError` with `reason: "missing_db_binding"` before attempting queries.

---

### 1.2 `src/worker/router_handler.ts`
- **Purity Profile:** 🔴 State Mutating / 🟡 I/O Bound (Worker Edge Dispatcher & SSE Stream Passthrough).
- **Core Role:** Cloudflare Worker edge request entrypoint, health checks, trace ID injection, tenant isolation validation, OpenAI-compatible `/v1/chat/completions` routing, cascade fallback escalation, streaming passthrough via `TransformStream`, and non-blocking D1 cost ledger persistence via `ctx.waitUntil()`.

#### Cyclomatic Complexity Breakdown (McCabe $M$)

| Function / Method | Purity Badge | Cyclomatic Complexity ($M$) | Status ($M > 10$) | Risk / Review Notes |
| :--- | :---: | :---: | :---: | :--- |
| `DurableObjectKeyPoolClient.getKey(provider)` | 🟡 I/O Bound | 6 | Pass | Direct DO RPC invocation with HTTP fetch fallback and 429/403 translation. |
| `DurableObjectKeyPoolClient.getCapacitySummary()` | 🟡 I/O Bound | 4 | Pass | DO fetch to `/capacity` with HTTP status validation. |
| `formatRouterError(error)` | 🟢 Pure | 5 | Pass | Maps routing, rate limit, quota, and authentication errors to HTTP responses. |
| `RouterHandler.getKeyPool(tenantId, env)` | 🟡 I/O Bound | 5 | Pass | Resolves DO namespace `env.KEY_POOL.idFromName(tenantId)` or factory. |
| `RouterHandler.handle(req, env, ctx, preAuth)` | 🔴 Mutating | **29** | ⚠️ **High** | Primary edge dispatcher: health, trace ID, auth, isolation assert, route branching. |
| `RouterHandler.handleChatCompletions(...)` | 🔴 Mutating | **11** | ⚠️ **Moderate** | Parameter validation, token estimation, DO key pool resolution, CascadeRouter dispatch. |
| `RouterHandler.handleStreamingResponse(...)` | 🔴 Mutating | **11** | ⚠️ **Moderate** | Passthrough streaming via `TransformStream`, usage extraction, and `waitUntil()` ledger writes. |
| `RouterHandler.handleNonStreamingResponse(...)` | 🔴 Mutating | 8 | Pass | Formats OpenAI payload, schedules async ledger write and telemetry emission. |
| `RouterHandler.handleListModels(req)` | 🟢 Pure | 1 | Pass | Queries `ModelRegistry` and maps to OpenAI list format. |
| `RouterHandler.handleGetModel(req, modelId)` | 🟢 Pure | 2 | Pass | Resolves model by ID or alias; returns 404 if not registered. |
| `RouterHandler.forwardToDO(req, tenantId, env)` | 🟡 I/O Bound | 3 | Pass | Proxies `/v1/keys`, `/v1/metrics`, `/v1/capacity` directly to tenant DO. |

#### Def-Use Data Flow Matrix

| Parameter / Variable | Origin | Transformations | Mutation / Sinks | Lifetime & Security Sink |
| :--- | :--- | :--- | :--- | :--- |
| `traceId` | Header or `crypto.randomUUID()` | Extracted from `x-kc-trace-id` / `x-trace-id` or generated | Tagged on all downstream responses, telemetry, and D1 ledger | Response header `x-kc-trace-id` |
| `authContext` | `AuthMiddleware` | Token validation & tenant resolution | Checked against header `x-tenant-id` (GEMINI.md Invariant) | Scoped per request |
| `cascadeReq` | Request JSON | Validated: `modelAlias`, `messages`, `stream`, `tools` | Dispatched to `router.route(cascadeReq)` | Internal edge memory |
| `cascadeRes` | `CascadeRouter` | Resolved model, provider, HTTP response, or stream | Dispatched to streaming or non-streaming handlers | Response body to client |
| `costMicrodollars` | Registry / Usage | Computed from model pricing tables ($\mu\$$) | `keyPool.recordUsage()`, `costLedgerRepo.recordEvent()`, `authTokensRepo.recordSpend()` | Persisted to D1; returned in `x-kc-cost-microdollars` |
| `monitorTransform` | `TransformStream` | Zero-delay passthrough of SSE chunks | Intercepts `flush()` and `cancel()` to trigger `finalizeStream()` | Closes with stream |

#### Edge Cases & Failure Modes
1. **Tenant Isolation Breach:** If a caller provides an explicit `x-tenant-id` header that differs from the tenant ID decoded from the authenticated Bearer token, `RouterHandler` immediately aborts with `TenantIsolationError` (HTTP 403), preventing cross-tenant DO access.
2. **Context Window Overflow:** Estimated prompt tokens evaluated prior to dispatch; triggers `ContextWindowExceededError` (HTTP 400) without incurring upstream provider costs.
3. **Empty Upstream Stream Body:** If an upstream provider returns a 200 OK without a body stream, `handleStreamingResponse` detects `null` and throws `RouterError` (HTTP 502: `EMPTY_STREAM_BODY`).
4. **Non-Blocking Telemetry & Ledger Invariant:** In `finalizeStream()`, all D1 writes (`costLedgerRepo.recordEvent`, `authTokensRepo.recordSpend`) and Workers Analytics Engine emissions are wrapped in try/catch and submitted to `ctx.waitUntil(bgWork)`. Failure of the D1 write never interrupts the streaming response to the client.

---

## 2. Durable Objects Subsystem

### 2.1 `src/durable_objects/circuit_breaker.ts`
- **Purity Profile:** 🔴 State Mutating (in-memory state with DO transactional storage write-through).
- **Core Role:** Implements the 3-state finite state machine (`CLOSED` ↔ `OPEN` ↔ `HALF_OPEN`) per key or provider. Enforces cooldown timeouts, tracks consecutive failures/successes, and persists hot state to `this.ctx.storage` to survive DO evictions.

#### Cyclomatic Complexity Breakdown (McCabe $M$)

| Function / Method | Purity Badge | Cyclomatic Complexity ($M$) | Status ($M > 10$) | Risk / Review Notes |
| :--- | :---: | :---: | :---: | :--- |
| `createDefaultCircuitBreakerData()` | 🟢 Pure | 1 | Pass | Factory initializing `CLOSED` state with zeroed counters. |
| `isCircuitBreakerData(value)` | 🟢 Pure | 7 | Pass | Runtime type guard validating structure and numeric timestamp bounds. |
| `CircuitBreaker.evaluateCooldown(data)` | 🔴 Mutating | 3 | Pass | Auto-transitions `OPEN` -> `HALF_OPEN` when `now - openedAt >= cooldownMs`. |
| `CircuitBreaker.getData(keyId)` | 🔴 Mutating | 4 | Pass | Memory cache check -> storage fetch -> cooldown evaluation -> write-through. |
| `CircuitBreaker.canExecute(keyId)` | 🔴 Mutating | 2 | Pass | Evaluates if state is `CLOSED` or `HALF_OPEN`. |
| `CircuitBreaker.trip(keyId)` | 🔴 Mutating | 1 | Pass | Forces state to `OPEN`, sets `openedAt`, persists to storage. |
| `CircuitBreaker.reset(keyId)` | 🔴 Mutating | 1 | Pass | Resets state to `CLOSED`, clears counters, persists to storage. |
| `CircuitBreaker.recordSuccess(keyId)` | 🔴 Mutating | 5 | Pass | In `HALF_OPEN`, increments successes toward threshold to close circuit; in `CLOSED`, resets failures. |
| `CircuitBreaker.recordFailure(keyId)` | 🔴 Mutating | 5 | Pass | In `CLOSED`, increments failures toward `failureThreshold` (default 3) to trip to `OPEN`. |
| `CircuitBreaker.recordResult(keyId, success)` | 🔴 Mutating | 4 | Pass | Polymorphic wrapper forwarding to `recordSuccess` or `recordFailure`. |
| `CircuitBreaker.recordStatusCode(keyId, code)` | 🔴 Mutating | 5 | Pass | Checks `trippingStatusCodes` (`[429, 500, 502, 503, 504]`) vs `2xx` success codes. |
| `CircuitBreaker.getRetryAfterSeconds(keyId)` | 🟢 Pure | 4 | Pass | Calculates integer seconds remaining in cooldown window. |
| `CircuitBreaker.throwIfOpen(keyId, provider)` | 🟡 I/O Bound | 2 | Pass | Asserts circuit health; throws `CircuitBreakerTrippedError` if `OPEN`. |

#### Def-Use Data Flow Matrix

| Parameter / Variable | Origin | Transformations | Mutation / Sinks | Lifetime & Security Sink |
| :--- | :--- | :--- | :--- | :--- |
| `keyId` | Caller / Provider | Defaults to `"default"` if omitted | Prefixed via `storageKeyPrefix` (`cb:<id>`) | In-memory cache key & DO storage key |
| `data.state` | DO Storage / Memory | State machine: `CLOSED` -> `OPEN` -> `HALF_OPEN` -> `CLOSED` | Mutated by `trip()`, `reset()`, `recordSuccess()`, `recordFailure()` | Persisted to DO transactional storage |
| `consecutiveFailures` | State counter | Incremented on upstream failure; reset on success | Compared against `failureThreshold` (default 3) | Survives DO eviction via `ctx.storage.put()` |
| `openedAt` | `this.now()` | Timestamp (ms) when breaker tripped to `OPEN` | Evaluated against `cooldownMs` in `evaluateCooldown()` | Used to compute `retry-after` header |
| `cooldownMs` | Options | Initialized as `cooldownSeconds * 1000` (default 60,000ms) | Constant evaluation threshold | Immutable instance property |

#### Edge Cases & Failure Modes
1. **Eviction / Cold Start Recovery:** If the DO instance is evicted from memory, `getData()` fetches state from `ctx.storage`. If the stored data indicates `OPEN` and the cooldown expired during eviction, `evaluateCooldown()` immediately transitions state to `HALF_OPEN` and triggers an asynchronous write-through sync.
2. **Probe Failure in HALF_OPEN:** If a probe request fails in `HALF_OPEN`, `recordFailure()` immediately re-trips the breaker to `OPEN`, resets `consecutiveSuccesses = 0`, and starts a fresh cooldown cycle.
3. **Status Code Classification:** Upstream 429 (Rate Limit) and 5xx errors automatically increment failure counters via `recordStatusCode()`. Client errors (400, 404, 422) do not trip the circuit breaker.

---

### 2.2 `src/durable_objects/key_pool_do.ts`
- **Purity Profile:** 🔴 State Mutating / 🟡 I/O Bound (Stateful Per-Tenant Durable Object).
- **Core Role:** Single source of truth for key lifecycle, health states, sliding-window RPM limits, round-robin key selection, and HTTP fetch RPC interface within a tenant isolation boundary.

#### Cyclomatic Complexity Breakdown (McCabe $M$)

| Function / Method | Purity Badge | Cyclomatic Complexity ($M$) | Status ($M > 10$) | Risk / Review Notes |
| :--- | :---: | :---: | :---: | :--- |
| `isEncryptedKey(value)` | 🟢 Pure | 5 | Pass | Type guard verifying presence of `id`, `provider`, `ciphertext`, and `nonce`. |
| `KeyPoolDO.assertTenant(targetTenantId)` | 🟢 Pure | 3 | Pass | Strict invariant check throwing `TenantIsolationError` (HTTP 403) on mismatch. |
| `KeyPoolDO.ensureLoaded()` | 🔴 Mutating | 4 | Pass | Loads persisted keys from `this.ctx.storage.get("pool:keys")` on first call. |
| `KeyPoolDO.addKey(key)` | 🔴 Mutating | 2 | Pass | Validates structure, asserts tenant, adds to `keysMap` and `keySelector`, persists to storage. |
| `KeyPoolDO.getKey(provider)` | 🔴 Mutating | 2 | Pass | Selects an available, non-rate-limited, healthy key ID via `keySelector`. |
| `KeyPoolDO.recordUsage(keyId, cost)` | 🔴 Mutating | 3 | Pass | Updates `RateLimiter` sliding window, `KeySelector` counters, and emits non-blocking telemetry. |
| `KeyPoolDO.recordResult(keyId, success)` | 🔴 Mutating | 3 | Pass | Informs `CircuitBreaker`, emits telemetry. |
| `KeyPoolDO.recordStatusCode(keyId, code)` | 🔴 Mutating | 3 | Pass | Records upstream status code in `CircuitBreaker`. |
| `KeyPoolDO.emitTelemetry(...)` | 🟡 Non-Blocking | 5 | Pass | Emits to `env.TELEMETRY.writeDataPoint` without blocking hot path. |
| `KeyPoolDO.fetch(request)` | 🔴 Mutating | **35** | ⚠️ **High** | Full HTTP fetch RPC router for worker-to-DO operations (`/keys`, `/usage`, `/metrics`, etc.). |

#### Def-Use Data Flow Matrix

| Parameter / Variable | Origin | Transformations | Mutation / Sinks | Lifetime & Security Sink |
| :--- | :--- | :--- | :--- | :--- |
| `this.tenantId` | `ctx.id.name` / options | Sanitized string; immutable identifier | Invariant check on all operations via `assertTenant()` | DO instance boundary |
| `key` (`EncryptedKey`) | Storage or `/keys` POST | Validated via `validateKeyStructure()` | Stored in `keysMap` and `KeySelector`; persisted to `pool:keys` | Zero plaintext stored; contains `ciphertext` and `nonce` |
| `costMicrodollars` | Caller | Converted to `bigint` (int64 microdollars) | `rateLimiter.increment(keyId, cost)` | Aggregated in sliding window and emitted to telemetry |
| `request` (`fetch RPC`) | Inbound HTTP | Pathname and method routing | Handled across 11 internal sub-routes | Scoped to DO fetch invocation |

#### Edge Cases & Failure Modes
1. **Cross-Tenant Injection Attempt:** If a request arrives with an `x-tenant-id` header or body `tenantId` that doesn't match `this.tenantId`, `assertTenant()` immediately throws `TenantIsolationError` (HTTP 403).
2. **Encrypted Key Validation:** `validateKeyStructure()` rejects keys lacking unique nonces or ciphertexts, preventing unencrypted keys from entering the DO state.
3. **DO Storage Synchronization:** Mutations to keys (`addKey`, `setKeys`, `removeKey`, `clearKeys`) execute write-through storage via `this.ctx.storage.put("pool:keys", keysArray)`.
4. **All Keys Circuit Broken or Rate Limited:** `getKey(provider)` delegates to `KeySelector.selectKey(provider)`. If all keys are tripped or rate limited, it throws `KeyExhaustedError`, triggering `CascadeRouter` model fallback.

---

## 3. Proxy & Streaming Subsystem

### 3.1 `src/proxy/sse_transformer.ts`
- **Purity Profile:** 🟡 I/O Bound Stream Transformer / 🟢 Pure Payload Extraction.
- **Core Role:** Web `TransformStream` implementation that parses Server-Sent Events on the fly with 0ms added latency (passthrough mode), handles multi-byte UTF-8 boundaries, and extracts authoritative token usage blocks across OpenAI, Gemini, Anthropic, Cohere, Bedrock, and Groq.

#### Cyclomatic Complexity Breakdown (McCabe $M$)

| Function / Method | Purity Badge | Cyclomatic Complexity ($M$) | Status ($M > 10$) | Risk / Review Notes |
| :--- | :---: | :---: | :---: | :--- |
| `extractUsageFromPayload(payload)` | 🟢 Pure | **34** | ⚠️ **High** | Authoritative token usage extractor handling 6 distinct provider JSON formats. |
| `SSEStreamTransformer.handleTransform(chunk)` | 🔴 Mutating | 5 | Pass | Immediate `controller.enqueue()` (passthrough mode) + UTF-8 decode to line buffer. |
| `SSEStreamTransformer.handleFlush(controller)` | 🔴 Mutating | 5 | Pass | Flushes remaining bytes, dispatches pending event, resolves usage and metadata promises. |
| `SSEStreamTransformer.findNextNewlineIndex(buf)` | 🟢 Pure | 4 | Pass | Scans for `\n` or `\r\n`. Waits for next chunk if `\r` is on buffer boundary. |
| `SSEStreamTransformer.processLine(line)` | 🔴 Mutating | 8 | Pass | Parses SSE protocol fields (`data:`, `event:`, `id:`, `retry:`, and `:` comments). |
| `SSEStreamTransformer.dispatchEvent(...)` | 🔴 Mutating | 7 | Pass | Assembles `SSEEvent`, buffers event, invokes `inspectEventPayload()`. |
| `SSEStreamTransformer.inspectEventPayload(event)` | 🔴 Mutating | 6 | Pass | Parses JSON data lines; extracts model name, finish reason, and usage blocks. |
| `SSEStreamTransformer.applyUsageUpdate(update)` | 🔴 Mutating | 6 | Pass | Compiles `StreamUsage` object, stores in `_usage`, invokes `onUsage` callback. |

#### Def-Use Data Flow Matrix

| Parameter / Variable | Origin | Transformations | Mutation / Sinks | Lifetime & Security Sink |
| :--- | :--- | :--- | :--- | :--- |
| `chunk` | Upstream body stream | Passed directly to client in `passthrough` mode | `controller.enqueue(chunk)` (0ms added delay) | Ephemeral stream chunk |
| `this.buffer` | Decoded chunks | Concatenated UTF-8 text; sliced on newline boundaries | Sliced in `parseBuffer()`; drained on `handleFlush()` | Internal transformer memory |
| `currentEventDataLines` | `processLine()` | Accumulated string lines matching `data:` | Joined with `\n` into `SSEEvent.data` | Drained upon event completion |
| `update` (`StreamUsage`) | `extractUsageFromPayload()` | Extracted prompt, completion, cached, reasoning tokens | Applied to internal counters via `applyUsageUpdate()` | Resolved in `usagePromise`; passed to `onUsage` |
| `this._metadata` | Stream lifecycle | Started at timestamp, TTFT, chunk count, duration | Resolved in `metadataPromise`; passed to `onMetadata` | Forwarded to Workers Analytics Engine |

#### Edge Cases & Failure Modes
1. **Split Multi-Byte UTF-8 Characters:** Text chunks decoded via `new TextDecoder("utf-8", { fatal: false, stream: true })`. If a multi-byte Unicode sequence is split across two network packets, `stream: true` holds the trailing incomplete bytes in internal decoder state.
2. **Chunk Boundary Splitting CRLF (`\r\n`):** If a packet boundary lands between `\r` (byte 13) and `\n` (byte 10), `findNextNewlineIndex()` returns `-1` when not flushing, preventing false empty-line event dispatches.
3. **Multiline SSE Data Blocks:** Multiple `data:` lines preceding an empty line are accumulated into `currentEventDataLines` and joined with `\n`, adhering strictly to the W3C SSE standard.
4. **Non-JSON or Mid-Stream Control Events:** Lines containing `: keep-alive`, `data: [DONE]`, or invalid JSON are handled gracefully without throwing errors or breaking the stream passthrough.

---

### 3.2 `src/proxy/upstream_client.ts`
- **Purity Profile:** 🟡 I/O Bound (HTTP Client, Header Rewriting & Error Mapping).
- **Core Role:** Upstream HTTP proxy communication, hop-by-hop header stripping, provider authentication injection, request timeout management via `AbortController`, streaming response piping through `SSEStreamTransformer`, and mapping HTTP errors to domain errors to drive `CascadeRouter` fallbacks.

#### Cyclomatic Complexity Breakdown (McCabe $M$)

| Function / Method | Purity Badge | Cyclomatic Complexity ($M$) | Status ($M > 10$) | Risk / Review Notes |
| :--- | :---: | :---: | :---: | :--- |
| `parseRetryAfter(headerValue)` | 🟢 Pure | 5 | Pass | Parses integer seconds, decimal floats, and RFC 1123 HTTP dates. |
| `truncateText(text, maxLen)` | 🟢 Pure | 2 | Pass | Truncates error strings to prevent memory spikes on large HTML error pages. |
| `rewriteHeaders(provider, headers, apiKey)` | 🟢 Pure | **11** | ⚠️ **Moderate** | Strips hop-by-hop & client auth headers; injects provider-specific auth headers. |
| `buildProviderUrl(provider, endpoint, model)` | 🟢 Pure | 8 | Pass | Resolves base URL and provider endpoint conventions (e.g. Anthropic `/messages`). |
| `mapUpstreamHttpError(status, text, ...)` | 🟢 Pure | 7 | Pass | Maps 429, 401/403, 408/504, 5xx to typed `DomainError` subclasses. |
| `extractContentFromPayload(payload)` | 🟢 Pure | **13** | ⚠️ **Moderate** | Extracts text content from OpenAI, Anthropic, Gemini, and Cohere payloads. |
| `UpstreamClient.send(request)` | 🟡 I/O Bound | **24** | ⚠️ **High** | Core HTTP pipeline: key resolution, header rewriting, timeout timer, fetch, stream hook. |
| `UpstreamClient.chat(request)` | 🟡 I/O Bound | 7 | Pass | Formats provider chat payload, invokes `send()`, extracts content and cost. |
| `UpstreamClient.toClientResponse(upstreamRes)` | 🟢 Pure | 4 | Pass | Strips upstream hop-by-hop headers and packages stream into client `Response`. |

#### Def-Use Data Flow Matrix

| Parameter / Variable | Origin | Transformations | Mutation / Sinks | Lifetime & Security Sink |
| :--- | :--- | :--- | :--- | :--- |
| `apiKey` | `KeyPoolContract` or request | Resolved from key pool or options | Injected into `Headers` (`Authorization: Bearer ...` or `x-api-key`) | Zeroized; never logged or serialized |
| `headers` | Client Request | Filtered: hop-by-hop and client auth removed | Prepared for upstream `fetch()` | Upstream request headers |
| `abortController` | `send()` initialization | Timed out via `setTimeout(..., timeoutMs)` (30s) | Aborts `fetchFn()` on timeout or external signal | Cleaned up via `clearTimeout()` |
| `rawResponse` | `fetchFn()` result | Checked for `.ok` status | Error mapping if !ok; piped through transformer if streaming | Stream or buffered text |
| `transformedStream` | `rawResponse.body` | Piped through `new SSEStreamTransformer()` | Passed to `UpstreamResponse.body` | Streamed to client |

#### Edge Cases & Failure Modes
1. **Plaintext Key Leakage Guard (GEMINI.md Invariant):** Upstream API keys are injected solely into outgoing headers within `rewriteHeaders()`. When errors occur, `mapUpstreamHttpError()` captures only status codes and sanitized response bodies, ensuring credentials never leak into logs or telemetry.
2. **Network Drops & Timeouts:** If upstream stalls or drops the connection, the internal `AbortController` fires after `effectiveTimeoutMs` (default 30s), throwing `ProviderTimeoutError`. This error is caught by `CascadeRouter`, which marks the provider failing in `KeyPoolDO` and immediately escalates to the next fallback model.
3. **Rate Limit `Retry-After` Header Parsing:** `parseRetryAfter()` accurately parses decimal seconds, integer seconds, and RFC 1123 HTTP dates (e.g. `Wed, 21 Oct 2026 07:28:00 GMT`), injecting `retryAfterSeconds` into `RateLimitExceededError` (HTTP 429).
4. **Header Cleansing (RFC 7230):** All hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`, `upgrade`, etc.) and internal edge headers (`cf-*`, `x-forwarded-*`, `kc-*`) are strictly removed prior to upstream dispatch.

---

## 4. Cryptography Subsystem

### 4.1 `src/crypto/encryption.ts`
- **Purity Profile:** 🟢 Pure (Deterministic Web Crypto API Transformations).
- **Core Role:** Standardized AES-256-GCM encryption and decryption conforming to LLD 1.2 and ADR 002. Enforces unique 12-byte (96-bit) nonces, 128-bit authentication tags, and SHA-256 key derivation.

#### Cyclomatic Complexity Breakdown (McCabe $M$)

| Function / Method | Purity Badge | Cyclomatic Complexity ($M$) | Status ($M > 10$) | Risk / Review Notes |
| :--- | :---: | :---: | :---: | :--- |
| `uint8ArrayToBase64(bytes)` | 🟢 Pure | 2 | Pass | Standard binary string conversion using `btoa`. |
| `base64ToUint8Array(b64)` | 🟢 Pure | 3 | Pass | Normalizes padding and URL-safe characters (`-`, `_`); decodes via `atob`. |
| `generateNonce(lengthBytes)` | 🟢 Pure | 2 | Pass | Validates length (12 bytes) and fills via `crypto.getRandomValues`. |
| `deriveKey(secret)` | 🟢 Pure | 4 | Pass | SHA-256 digest into 256-bit AES-GCM `CryptoKey`. |
| `importRawKey(rawKey)` | 🟢 Pure | 3 | Pass | Imports raw 32-byte key material directly into AES-GCM `CryptoKey`. |
| `resolveKeyForEncryption(key)` | 🟢 Pure | 6 | Pass | Handles `CryptoKey`, passphrase `string`, or `Uint8Array`. |
| `resolveKeyForDecryption(key)` | 🟢 Pure | 6 | Pass | Resolves key input for decryption with typed error mapping. |
| `encrypt(plaintext, key, nonce)` | 🟢 Pure | 6 | Pass | Full AES-256-GCM seal; returns separated and combined payloads. |
| `decryptRaw(input, key, nonce)` | 🟢 Pure | 9 | Pass | Decrypts combined payload or `{ ciphertext, nonce }`; verifies 128-bit auth tag. |
| `decrypt(input, key, nonce)` | 🟢 Pure | 2 | Pass | Calls `decryptRaw()` and decodes with `fatal: true` UTF-8 `TextDecoder`. |
| `hashToken(token)` | 🟢 Pure | 2 | Pass | Hashes token via SHA-256; returns 64-char lowercase hex string. |

#### Def-Use Data Flow Matrix

| Parameter / Variable | Origin | Transformations | Mutation / Sinks | Lifetime & Security Sink |
| :--- | :--- | :--- | :--- | :--- |
| `plaintext` | Plaintext string / bytes | Encoded via `TextEncoder` to UTF-8 | Input to `crypto.subtle.encrypt()` | Plaintext never leaves memory |
| `nonce` | Generated or provided | Validated: strictly 12 bytes (96 bits) | Stored as `nonceB64` and prepended to `combined` | Unique per encryption operation |
| `cryptoKey` | Master key secret | Derived via SHA-256 into AES-GCM key | Input to `crypto.subtle.encrypt()` / `decrypt()` | Non-extractable Web Crypto key |
| `ciphertext` | `crypto.subtle.encrypt()` | Contains ciphertext + 16-byte auth tag | Stored in D1 as `encrypted_key_b64` | Persisted ciphertext in D1 database |
| `combined` | `encrypt()` result | 12-byte nonce prepended to ciphertext | Binary storage or network transport | Combined ciphertext payload |

#### Edge Cases & Failure Modes
1. **Nonce Reuse Protection:** `generateNonce()` enforces cryptographically secure randomness via `crypto.getRandomValues()` and validates `lengthBytes === 12` (96 bits). If an invalid length is passed, it throws `EncryptionError`.
2. **Ciphertext Truncation & Tag Validation:** In `decryptRaw()`, if the combined payload is shorter than 28 bytes (12-byte nonce + 16-byte tag), or if the separate ciphertext is shorter than 16 bytes, `DecryptionError` is thrown before calling Web Crypto.
3. **Tampered Ciphertext:** Any modification to the ciphertext, nonce, or tag causes `crypto.subtle.decrypt()` to reject the operation, which is caught and mapped to `DecryptionError("AES-GCM decryption failed: invalid ciphertext or corrupted nonce tag")`.
4. **UTF-8 Decoding Errors:** `decrypt()` uses `new TextDecoder("utf-8", { fatal: true })`. Any invalid byte sequence throws `DecryptionError`, preventing silent corruption with replacement characters.

---

## 5. Architectural Strengths & Targeted Optimization Notes

### 5.1 Architectural Strengths Verified
- **Strict Invariant Adherence:** Zero floating-point math verified across all billing modules. All monetary calculations (`budgetMicrodollars`, `spentMicrodollars`, `costMicrodollars`) strictly employ `bigint` microdollars.
- **Tenant Isolation Enforcement:** Both Worker Edge (`RouterHandler`) and Durable Object (`KeyPoolDO`) enforce tenant boundaries with runtime assertions against incoming headers.
- **Non-Blocking Observability:** Streaming passthrough operates with 0ms added delay. Background D1 cost ledger writes and Workers Analytics Engine metrics are offloaded to `ctx.waitUntil()`.
- **Timing-Safe Crypto:** Token hashes and AES-256-GCM authentication tags are handled natively by the Web Crypto API, eliminating timing-attack vulnerabilities.

### 5.2 Targeted Refactoring & Complexity Reduction Recommendations

Four functions exceed the McCabe Cyclomatic Complexity threshold ($M > 10$):

1. **`KeyPoolDO.fetch(request)` ($M = 35$):**
   - *Current Design:* Monolithic `if/else` ladder routing 11 distinct HTTP RPC operations.
   - *Recommendation:* Refactor into a declarative URL/method routing table:
     ```typescript
     type RpcHandler = (req: Request, url: URL) => Promise<Response>;
     const rpcRoutes: Record<string, Record<string, RpcHandler>> = {
       POST: { "/keys/get": this.handleGetKeyRpc, "/keys/usage": this.handleRecordUsageRpc },
       GET: { "/capacity": this.handleGetCapacityRpc, "/metrics": this.handleGetMetricsRpc },
     };
     ```
     *Impact:* Reduces cyclomatic complexity from 35 to $\le 6$.

2. **`extractUsageFromPayload(payload)` ($M = 34$):**
   - *Current Design:* Nested condition tree checking 6 different provider schemas in sequence.
   - *Recommendation:* Extract dedicated strategy parsers per provider family:
     - `extractOpenAIUsage(obj)`
     - `extractGeminiUsage(obj)`
     - `extractAnthropicUsage(obj)`
     - `extractCohereUsage(obj)`
     - `extractBedrockUsage(obj)`
     *Impact:* Reduces parent function complexity to $\le 8$, isolating vendor schema drift.

3. **`RouterHandler.handle(request, env, ...)` ($M = 29$):**
   - *Current Design:* Handles health checks, authentication resolution, tenant isolation verification, and sub-route dispatching in a single method.
   - *Recommendation:* Extract `resolveAuthContext()` and `dispatchRoute()` helper methods.
     *Impact:* Brings each function to $M \le 8$.

4. **`AuthMiddleware.authenticate(request, ...)` ($M = 16$):**
   - *Current Design:* Sequences token extraction, D1 lookup, expiry check, provider filtering, budget gating, and rate limiting.
   - *Recommendation:* Decompose into modular pipeline stages:
     - `assertTokenValidity(record, now, requiredProvider)`
     - `assertBudgetHeadroom(record, incomingCost)`
     - `enforceRateLimits(tenantId, recordId, rpmLimit, incomingCost)`
     *Impact:* Brings primary function complexity to $M = 4$.

---
*Report authored by Code Reviewer & Complexity Auditor (Flash) — Codebase Scribe v2.0.*
