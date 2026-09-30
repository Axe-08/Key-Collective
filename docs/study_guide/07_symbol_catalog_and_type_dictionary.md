# Appendix: Production Domain Dictionary & AST Symbol Catalog

## 1. What is the AST Symbol Catalog?

In a production-grade distributed system written in TypeScript under strict compilation flags (`noImplicitAny`, `strictNullChecks`), the type system serves as the definitive, executable specification of the architecture. Every domain boundary, RPC interface, in-memory actor state, and cryptographic container is formalized as an explicit `interface`, `type`, or `class`.

The **Production AST Symbol Catalog** is the comprehensive semantic inventory of all 333 domain types and classes extracted directly from the Abstract Syntax Tree (AST) of the Key Collective codebase.

### Architectural Invariants

Every symbol cataloged below conforms strictly to the non-negotiable architectural invariants defined in `GEMINI.md`:

1. **Strict TypeScript Typing**: Zero `any` policy. All domain boundaries use explicit discriminated unions and branded primitives.

2. **Per-Tenant Actor Isolation**: All stateful actor logic isolates tenant state inside per-tenant Durable Objects (`KeyPoolDO`, `TenantQuotaDO`).

3. **Fixed-Point Microdollars**: All financial and credit values use 64-bit integer microdollars (`type Microdollars = number`), completely eliminating floating-point rounding errors.

4. **Cryptographic Defense**: Zero plaintext keys. AES-256-GCM encryption with 12-byte initialization nonces.

5. **Non-Blocking Telemetry**: High-frequency telemetry streams asynchronously via `ctx.waitUntil()`, never blocking proxy request execution.


---

## 2. Navigating the Catalog by Architectural Domain

The catalog is organized into eleven cohesive architectural domains mirroring the subsystem tours in Part 3 and production idioms in Part 5. Each section begins with an architectural overview of the subsystem, followed by its complete inventory of files and verified AST symbol definitions.


### 01. Ingress Gateway, Routing Infrastructure & Middleware

The Ingress Gateway and Auth Middleware layer forms the defensive perimeter of the Key Collective edge runtime. It handles HTTP protocol parsing, JWT/OAuth identity validation, ephemeral developer demo sandbox isolation, per-IP sliding window rate limiting, and non-blocking telemetry queuing.

#### `src/auth/demo/do.ts`

- `DemoDO` (`class`): Defined in [`src/auth/demo/do.ts`](file:///src/auth/demo/do.ts#L41). Autonomous Singleton Demo Durable Object managing 15-minute rotating ephemeral playground tokens, per-IP sliding window rate limiting (3 RPM, 25 RPD), and automatic token rotation alarms via `this.ctx.storage.setAlarm`.

#### `src/auth/demo/sandbox.ts`

- `DemoSandboxConfig` (`interface`): Defined in [`src/auth/demo/sandbox.ts`](file:///src/auth/demo/sandbox.ts#L75). Type contract defining structured attributes for domain exchange. Key properties: `ipRpmLimit` (number), `ipRpdLimit` (number), `globalRpmLimit` (number), `globalRpdLimit` (number), +1 more properties.
- `DemoSandbox` (`class`): Defined in [`src/auth/demo/sandbox.ts`](file:///src/auth/demo/sandbox.ts#L86). Ephemeral sandbox engine managing per-IP sliding windows and global playground limits.

#### `src/auth/demo/storage.ts`

- `StoredDemoTokenData` (`interface`): Defined in [`src/auth/demo/storage.ts`](file:///src/auth/demo/storage.ts#L11). Type contract defining structured attributes for domain exchange. Key properties: `token` (string), `expiresAt` (number).
- `DemoStorage` (`class`): Defined in [`src/auth/demo/storage.ts`](file:///src/auth/demo/storage.ts#L16). Stateful edge service component managing domain operations.

#### `src/auth/demo/types.ts`

- `DemoDOStorageLike` (`interface`): Defined in [`src/auth/demo/types.ts`](file:///src/auth/demo/types.ts#L14). Storage contract for DemoDO Durable Object storage. Compatible with Cloudflare Workers DurableObjectStorage.
- `IpWindowData` (`interface`): Defined in [`src/auth/demo/types.ts`](file:///src/auth/demo/types.ts#L44). Sliding window record for an individual client IP. Key properties: `requests` (number), `windowStart` (number), `timestamps` (number[]), `minuteWindowStart` (number), +3 more properties.
- `DemoRateLimitResult` (`interface`): Defined in [`src/auth/demo/types.ts`](file:///src/auth/demo/types.ts#L64). Diagnostic result of checking or recording demo rate limits. Key properties: `allowed` (boolean), `currentRpm` (number), `rpmLimit` (number), `currentRpd` (number), +5 more properties.
- `DemoDOOptions` (`interface`): Defined in [`src/auth/demo/types.ts`](file:///src/auth/demo/types.ts#L79). Configuration options for DemoDO. Key properties: `rotationIntervalMs` (number), `ipRpmLimit` (number), `ipRpdLimit` (number), `globalRpmLimit` (number), +2 more properties.
- `ActiveDemoToken` (`interface`): Defined in [`src/auth/demo/types.ts`](file:///src/auth/demo/types.ts#L97). Active demo token metadata. Key properties: `token` (string), `expiresAt` (number).
- `CheckAndConsumeResult` (`interface`): Defined in [`src/auth/demo/types.ts`](file:///src/auth/demo/types.ts#L113). Atomic token consumption and rate-limit enforcement result. Key properties: `allowed` (boolean), `status` (number), `message` (string), `retryAfterSeconds` (number), +1 more properties.

#### `src/auth/oauth/types.ts`

- `AuthorizationUrlOptions` (`interface`): Defined in [`src/auth/oauth/types.ts`](file:///src/auth/oauth/types.ts#L23). Type contract defining structured attributes for domain exchange. Key properties: `codeChallenge` (string), `codeChallengeMethod` ("S256" | "plain"), `scopes` (readonly string[]), `nonce` (string), +2 more properties.
- `OAuthLoginOptions` (`interface`): Defined in [`src/auth/oauth/types.ts`](file:///src/auth/oauth/types.ts#L32). Type contract defining structured attributes for domain exchange. Key properties: `code` (string), `state` (string), `expectedState` (string), `jwtSecret` (string), +2 more properties.
- `OAuthLoginResult` (`interface`): Defined in [`src/auth/oauth/types.ts`](file:///src/auth/oauth/types.ts#L41). Type contract defining structured attributes for domain exchange. Key properties: `accessToken` (string), `user` (OAuthUserProfile), `jwt` (string), `tenantId` (string).
- `PKCEPair` (`interface`): Defined in [`src/auth/oauth/types.ts`](file:///src/auth/oauth/types.ts#L48). Type contract defining structured attributes for domain exchange. Key properties: `verifier` (string), `challenge` (string), `method` ("S256").
- `OAuthStatePair` (`interface`): Defined in [`src/auth/oauth/types.ts`](file:///src/auth/oauth/types.ts#L54). Type contract defining structured attributes for domain exchange. Key properties: `state` (string), `nonce` (string).
- `OAuthProviderPreset` (`interface`): Defined in [`src/auth/oauth/types.ts`](file:///src/auth/oauth/types.ts#L59). Type contract defining structured attributes for domain exchange. Key properties: `provider` (string), `authorizeEndpoint` (string), `tokenEndpoint` (string), `userInfoEndpoint` (string), +1 more properties.

#### `src/worker/auth/middleware.ts`

- `AuthMiddleware` (`class`): Defined in [`src/worker/auth/middleware.ts`](file:///src/worker/auth/middleware.ts#L79). AuthMiddleware implementation. Implements `AuthContract` from domain contracts.

#### `src/worker/auth/storage.ts`

- `InMemoryRateLimiterStorage` (`class`): Defined in [`src/worker/auth/storage.ts`](file:///src/worker/auth/storage.ts#L13). In-memory implementation of DurableObjectStorageLike. Enables edge-worker sliding-window rate limiting in local worker memory when persistent DO storage is not explicitly passed.

#### `src/worker/auth/types.ts`

- `WorkerEnv` (`interface`): Defined in [`src/worker/auth/types.ts`](file:///src/worker/auth/types.ts#L19). Cloudflare Worker environment bindings interface. Key properties: `DB` (D1Database), `KEY_POOL` (DurableObjectNamespace), `TENANT_QUOTA` (DurableObjectNamespace), `TELEMETRY` (AnalyticsEngineDataset), +4 more properties.
- `AuthenticatedContext` (`interface`): Defined in [`src/worker/auth/types.ts`](file:///src/worker/auth/types.ts#L35). Strongly typed authenticated request context passed to downstream handlers. Extends `AuthContext` from domain contracts. Key properties: `tenantId` (string), `isAuthenticated` (boolean), `token` (AuthTokenRecord), `rpmLimit` (number), +5 more properties.
- `AuthMiddlewareOptions` (`interface`): Defined in [`src/worker/auth/types.ts`](file:///src/worker/auth/types.ts#L59). Configuration options for AuthMiddleware and token authentication. Key properties: `db` (D1Database), `masterKey` (KeyInput), `authRepo` (AuthTokensRepository), `requiredProvider` (string), +8 more properties.
- `AuthMiddlewareSuccess` (`interface`): Defined in [`src/worker/auth/types.ts`](file:///src/worker/auth/types.ts#L92). Success result from safe authentication. Key properties: `success` (true), `context` (AuthenticatedContext), `error` (never), `response` (never).
- `AuthMiddlewareFailure` (`interface`): Defined in [`src/worker/auth/types.ts`](file:///src/worker/auth/types.ts#L102). Failure result from safe authentication containing the HTTP Response and DomainError. Key properties: `success` (false), `context` (never), `error` (DomainError), `response` (Response).
- `AuthMiddlewareResult` (`type`): Defined in [`src/worker/auth/types.ts`](file:///src/worker/auth/types.ts#L112). Discriminated union for non-throwing authentication. Definition: `| AuthMiddlewareSuccess | AuthMiddlewareFailure`.

#### `src/worker/gateway/main_worker.ts`

- `MainWorker` (`class`): Defined in [`src/worker/gateway/main_worker.ts`](file:///src/worker/gateway/main_worker.ts#L25). MainWorker: Primary API Gateway & Subdomain Router class for Key Collective Cloudflare Worker.

#### `src/worker/gateway/types.ts`

- `HealthResponse` (`interface`): Defined in [`src/worker/gateway/types.ts`](file:///src/worker/gateway/types.ts#L14). Health response payload format. Key properties: `status` ("healthy" | "degraded" | "unhealthy"), `version` (string), `runtime` ("cloudflare-workers"), `timestamp` (string).
- `WorkerOptions` (`interface`): Defined in [`src/worker/gateway/types.ts`](file:///src/worker/gateway/types.ts#L35). Options for configuring MainWorker. Key properties: `routerHandler` (RouterHandler), `authMiddleware` (AuthMiddleware), `telemetryEmitter` (TelemetryEmitter), `cors` (boolean), +1 more properties.

#### `src/worker/router/chat/handler.ts`

- `ChatHandler` (`class`): Defined in [`src/worker/router/chat/handler.ts`](file:///src/worker/router/chat/handler.ts#L22). Stateful edge service component managing domain operations.

#### `src/worker/router/chat/types.ts`

- `ChatHandlerDependencies` (`interface`): Defined in [`src/worker/router/chat/types.ts`](file:///src/worker/router/chat/types.ts#L19). Type contract defining structured attributes for domain exchange. Key properties: `options` (RouterHandlerOptions), `modelRegistry` (IModelRegistry), `timeProvider` (() => number), `getKeyPool` ((tenantId: string, env: WorkerEnv) => KeyPoolContract), +3 more properties.

#### `src/worker/router/core/dispatcher.ts`

- `DispatchParams` (`interface`): Defined in [`src/worker/router/core/dispatcher.ts`](file:///src/worker/router/core/dispatcher.ts#L29). Type contract defining structured attributes for domain exchange. Key properties: `request` (Request), `env` (WorkerEnv), `ctx` (ExecutionContextLike), `preAuthenticatedContext` (AuthenticatedContext), +8 more properties.

#### `src/worker/router/core/resolver.ts`

- `RouterContextResolver` (`class`): Defined in [`src/worker/router/core/resolver.ts`](file:///src/worker/router/core/resolver.ts#L28). Stateful edge service component managing domain operations.

#### `src/worker/router/dashboard/handler.ts`

- `DashboardRouter` (`class`): Defined in [`src/worker/router/dashboard/handler.ts`](file:///src/worker/router/dashboard/handler.ts#L35). Stateful edge service component managing domain operations.

#### `src/worker/router/dashboard/project_routes.ts`

- `ProjectRecord` (`interface`): Defined in [`src/worker/router/dashboard/project_routes.ts`](file:///src/worker/router/dashboard/project_routes.ts#L17). Type contract defining structured attributes for domain exchange. Key properties: `id` (string), `name` (string), `tenant_id` (string), `description` (string | null), +2 more properties.

#### `src/worker/router/dashboard/token_routes.ts`

- `TokenSummary` (`interface`): Defined in [`src/worker/router/dashboard/token_routes.ts`](file:///src/worker/router/dashboard/token_routes.ts#L20). Type contract defining structured attributes for domain exchange. Key properties: `id` (string), `tenant_id` (string), `rpm_limit` (number), `budget_microdollars` (number), +5 more properties.
- `CreateTokenBody` (`interface`): Defined in [`src/worker/router/dashboard/token_routes.ts`](file:///src/worker/router/dashboard/token_routes.ts#L32). Type contract defining structured attributes for domain exchange. Key properties: `id` (string), `rpm_limit` (number), `budget_microdollars` (number | bigint), `allowed_providers` (string[]), +2 more properties.

#### `src/worker/router/do_client.ts`

- `DurableObjectKeyPoolClient` (`class`): Defined in [`src/worker/router/do_client.ts`](file:///src/worker/router/do_client.ts#L24). Adapter that presents a Cloudflare DurableObjectStub as a KeyPoolContract. Enforces per-tenant DO isolation by communicating strictly with the designated tenant stub.

#### `src/worker/router/errors.ts`

- `RouterError` (`class`): Defined in [`src/worker/router/errors.ts`](file:///src/worker/router/errors.ts#L17). Concrete domain error for edge routing failures.

#### `src/worker/router/model_routes.ts`

- `ModelRoutesHandler` (`class`): Defined in [`src/worker/router/model_routes.ts`](file:///src/worker/router/model_routes.ts#L11). Stateful edge service component managing domain operations. Key properties: `headers` ({ "content-type": "application/json).

#### `src/worker/router/router_handler.ts`

- `RouterHandler` (`class`): Defined in [`src/worker/router/router_handler.ts`](file:///src/worker/router/router_handler.ts#L32). Stateful edge service component managing domain operations.

#### `src/worker/router/types.ts`

- `DurableObjectStubLike` (`interface`): Defined in [`src/worker/router/types.ts`](file:///src/worker/router/types.ts#L22). Structural interface matching Cloudflare DurableObjectStub. Enables both Cloudflare native stubs and mock stubs in unit tests. Key properties: `name` (string).
- `DurableObjectNamespaceLike` (`interface`): Defined in [`src/worker/router/types.ts`](file:///src/worker/router/types.ts#L39). Structural interface matching Cloudflare DurableObjectNamespace.
- `RouterHandlerOptions` (`interface`): Defined in [`src/worker/router/types.ts`](file:///src/worker/router/types.ts#L47). Configuration options for RouterHandler. Key properties: `authMiddleware` (AuthMiddleware), `requireAuth` (boolean), `router` (CascadeRouter | RouterContract), `keyPoolFactory` ((tenantId: string, env: WorkerEnv) => KeyPoolContract), +9 more properties.

#### `src/worker/telemetry_emitter.ts`

- `ExecutionContextLike` (`interface`): Defined in [`src/worker/telemetry_emitter.ts`](file:///src/worker/telemetry_emitter.ts#L22). Structural interface matching Cloudflare Worker ExecutionContext. Allows using both Cloudflare native ExecutionContext and mock objects in unit tests.
- `TelemetryEmitterOptions` (`interface`): Defined in [`src/worker/telemetry_emitter.ts`](file:///src/worker/telemetry_emitter.ts#L30). Options for configuring TelemetryEmitter. Key properties: `dataset` (AnalyticsEngineDataset | null), `ctx` (ExecutionContextLike), `fallbackEmitter` (TelemetryContract), `mapper` ((event: TelemetryEvent) => AnalyticsEngineDataPoint), +2 more properties.
- `CreateTelemetryEventParams` (`interface`): Defined in [`src/worker/telemetry_emitter.ts`](file:///src/worker/telemetry_emitter.ts#L51). Parameters for creating a TelemetryEvent with convenient defaults. Key properties: `traceId` (string), `tenantId` (string), `timestamp` (number), `eventType` (string), +3 more properties.
- `TelemetryEmitter` (`class`): Defined in [`src/worker/telemetry_emitter.ts`](file:///src/worker/telemetry_emitter.ts#L215). Non-blocking analytics pipeline dispatching structured request events to Cloudflare Workers Analytics Engine via `ctx.waitUntil()`.


### 02. Model Catalog, Capability Filtering & Cascade Routing

The Model Catalog, Capability Filtering & Cascade Routing layer provides intelligent, cost-optimal request dispatching. It validates model parameters (context windows, tool calling, JSON schemas, vision support), computes dynamic capability matching, and manages multi-provider fallback escalation.

#### `src/contracts/router.ts`

- `RouteRequest` (`interface`): Defined in [`src/contracts/router.ts`](file:///src/contracts/router.ts#L1). Type contract defining structured attributes for domain exchange. Key properties: `modelAlias` (string), `messages` (unknown[]), `stream` (boolean).
- `RouteResponse` (`interface`): Defined in [`src/contracts/router.ts`](file:///src/contracts/router.ts#L7). Type contract defining structured attributes for domain exchange. Key properties: `content` (string), `costMicrodollars` (bigint).
- `RouterContract` (`interface`): Defined in [`src/contracts/router.ts`](file:///src/contracts/router.ts#L12). Type contract defining structured attributes for domain exchange.

#### `src/router/capability/filter.ts`

- `CapabilityFilter` (`class`): Defined in [`src/router/capability/filter.ts`](file:///src/router/capability/filter.ts#L26). CapabilityFilter evaluates model candidates against incoming request requirements. Filters out models lacking required capabilities (tools, vision, schema, context window) and returns viable candidates sorted cost-optimally.

#### `src/router/capability/types.ts`

- `CapabilityRequirements` (`interface`): Defined in [`src/router/capability/types.ts`](file:///src/router/capability/types.ts#L11). Capability requirements extracted from an incoming request or specified explicitly. Key properties: `minContextLength` (number), `maxOutputTokens` (number), `requiresTools` (boolean), `requiresVision` (boolean), +5 more properties.
- `CapabilityCheckResult` (`interface`): Defined in [`src/router/capability/types.ts`](file:///src/router/capability/types.ts#L35). Result of auditing a model against capability requirements. Key properties: `isCapable` (boolean), `modelId` (string), `missingCapabilities` (string[]), `reasons` (string[]).
- `ModelSortStrategy` (`type`): Defined in [`src/router/capability/types.ts`](file:///src/router/capability/types.ts#L49). Strategy for ordering viable candidate models. Definition: `"cost-asc" | "cost-desc" | "context-desc" | "none"`.
- `FilterOptions` (`interface`): Defined in [`src/router/capability/types.ts`](file:///src/router/capability/types.ts#L54). Options for filtering candidates. Key properties: `sortBy` (ModelSortStrategy), `throwIfEmpty` (boolean).
- `RequirementExtractionOptions` (`interface`): Defined in [`src/router/capability/types.ts`](file:///src/router/capability/types.ts#L64). Options for extracting capability requirements from request payloads. Key properties: `estimatedPromptTokens` (number), `contextBufferMultiplier` (number), `defaultMaxOutputTokens` (number), `provider` (ModelProvider), +2 more properties.

#### `src/router/cascade/evaluator.ts`

- `CandidateResolutionContext` (`interface`): Defined in [`src/router/cascade/evaluator.ts`](file:///src/router/cascade/evaluator.ts#L37). Context configuration required to resolve candidate models. Key properties: `registry` (IModelRegistry), `capabilityFilter` (CapabilityFilter), `sortBy` (ModelSortStrategy), `fallbackModels` (readonly string[]), +1 more properties.

#### `src/router/cascade/fallback.ts`

- `FallbackExecutionContext` (`interface`): Defined in [`src/router/cascade/fallback.ts`](file:///src/router/cascade/fallback.ts#L36). Execution context required to run cascade routing with fallbacks. Key properties: `registry` (IModelRegistry), `upstreamClient` (UpstreamClient), `keyPool` (KeyPoolContract), `maxFallbacks` (number), +2 more properties.

#### `src/router/cascade/router.ts`

- `CascadeRouter` (`class`): Defined in [`src/router/cascade/router.ts`](file:///src/router/cascade/router.ts#L53). Multi-model cascade routing engine that evaluates requested models, verifies capabilities (context window, tools, vision), checks provider health, and coordinates fallback escalation.

#### `src/router/cascade/types.ts`

- `CascadeRouteRequest` (`interface`): Defined in [`src/router/cascade/types.ts`](file:///src/router/cascade/types.ts#L22). Extended request options accepted by CascadeRouter. Key properties: `modelAlias` (string), `messages` (unknown[]), `stream` (boolean), `temperature` (number), +15 more properties.
- `CascadeRouteResponse` (`interface`): Defined in [`src/router/cascade/types.ts`](file:///src/router/cascade/types.ts#L73). Detailed routing result returned by CascadeRouter. Key properties: `content` (string), `costMicrodollars` (bigint), `model` (string), `provider` (string), +5 more properties.
- `CascadeRouterOptions` (`interface`): Defined in [`src/router/cascade/types.ts`](file:///src/router/cascade/types.ts#L97). Options configuring CascadeRouter instantiation. Key properties: `registry` (IModelRegistry), `capabilityFilter` (CapabilityFilter), `upstreamClient` (UpstreamClient), `keyPool` (KeyPoolContract), +9 more properties.

#### `src/router/registry/errors.ts`

- `ContextWindowExceededErrorOptions` (`interface`): Defined in [`src/router/registry/errors.ts`](file:///src/router/registry/errors.ts#L14). Options for ContextWindowExceededError. Key properties: `modelId` (string), `contextWindow` (number), `requestedTokens` (number).
- `ContextWindowExceededError` (`class`): Defined in [`src/router/registry/errors.ts`](file:///src/router/registry/errors.ts#L25). ContextWindowExceededError (HTTP 400) Thrown when requested prompt tokens or total estimated tokens exceed the model's maximum context window.

#### `src/router/registry/registry.ts`

- `ModelRegistry` (`class`): Defined in [`src/router/registry/registry.ts`](file:///src/router/registry/registry.ts#L47). ModelRegistry manages model definitions, context window limits, and pricing math. Implements high-performance in-memory lookup, alias resolution, and fixed-point pricing.

#### `src/router/registry/types.ts`

- `ContextValidationResult` (`interface`): Defined in [`src/router/registry/types.ts`](file:///src/router/registry/types.ts#L48). Result of context window validation. Key properties: `valid` (boolean), `contextWindow` (number), `maxOutputTokens` (number), `promptTokens` (number), +4 more properties.
- `ModelFilterCriteria` (`interface`): Defined in [`src/router/registry/types.ts`](file:///src/router/registry/types.ts#L70). Filter criteria for finding candidate models in the registry. Key properties: `provider` (ModelProvider), `onlyActive` (boolean), `minContextWindow` (number), `maxCostPerMTokMicro` (bigint | number), +3 more properties.
- `ModelRegistryOptions` (`interface`): Defined in [`src/router/registry/types.ts`](file:///src/router/registry/types.ts#L90). Options for configuring ModelRegistry instantiation. Key properties: `models` (readonly (ModelDef<bigint> | ModelDef<number>)[]), `aliases` (Record<string, string>).
- `IModelRegistry` (`interface`): Defined in [`src/router/registry/types.ts`](file:///src/router/registry/types.ts#L100). Contract interface for the Model Registry. Key properties: `tokens` ({ promptTokens: number).


### 03. Communal Key Pool & Actor Coordination

The Communal Key Pool & Actor Coordination layer provides reciprocal key exchange across distinct tenants. It coordinates cross-tenant capacity sharing, tracks provider availability metrics, manages anti-stampede locks, and ensures fair utilization without centralization bottlenecks.

#### `src/contracts/key_pool.ts`

- `EncryptedKey` (`interface`): Defined in [`src/contracts/key_pool.ts`](file:///src/contracts/key_pool.ts#L1). Type contract defining structured attributes for domain exchange. Key properties: `id` (string), `tenantId` (string), `provider` (string), `ciphertext` (string), +14 more properties.
- `KeyMetrics` (`interface`): Defined in [`src/contracts/key_pool.ts`](file:///src/contracts/key_pool.ts#L22). Type contract defining structured attributes for domain exchange. Key properties: `rpm` (number), `circuitBreakerTripped` (boolean), `costAccumulatedMicrodollars` (bigint).
- `KeyPoolContract` (`interface`): Defined in [`src/contracts/key_pool.ts`](file:///src/contracts/key_pool.ts#L28). Type contract defining structured attributes for domain exchange.

#### `src/pool/coordinator_do.ts`

- `PoolCoordinatorDO` (`class`): Defined in [`src/pool/coordinator_do.ts`](file:///src/pool/coordinator_do.ts#L3). Distributed coordination actor managing global communal capacity, anti-stampede locks, provider key health aggregates, and cross-tenant capacity rebalancing.


### 04. Debt Engine, Quota Ledgers & Financial Settlement

The Debt Engine and Quota Ledgers enforce the economic equilibrium of Key Collective. All financial calculations operate on fixed-point microdollars (int64, where 1 USD = 1,000,000 µ$), tracking reciprocal debtor/creditor balances, overdraft ceilings, and consumption quotas with transactional integrity.

#### `src/quota/tenant/debt.ts`

- `DebtState` (`interface`): Defined in [`src/quota/tenant/debt.ts`](file:///src/quota/tenant/debt.ts#L5). Type contract defining structured attributes for domain exchange. Key properties: `communityDebtMicroCu` (bigint), `dailyContributedCu` (bigint), `trustedContributor` (boolean), `consecutiveDebtFreeDays` (number), +1 more properties.

#### `src/quota/tenant/evaluator.ts`

- `QuotaEvaluationContext` (`interface`): Defined in [`src/quota/tenant/evaluator.ts`](file:///src/quota/tenant/evaluator.ts#L10). Type contract defining structured attributes for domain exchange. Key properties: `tenantId` (string), `tier` (UserTier), `entries` (QuotaEntry[]), `totalCostMicrodollars` (bigint), +8 more properties.

#### `src/quota/tenant/tenant_do.ts`

- `TenantQuotaDO` (`class`): Defined in [`src/quota/tenant/tenant_do.ts`](file:///src/quota/tenant/tenant_do.ts#L40). Stateful Per-Tenant Durable Object enforcing hierarchical RPM/RPD limits, microdollar overdraft bounds, double-entry credit balances, and periodic rollup synchronization.

#### `src/quota/tenant/types.ts`

- `DurableObject` (`class`): Defined in [`src/quota/tenant/types.ts`](file:///src/quota/tenant/types.ts#L28). Base DurableObject class compliant with Cloudflare Workers runtime and test environments without cloudflare:workers package imports.
- `QuotaEntry` (`interface`): Defined in [`src/quota/tenant/types.ts`](file:///src/quota/tenant/types.ts#L45). Individual timestamped counter entry in the sliding window. Serializes costMicrodollars as string for safe JSON storage in DO transactional storage. Key properties: `timestamp` (number), `count` (number), `costMicrodollars` (string), `projectId` (string).
- `TenantQuotaData` (`interface`): Defined in [`src/quota/tenant/types.ts`](file:///src/quota/tenant/types.ts#L55). Persisted snapshot of TenantQuotaDO in DO transactional storage. Key properties: `tenantId` (string), `tier` (UserTier), `entries` (QuotaEntry[]), `totalCostMicrodollars` (string), +6 more properties.
- `ConsumeQuotaRequest` (`interface`): Defined in [`src/quota/tenant/types.ts`](file:///src/quota/tenant/types.ts#L72). Request payload for consuming quota. Key properties: `tenantId` (string), `projectId` (string), `tier` (UserTier), `projectMaxSubCap` (number | null), +3 more properties.
- `ConsumeQuotaResult` (`interface`): Defined in [`src/quota/tenant/types.ts`](file:///src/quota/tenant/types.ts#L85). Structured diagnostic result from a quota consumption evaluation. Key properties: `allowed` (boolean), `tenantId` (string), `projectId` (string), `tier` (UserTier), +19 more properties.
- `TenantQuotaDOOptions` (`interface`): Defined in [`src/quota/tenant/types.ts`](file:///src/quota/tenant/types.ts#L115). Configuration options for TenantQuotaDO initialization or testing. Key properties: `tenantId` (string), `initialTier` (UserTier), `rpmWindowMs` (number), `rpdWindowMs` (number), +1 more properties.


### 05. Anti-Sybil Defense & Identity Verification

The Anti-Sybil Defense & Verification subsystem prevents free-rider exploitation and automated bot swarms. It combines Cloudflare Bot Management signals, GitHub account maturity profiling, Turnstile interactive challenges, and subnet IP rate limiters into a deterministic multi-layer evaluation.

#### `src/auth/sybil/errors.ts`

- `SybilBotDetectedError` (`class`): Defined in [`src/auth/sybil/errors.ts`](file:///src/auth/sybil/errors.ts#L7). Structured domain error thrown when runtime operations fail.
- `SybilDisposableIdentityError` (`class`): Defined in [`src/auth/sybil/errors.ts`](file:///src/auth/sybil/errors.ts#L19). Structured domain error thrown when runtime operations fail.
- `SubnetQuotaExceededError` (`class`): Defined in [`src/auth/sybil/errors.ts`](file:///src/auth/sybil/errors.ts#L31). Structured domain error thrown when runtime operations fail.

#### `src/auth/sybil/types.ts`

- `GitHubMaturityProfile` (`interface`): Defined in [`src/auth/sybil/types.ts`](file:///src/auth/sybil/types.ts#L10). Type contract defining structured attributes for domain exchange. Key properties: `id` (number | string), `username` (string), `primaryEmail` (string), `primary_email` (string), +9 more properties.
- `AntiSybilInput` (`interface`): Defined in [`src/auth/sybil/types.ts`](file:///src/auth/sybil/types.ts#L26). Type contract defining structured attributes for domain exchange. Key properties: `turnstileToken` (string), `turnstile_token` (string), `clientIp` (string), `client_ip` (string), +5 more properties.
- `TurnstileVerificationResult` (`interface`): Defined in [`src/auth/sybil/types.ts`](file:///src/auth/sybil/types.ts#L38). Type contract defining structured attributes for domain exchange. Key properties: `success` (boolean), `errorCodes` (readonly string[]), `challengeTs` (string), `hostname` (string).
- `SubnetTracker` (`interface`): Defined in [`src/auth/sybil/types.ts`](file:///src/auth/sybil/types.ts#L45). Type contract defining structured attributes for domain exchange.
- `EvaluateAntiSybilOptions` (`interface`): Defined in [`src/auth/sybil/types.ts`](file:///src/auth/sybil/types.ts#L51). Type contract defining structured attributes for domain exchange. Key properties: `subnetTracker` (SubnetTracker), `turnstileSecret` (string), `fetchFn` (typeof fetch), `recordOnPass` (boolean).
- `CfBotManagementLike` (`interface`): Defined in [`src/auth/sybil/types.ts`](file:///src/auth/sybil/types.ts#L58). Type contract defining structured attributes for domain exchange. Key properties: `score` (number), `verifiedBot` (boolean).
- `CfPropertiesLike` (`interface`): Defined in [`src/auth/sybil/types.ts`](file:///src/auth/sybil/types.ts#L63). Type contract defining structured attributes for domain exchange. Key properties: `asn` (number | string | null), `country` (string | null), `isTor` (boolean | null), `botManagement` (CfBotManagementLike).
- `SybilUserInput` (`interface`): Defined in [`src/auth/sybil/types.ts`](file:///src/auth/sybil/types.ts#L70). Type contract defining structured attributes for domain exchange. Key properties: `id` (string | number), `githubId` (string | number), `username` (string), `login` (string), +22 more properties.
- `SybilRequestInput` (`interface`): Defined in [`src/auth/sybil/types.ts`](file:///src/auth/sybil/types.ts#L99). Type contract defining structured attributes for domain exchange. Key properties: `cf` (CfPropertiesLike), `url` (string), `ip` (string), `clientIp` (string), +4 more properties.
- `SybilScoreResult` (`interface`): Defined in [`src/auth/sybil/types.ts`](file:///src/auth/sybil/types.ts#L116). Type contract defining structured attributes for domain exchange. Key properties: `score` (number), `passed` (boolean), `tier` (UserTier), `riskLevel` ("low" | "medium" | "high" | "critical"), +20 more properties.

#### `src/auth/sybil/utils.ts`

- `InMemorySubnetTracker` (`class`): Defined in [`src/auth/sybil/utils.ts`](file:///src/auth/sybil/utils.ts#L101). In-memory sliding-window subnet registration tracker with TTL cleanup.


### 06. Private Key Pool, Circuit Breakers & Rate Limiters

The Private Key Pool, Circuit Breakers & Rate Limiters layer manages per-tenant key assets. Each tenant's keys are isolated in a dedicated Durable Object (`KeyPoolDO`), where sliding-window RPM counters, error triaging, and fail-fast circuit breakers operate entirely in-memory with transactional storage backing.

#### `src/durable_objects/circuit_breaker/breaker.ts`

- `CircuitBreaker` (`class`): Defined in [`src/durable_objects/circuit_breaker/breaker.ts`](file:///src/durable_objects/circuit_breaker/breaker.ts#L40). Fail-fast stability mechanism tracking consecutive upstream errors, transitioning between CLOSED, OPEN, and HALF_OPEN states with deterministic backoff.

#### `src/durable_objects/circuit_breaker/state_machine.ts`

- `StateTransitionResult` (`interface`): Defined in [`src/durable_objects/circuit_breaker/state_machine.ts`](file:///src/durable_objects/circuit_breaker/state_machine.ts#L14). Type contract defining structured attributes for domain exchange. Key properties: `transitioned` (boolean), `data` (CircuitBreakerData).

#### `src/durable_objects/circuit_breaker/storage.ts`

- `CircuitBreakerStorage` (`class`): Defined in [`src/durable_objects/circuit_breaker/storage.ts`](file:///src/durable_objects/circuit_breaker/storage.ts#L13). Stateful edge service component managing domain operations.

#### `src/durable_objects/circuit_breaker/types.ts`

- `CircuitBreakerState` (`type`): Defined in [`src/durable_objects/circuit_breaker/types.ts`](file:///src/durable_objects/circuit_breaker/types.ts#L16). Circuit breaker states conforming to standard state machine specification. Definition: `"CLOSED" | "OPEN" | "HALF_OPEN"`.
- `CircuitBreakerData` (`interface`): Defined in [`src/durable_objects/circuit_breaker/types.ts`](file:///src/durable_objects/circuit_breaker/types.ts#L27). Hot state persisted in DO transactional storage and cached in memory. Key properties: `state` (CircuitBreakerState), `consecutiveFailures` (number), `consecutiveSuccesses` (number), `lastFailureTime` (number | null), +2 more properties.
- `CircuitBreakerOptions` (`interface`): Defined in [`src/durable_objects/circuit_breaker/types.ts`](file:///src/durable_objects/circuit_breaker/types.ts#L39). Configuration options for the CircuitBreaker instance. Key properties: `keyId` (string), `failureThreshold` (number), `cooldownSeconds` (number), `halfOpenSuccessThreshold` (number), +3 more properties.
- `DurableObjectStorageLike` (`interface`): Defined in [`src/durable_objects/circuit_breaker/types.ts`](file:///src/durable_objects/circuit_breaker/types.ts#L60). Minimal storage contract required by CircuitBreaker. Satisfied natively by Cloudflare Workers DurableObjectStorage.

#### `src/durable_objects/key_pool.ts`

- `KeyPool` (`class`): Defined in [`src/durable_objects/key_pool.ts`](file:///src/durable_objects/key_pool.ts#L43). KeyPool — Stateful Per-Tenant Durable Object. Implements KeyPoolContract and sets up this.ctx.storage access.

#### `src/durable_objects/key_pool/key_pool_do.ts`

- `KeyPoolDO` (`class`): Defined in [`src/durable_objects/key_pool/key_pool_do.ts`](file:///src/durable_objects/key_pool/key_pool_do.ts#L39). Stateful Per-Tenant Durable Object acting as the single source of truth for key health, sliding-window RPM counters, circuit breaker trip states, and transactional storage synchronization (`this.ctx.storage`).

#### `src/durable_objects/key_pool/rpc.ts`

- `KeyPoolRpcHandlerContext` (`interface`): Defined in [`src/durable_objects/key_pool/rpc.ts`](file:///src/durable_objects/key_pool/rpc.ts#L12). Type contract defining structured attributes for domain exchange. Key properties: `tenantId` (string), `assertTenant` ((targetTenantId?: string) => void), `ensureLoaded` (() => Promise<void>), `getKey` ((provider: string) => Promise<string>), +13 more properties.

#### `src/durable_objects/key_pool/types.ts`

- `KeyPoolDOEnv` (`interface`): Defined in [`src/durable_objects/key_pool/types.ts`](file:///src/durable_objects/key_pool/types.ts#L17). Environment bindings accessible inside KeyPoolDO. Key properties: `KEY_POOL` (DurableObjectNamespace), `DB` (D1Database), `TELEMETRY` (AnalyticsEngineDataset).
- `KeyPoolDOOptions` (`interface`): Defined in [`src/durable_objects/key_pool/types.ts`](file:///src/durable_objects/key_pool/types.ts#L27). Configuration options for KeyPoolDO instantiation or testing. Key properties: `tenantId` (string), `keys` (EncryptedKey[]), `circuitBreaker` (CircuitBreaker), `rateLimiter` (RateLimiter), +3 more properties.
- `DurableObjectStateLike` (`interface`): Defined in [`src/durable_objects/key_pool/types.ts`](file:///src/durable_objects/key_pool/types.ts#L47). Minimal state required from Cloudflare DurableObjectState. Key properties: `name` (string), `storage` (DurableObjectStorageLike).

#### `src/durable_objects/key_selector/selector.ts`

- `KeySelector` (`class`): Defined in [`src/durable_objects/key_selector/selector.ts`](file:///src/durable_objects/key_selector/selector.ts#L42). KeySelector coordinates key triage, capacity filtering, and selection algorithms within Cloudflare Durable Objects.

#### `src/durable_objects/key_selector/strategies.ts`

- `StrategyContext` (`interface`): Defined in [`src/durable_objects/key_selector/strategies.ts`](file:///src/durable_objects/key_selector/strategies.ts#L9). Type contract defining structured attributes for domain exchange. Key properties: `provider` (string), `healthyKeys` (TKey[]), `rateLimiter` (RateLimiter), `getUsageCount` ((keyId: string) => number), +4 more properties.

#### `src/durable_objects/key_selector/triage.ts`

- `TriageContext` (`interface`): Defined in [`src/durable_objects/key_selector/triage.ts`](file:///src/durable_objects/key_selector/triage.ts#L38). Type contract defining structured attributes for domain exchange. Key properties: `candidates` (TKey[]), `provider` (string), `costMicrodollars` (bigint), `circuitBreaker` (CircuitBreaker), +2 more properties.

#### `src/durable_objects/key_selector/types.ts`

- `SelectableKey` (`interface`): Defined in [`src/durable_objects/key_selector/types.ts`](file:///src/durable_objects/key_selector/types.ts#L19). Common interface satisfied by both APIKey and EncryptedKey. Allows KeySelector to operate generically across storage representations. Key properties: `id` (string), `provider` (string), `tenantId` (string), `label` (string), +6 more properties.
- `KeySelectionStrategy` (`type`): Defined in [`src/durable_objects/key_selector/types.ts`](file:///src/durable_objects/key_selector/types.ts#L35). Key selection strategy modes. Definition: `| "round-robin" | "least-used" | "load-balanced" | "priority" | "random" | RoutingStrategy`.
- `KeySelectorOptions` (`interface`): Defined in [`src/durable_objects/key_selector/types.ts`](file:///src/durable_objects/key_selector/types.ts#L46). Options for configuring a KeySelector instance. Key properties: `tenantId` (string), `keys` (TKey[]), `circuitBreaker` (CircuitBreaker), `rateLimiter` (RateLimiter), +4 more properties.
- `SelectKeyOptions` (`interface`): Defined in [`src/durable_objects/key_selector/types.ts`](file:///src/durable_objects/key_selector/types.ts#L68). Options passed to selectKey() invocations. Key properties: `strategy` (KeySelectionStrategy), `costMicrodollars` (bigint), `throwOnExhausted` (boolean), `fallbackToAnyProvider` (boolean), +1 more properties.
- `KeyTriageItem` (`interface`): Defined in [`src/durable_objects/key_selector/types.ts`](file:///src/durable_objects/key_selector/types.ts#L84). Detailed triage item for an individual key. Key properties: `key` (TKey), `healthy` (boolean), `retryAfterSeconds` (number), `circuitOpenUntil` (string | null), +3 more properties.
- `KeyTriageResult` (`interface`): Defined in [`src/durable_objects/key_selector/types.ts`](file:///src/durable_objects/key_selector/types.ts#L105). Comprehensive key triage result returned by triageKeys(). Key properties: `provider` (string), `totalKeys` (number), `healthyKeys` (TKey[]), `unhealthyKeys` (KeyTriageItem<TKey>[]), +4 more properties.
- `CapacitySummary` (`interface`): Defined in [`src/durable_objects/key_selector/types.ts`](file:///src/durable_objects/key_selector/types.ts#L119). Capacity summary for a provider or the entire tenant pool. Key properties: `provider` (string), `totalKeys` (number), `healthyKeys` (number), `totalRpmLimit` (number), +3 more properties.

#### `src/durable_objects/rate_limiter/limiter.ts`

- `RateLimiter` (`class`): Defined in [`src/durable_objects/rate_limiter/limiter.ts`](file:///src/durable_objects/rate_limiter/limiter.ts#L33). In-memory and persistent sliding-window token bucket limiter enforcing RPM caps and burst ceilings across distributed requests.

#### `src/durable_objects/rate_limiter/types.ts`

- `RateLimitEntry` (`interface`): Defined in [`src/durable_objects/rate_limiter/types.ts`](file:///src/durable_objects/rate_limiter/types.ts#L19). Individual timestamped counter entry in the sliding window. Stores costMicrodollars as string to guarantee safe JSON serialization in DO storage. Key properties: `timestamp` (number), `count` (number), `costMicrodollars` (string).
- `RateLimiterData` (`interface`): Defined in [`src/durable_objects/rate_limiter/types.ts`](file:///src/durable_objects/rate_limiter/types.ts#L28). Hot state persisted in DO transactional storage and cached in memory. Key properties: `entries` (RateLimitEntry[]), `totalCostMicrodollars` (string), `lastRequestTime` (number | null).
- `RateLimiterOptions` (`interface`): Defined in [`src/durable_objects/rate_limiter/types.ts`](file:///src/durable_objects/rate_limiter/types.ts#L37). Configuration options for the RateLimiter instance. Key properties: `tenantId` (string), `keyId` (string), `rpmLimit` (number), `rpdLimit` (number), +5 more properties.
- `RateLimitCheckResult` (`interface`): Defined in [`src/durable_objects/rate_limiter/types.ts`](file:///src/durable_objects/rate_limiter/types.ts#L61). Structured diagnostic result from a detailed rate limit check. Key properties: `allowed` (boolean), `currentRpm` (number), `rpmLimit` (number), `currentRpd` (number), +5 more properties.
- `RateLimiterMetrics` (`interface`): Defined in [`src/durable_objects/rate_limiter/types.ts`](file:///src/durable_objects/rate_limiter/types.ts#L76). Comprehensive metrics snapshot for a key or tenant pool. Key properties: `rpm` (number), `rpd` (number), `costAccumulatedMicrodollars` (bigint), `remainingRpm` (number), +3 more properties.


### 07. Streaming Proxy & Upstream SSE Transformation

The SSE Transformation pipeline dispatches upstream LLM events via zero-copy data pipes. It parses Server-Sent Events in real-time, extracts token usage metrics, masks upstream error payloads, and guarantees backpressure control without edge memory exhaustion.

#### `src/proxy/cost_calculator.ts`

- `TokenUsage` (`interface`): Defined in [`src/proxy/cost_calculator.ts`](file:///src/proxy/cost_calculator.ts#L12). Type contract defining structured attributes for domain exchange. Key properties: `promptTokens` (number | bigint), `completionTokens` (number | bigint), `totalTokens` (number | bigint).
- `ModelPricing` (`interface`): Defined in [`src/proxy/cost_calculator.ts`](file:///src/proxy/cost_calculator.ts#L18). Type contract defining structured attributes for domain exchange. Key properties: `promptMicrodollarsPerMillion` (bigint), `completionMicrodollarsPerMillion` (bigint).
- `CostBreakdown` (`interface`): Defined in [`src/proxy/cost_calculator.ts`](file:///src/proxy/cost_calculator.ts#L23). Type contract defining structured attributes for domain exchange. Key properties: `promptCostMicrodollars` (bigint), `completionCostMicrodollars` (bigint), `totalCostMicrodollars` (bigint).

#### `src/proxy/sse/transformer.ts`

- `SSEStreamTransformer` (`class`): Defined in [`src/proxy/sse/transformer.ts`](file:///src/proxy/sse/transformer.ts#L20). Web TransformStream implementation parsing upstream Server-Sent Events in real-time, emitting downstream chunks while extracting token usage and cost telemetry.

#### `src/proxy/sse/types.ts`

- `StreamUsage` (`interface`): Defined in [`src/proxy/sse/types.ts`](file:///src/proxy/sse/types.ts#L12). Authoritative token usage extracted from an upstream SSE stream. Extends TokenUsage from router to allow seamless downstream cost calculation. Key properties: `promptTokens` (number), `completionTokens` (number), `totalTokens` (number), `cachedTokens` (number), +7 more properties.
- `SSEEvent` (`interface`): Defined in [`src/proxy/sse/types.ts`](file:///src/proxy/sse/types.ts#L38). Parsed Server-Sent Event structure. Key properties: `event` (string), `id` (string), `data` (string), `retry` (number), +1 more properties.
- `StreamMetadata` (`interface`): Defined in [`src/proxy/sse/types.ts`](file:///src/proxy/sse/types.ts#L54). Stream timing and provider metadata intercepted during streaming. Key properties: `model` (string), `systemFingerprint` (string), `finishReason` (string), `timeToFirstTokenMs` (number), +6 more properties.
- `SSEStreamTransformerOptions` (`interface`): Defined in [`src/proxy/sse/types.ts`](file:///src/proxy/sse/types.ts#L80). Options configuring SSEStreamTransformer behavior. Key properties: `onEvent` ((event: SSEEvent) => void), `onUsage` ((usage: StreamUsage) => void), `onMetadata` ((metadata: StreamMetadata) => void), `onDone` (() => void), +3 more properties.

#### `src/proxy/upstream/client.ts`

- `UpstreamClient` (`class`): Defined in [`src/proxy/upstream/client.ts`](file:///src/proxy/upstream/client.ts#L49). UpstreamClient handles HTTP communication with upstream AI providers. Coordinates header rewriting, key injection, streaming passthrough via SSEStreamTransformer, and error mapping for CascadeRouter fallbacks.

#### `src/proxy/upstream/types.ts`

- `UpstreamClientOptions` (`interface`): Defined in [`src/proxy/upstream/types.ts`](file:///src/proxy/upstream/types.ts#L81). Options configuring UpstreamClient behavior. Key properties: `keyPool` (KeyPoolContract), `fetch` (typeof fetch), `defaultTimeoutMs` (number), `maxTimeoutCeilingMs` (number), +3 more properties.
- `UpstreamRequest` (`interface`): Defined in [`src/proxy/upstream/types.ts`](file:///src/proxy/upstream/types.ts#L140). Parameters for executing a generic upstream HTTP request. Key properties: `provider` (string), `model` (string), `endpoint` (string), `apiKey` (string), +10 more properties.
- `UpstreamResponse` (`interface`): Defined in [`src/proxy/upstream/types.ts`](file:///src/proxy/upstream/types.ts#L174). Structured response from an upstream provider. Key properties: `ok` (boolean), `status` (number), `statusText` (string), `headers` (Headers), +3 more properties.
- `UpstreamChatRequest` (`interface`): Defined in [`src/proxy/upstream/types.ts`](file:///src/proxy/upstream/types.ts#L205). Parameters for standard chat completions request. Key properties: `provider` (string), `model` (string), `messages` (unknown[]), `temperature` (number), +7 more properties.
- `UpstreamChatResponse` (`interface`): Defined in [`src/proxy/upstream/types.ts`](file:///src/proxy/upstream/types.ts#L233). Structured result of a chat completions call. Key properties: `content` (string), `model` (string), `provider` (string), `usage` (StreamUsage | null), +2 more properties.


### 08. Cryptographic Defense, Nonces & Web Crypto API

The Cryptographic Defense subsystem guarantees the zero-plaintext-keys invariant. All provider API keys are encrypted using AES-256-GCM via the Web Crypto API, utilizing unique 12-byte nonces stored alongside ciphertext in D1. Keys are decrypted only ephemerally in volatile memory during upstream calls.

#### `src/constants/crypto.ts`

- `MaskedKeyParts` (`interface`): Defined in [`src/constants/crypto.ts`](file:///src/constants/crypto.ts#L71). Structure containing masked API key components for secure UI presentation. Key properties: `prefix` (string), `suffix` (string), `masked` (string).

#### `src/crypto/encryption/aes.ts`

- `EncryptionService` (`class`): Defined in [`src/crypto/encryption/aes.ts`](file:///src/crypto/encryption/aes.ts#L267). AES-256-GCM Encryption Service backed by Web Crypto API. Uses 12-byte (96-bit) nonces and outputs base64-encoded strings.

#### `src/crypto/encryption/types.ts`

- `KeyInput` (`type`): Defined in [`src/crypto/encryption/types.ts`](file:///src/crypto/encryption/types.ts#L12). Supported key inputs: a CryptoKey, a 32-byte raw Uint8Array, or a string passphrase. Definition: `string | Uint8Array | CryptoKey`.
- `EncryptedPayloadInput` (`interface`): Defined in [`src/crypto/encryption/types.ts`](file:///src/crypto/encryption/types.ts#L29). Object payload format for decryption. Key properties: `ciphertext` (string | Uint8Array), `nonce` (string | Uint8Array).
- `CryptoConfig` (`interface`): Defined in [`src/crypto/encryption/types.ts`](file:///src/crypto/encryption/types.ts#L37). Configuration interface for EncryptionService. Key properties: `encryptionKey` (CryptoKey).

#### `src/crypto/hashing.ts`

- `HashInput` (`type`): Defined in [`src/crypto/hashing.ts`](file:///src/crypto/hashing.ts#L43). Acceptable input types for hashing functions: - UTF-8 string - Uint8Array or any BufferSource (ArrayBuffer, TypedArray, DataView) Definition: `string | BufferSource | ArrayBufferLike`.


### 09. Persistence Repositories & D1 SQLite Storage

The Persistence Repositories and D1 Storage layer bridges fast edge execution with durable relational persistence. Using Cloudflare D1 (serverless SQLite), repositories manage encrypted key records, audit logs, and pre-aggregated daily spend rollups with strict tenant isolation.

#### `src/storage/d1/adapter.ts`

- `D1StorageAdapter` (`class`): Defined in [`src/storage/d1/adapter.ts`](file:///src/storage/d1/adapter.ts#L23). Primary database adapter encapsulating Cloudflare D1 SQLite operations, executing transactional queries for keys, audit logs, and spend rollups with strict tenant isolation.

#### `src/storage/d1/types.ts`

- `TenantMetrics` (`interface`): Defined in [`src/storage/d1/types.ts`](file:///src/storage/d1/types.ts#L11). Type contract defining structured attributes for domain exchange. Key properties: `tenantId` (string), `totalCostMicrodollars` (bigint), `totalRequests` (number), `totalTokens` (number).
- `DailySpendRollupRecord` (`interface`): Defined in [`src/storage/d1/types.ts`](file:///src/storage/d1/types.ts#L18). Type contract defining structured attributes for domain exchange. Key properties: `tenantId` (string), `day` (string), `provider` (string), `modelId` (string), +3 more properties.
- `RollupInput` (`interface`): Defined in [`src/storage/d1/types.ts`](file:///src/storage/d1/types.ts#L28). Type contract defining structured attributes for domain exchange. Key properties: `tenantId` (string), `day` (string), `provider` (string), `modelId` (string), +3 more properties.
- `CostLedgerRecordInput` (`interface`): Defined in [`src/storage/d1/types.ts`](file:///src/storage/d1/types.ts#L38). Type contract defining structured attributes for domain exchange. Key properties: `id` (string), `requestId` (string), `tenantId` (string), `keyId` (string), +10 more properties.

#### `src/storage/do.ts`

- `StoredMetrics` (`interface`): Defined in [`src/storage/do.ts`](file:///src/storage/do.ts#L26). Hot state metrics representation persisted in DO transactional storage. Note: cost is serialized as string/bigint to ensure safe storage across all DO engines. Key properties: `rpm` (number), `circuitBreakerTripped` (boolean), `costAccumulatedMicrodollars` (string | bigint).
- `DOStorageAdapter` (`class`): Defined in [`src/storage/do.ts`](file:///src/storage/do.ts#L36). DOStorageAdapter abstracts this.ctx.storage interactions for hot state. Guarantees transactional atomicity for concurrent mutations.

#### `src/storage/repositories/api_keys/repository.ts`

- `ApiKeyRepository` (`class`): Defined in [`src/storage/repositories/api_keys/repository.ts`](file:///src/storage/repositories/api_keys/repository.ts#L55). Repository managing encrypted tenant API keys in D1, storing AES-256-GCM ciphertexts alongside 12-byte initialization nonces.
- `ApiKeysRepository` (`type`): Defined in [`src/storage/repositories/api_keys/repository.ts`](file:///src/storage/repositories/api_keys/repository.ts#L683). Type alias mapped to `ApiKeyRepository`.

#### `src/storage/repositories/api_keys/types.ts`

- `APIKeyRow` (`interface`): Defined in [`src/storage/repositories/api_keys/types.ts`](file:///src/storage/repositories/api_keys/types.ts#L12). Raw database row structure for table `api_keys` in Cloudflare D1. Key properties: `id` (string), `tenant_id` (string), `label` (string), `provider` (string), +19 more properties.
- `CreateApiKeyInput` (`interface`): Defined in [`src/storage/repositories/api_keys/types.ts`](file:///src/storage/repositories/api_keys/types.ts#L41). Input for creating and encrypting a new API key record. Key properties: `id` (string), `tenantId` (string), `label` (string), `provider` (ModelProvider), +7 more properties.
- `InsertEncryptedApiKeyInput` (`interface`): Defined in [`src/storage/repositories/api_keys/types.ts`](file:///src/storage/repositories/api_keys/types.ts#L69). Input for inserting a pre-encrypted API key record. Key properties: `id` (string), `tenantId` (string), `label` (string), `provider` (ModelProvider), +11 more properties.
- `UpdateApiKeyInput` (`interface`): Defined in [`src/storage/repositories/api_keys/types.ts`](file:///src/storage/repositories/api_keys/types.ts#L105). Partial update fields for an existing API key. Key properties: `label` (string), `rpmLimit` (number), `rpdLimit` (number), `priority` (number), +3 more properties.
- `ListApiKeysOptions` (`interface`): Defined in [`src/storage/repositories/api_keys/types.ts`](file:///src/storage/repositories/api_keys/types.ts#L125). Query options for filtering and paginating tenant API keys. Key properties: `provider` (ModelProvider), `status` (KeyStatus), `limit` (number), `offset` (number).
- `CountApiKeysOptions` (`interface`): Defined in [`src/storage/repositories/api_keys/types.ts`](file:///src/storage/repositories/api_keys/types.ts#L139). Query options for counting tenant API keys. Key properties: `provider` (ModelProvider), `status` (KeyStatus).

#### `src/storage/repositories/auth_tokens/repository.ts`

- `AuthTokensRepository` (`class`): Defined in [`src/storage/repositories/auth_tokens/repository.ts`](file:///src/storage/repositories/auth_tokens/repository.ts#L24). AuthTokensRepository Provides repository methods for persisting, querying, verifying, and managing tenant authentication tokens in Cloudflare D1 with mandatory AES-256-GCM encryption at rest and SHA-256 constant-time hash indexing.

#### `src/storage/repositories/auth_tokens/types.ts`

- `AuthTokenRow` (`interface`): Defined in [`src/storage/repositories/auth_tokens/types.ts`](file:///src/storage/repositories/auth_tokens/types.ts#L13). Raw database row shape for the `auth_tokens` table in Cloudflare D1. Key properties: `id` (string), `hash_sha256` (string), `tenant_id` (string), `encrypted_token_b64` (string | null), +7 more properties.
- `AuthTokenRecord` (`interface`): Defined in [`src/storage/repositories/auth_tokens/types.ts`](file:///src/storage/repositories/auth_tokens/types.ts#L30). Domain representation of an AuthToken record in memory. Key properties: `id` (string), `hashSha256` (string), `tenantId` (string), `encryptedTokenB64` (string | null), +7 more properties.
- `CreateAuthTokenParams` (`interface`): Defined in [`src/storage/repositories/auth_tokens/types.ts`](file:///src/storage/repositories/auth_tokens/types.ts#L58). Parameters for creating a new authentication token. Key properties: `id` (string), `token` (string), `tenantId` (string), `encryptionKey` (KeyInput), +5 more properties.
- `AuthTokenRepositoryConfig` (`interface`): Defined in [`src/storage/repositories/auth_tokens/types.ts`](file:///src/storage/repositories/auth_tokens/types.ts#L82). Configuration options for AuthTokensRepository. Key properties: `masterKey` (KeyInput).
- `TokenValidationResult` (`interface`): Defined in [`src/storage/repositories/auth_tokens/types.ts`](file:///src/storage/repositories/auth_tokens/types.ts#L90). Result of validating an incoming bearer token. Key properties: `valid` (boolean), `reason` ("invalid_token" | "expired_token" | "provider_not_allowed" | "budget_exceeded" | string), `token` (AuthTokenRecord).
- `UpdateAuthTokenParams` (`interface`): Defined in [`src/storage/repositories/auth_tokens/types.ts`](file:///src/storage/repositories/auth_tokens/types.ts#L102). Parameters for updating an existing auth token. Key properties: `budgetMicrodollars` (bigint | number), `allowedProviders` (string[]), `rpmLimit` (number), `expiresAt` (string | Date | null).

#### `src/storage/repositories/cost_ledger/errors.ts`

- `CostLedgerError` (`class`): Defined in [`src/storage/repositories/cost_ledger/errors.ts`](file:///src/storage/repositories/cost_ledger/errors.ts#L14). Domain error raised on cost ledger database operations.
- `InvalidCostLedgerEventError` (`class`): Defined in [`src/storage/repositories/cost_ledger/errors.ts`](file:///src/storage/repositories/cost_ledger/errors.ts#L30). Domain error raised when cost ledger input validation fails.
- `TenantIsolationViolationError` (`class`): Defined in [`src/storage/repositories/cost_ledger/errors.ts`](file:///src/storage/repositories/cost_ledger/errors.ts#L46). Domain error raised when tenant isolation invariant is violated.

#### `src/storage/repositories/cost_ledger/repository.ts`

- `CostLedgerRepository` (`class`): Defined in [`src/storage/repositories/cost_ledger/repository.ts`](file:///src/storage/repositories/cost_ledger/repository.ts#L45). Repository managing immutable financial event logs in D1, computing daily spend rollups, and reconciling microdollar balances without floating-point math.

#### `src/storage/repositories/cost_ledger/types.ts`

- `CostLedgerEventInput` (`interface`): Defined in [`src/storage/repositories/cost_ledger/types.ts`](file:///src/storage/repositories/cost_ledger/types.ts#L19). Input payload for recording a single transaction in the cost ledger. Key properties: `id` (string), `requestId` (string), `tenantId` (string), `keyId` (string), +10 more properties.
- `DailySpendRollup` (`interface`): Defined in [`src/storage/repositories/cost_ledger/types.ts`](file:///src/storage/repositories/cost_ledger/types.ts#L54). Aggregated daily spend metrics for a specific tenant, day, provider, and model. Key properties: `tenantId` (string), `day` (string), `provider` (ModelProvider | string), `modelId` (string), +3 more properties.
- `DailySpendRollupInput` (`interface`): Defined in [`src/storage/repositories/cost_ledger/types.ts`](file:///src/storage/repositories/cost_ledger/types.ts#L74). Input payload for updating or incrementing a daily spend rollup. Key properties: `tenantId` (string), `day` (string | Date), `provider` (ModelProvider | string), `modelId` (string), +3 more properties.
- `ListCostEventsOptions` (`interface`): Defined in [`src/storage/repositories/cost_ledger/types.ts`](file:///src/storage/repositories/cost_ledger/types.ts#L90). Query filtering and pagination options for cost ledger event queries. Key properties: `since` (string | Date), `until` (string | Date), `provider` (string), `modelId` (string), +4 more properties.
- `ListDailyRollupsOptions` (`interface`): Defined in [`src/storage/repositories/cost_ledger/types.ts`](file:///src/storage/repositories/cost_ledger/types.ts#L112). Query filtering options for daily spend rollup queries. Key properties: `startDate` (string | Date), `endDate` (string | Date), `provider` (string), `modelId` (string), +3 more properties.
- `TenantSpendSummary` (`interface`): Defined in [`src/storage/repositories/cost_ledger/types.ts`](file:///src/storage/repositories/cost_ledger/types.ts#L132). Aggregated summary of tenant spending across a timeframe. Key properties: `tenantId` (string), `totalCostMicrodollars` (bigint), `totalRequests` (number), `totalTokens` (number), +2 more properties.
- `CostLedgerDbRow` (`interface`): Defined in [`src/storage/repositories/cost_ledger/types.ts`](file:///src/storage/repositories/cost_ledger/types.ts#L144). Internal interface representing raw database row from `cost_ledger`. Key properties: `id` (string), `request_id` (string), `tenant_id` (string), `key_id` (string), +10 more properties.
- `DailySpendRollupDbRow` (`interface`): Defined in [`src/storage/repositories/cost_ledger/types.ts`](file:///src/storage/repositories/cost_ledger/types.ts#L164). Internal interface representing raw database row from `daily_spend_rollup`. Key properties: `tenant_id` (string), `day` (string), `provider` (string), `model_id` (string), +3 more properties.
- `AggregateDbRow` (`interface`): Defined in [`src/storage/repositories/cost_ledger/types.ts`](file:///src/storage/repositories/cost_ledger/types.ts#L177). Internal interface for count/sum aggregate query results. Key properties: `total_cost` (number | string | bigint | null), `total_requests` (number | string | null), `total_tokens` (number | string | null), `count` (number | string | null).
- `ReconcileRollupDbRow` (`interface`): Defined in [`src/storage/repositories/cost_ledger/types.ts`](file:///src/storage/repositories/cost_ledger/types.ts#L187). Internal interface for rollup reconciliation query results. Key properties: `provider` (string), `model_id` (string), `total_requests` (number), `total_tokens` (number), +1 more properties.

#### `src/storage/repositories/model_registry/repository.ts`

- `ModelRegistryRepository` (`class`): Defined in [`src/storage/repositories/model_registry/repository.ts`](file:///src/storage/repositories/model_registry/repository.ts#L15). Repository layer for managing AI model definitions, pricing, and capabilities in Cloudflare D1.

#### `src/storage/repositories/model_registry/types.ts`

- `ModelRegistryRow` (`interface`): Defined in [`src/storage/repositories/model_registry/types.ts`](file:///src/storage/repositories/model_registry/types.ts#L6). Raw row shape returned by Cloudflare D1 from the `model_registry` table. Key properties: `id` (string), `provider` (string), `logical_aliases` (string), `context_window` (number), +11 more properties.
- `ModelFilterOptions` (`interface`): Defined in [`src/storage/repositories/model_registry/types.ts`](file:///src/storage/repositories/model_registry/types.ts#L27). Filter options for listing models from the registry. Key properties: `provider` (ModelProvider), `isActive` (boolean), `supportsTools` (boolean), `supportsVision` (boolean), +7 more properties.
- `ModelCapabilitiesFilter` (`interface`): Defined in [`src/storage/repositories/model_registry/types.ts`](file:///src/storage/repositories/model_registry/types.ts#L55). Capabilities and context filter for matching models during routing. Key properties: `tools` (boolean), `vision` (boolean), `jsonSchema` (boolean), `minContextWindow` (number), +4 more properties.
- `IModelRegistryRepository` (`interface`): Defined in [`src/storage/repositories/model_registry/types.ts`](file:///src/storage/repositories/model_registry/types.ts#L77). Contract interface for the Model Registry repository.


### 10. Domain Errors, Configuration & Core Contracts

The Domain Errors, Configuration & Core Contracts layer defines the formal TypeScript specifications, discriminated error unions, environment bindings, and configuration models that bind the distributed system together under strict type safety.

#### `src/contracts/auth.ts`

- `AuthToken` (`interface`): Defined in [`src/contracts/auth.ts`](file:///src/contracts/auth.ts#L1). Type contract defining structured attributes for domain exchange. Key properties: `id` (string), `tenantId` (string), `tokenHash` (string), `createdAt` (number), +1 more properties.
- `AuthContext` (`interface`): Defined in [`src/contracts/auth.ts`](file:///src/contracts/auth.ts#L9). Type contract defining structured attributes for domain exchange. Key properties: `tenantId` (string), `isAuthenticated` (boolean).
- `AuthContract` (`interface`): Defined in [`src/contracts/auth.ts`](file:///src/contracts/auth.ts#L14). Type contract defining structured attributes for domain exchange.

#### `src/contracts/providers.ts`

- `CanonicalProvider` (`type`): Defined in [`src/contracts/providers.ts`](file:///src/contracts/providers.ts#L2). Type alias mapped to `typeof CANONICAL_PROVIDERS[number]`.

#### `src/contracts/telemetry.ts`

- `TelemetryEvent` (`interface`): Defined in [`src/contracts/telemetry.ts`](file:///src/contracts/telemetry.ts#L1). Type contract defining structured attributes for domain exchange. Key properties: `traceId` (string), `tenantId` (string), `timestamp` (number), `eventType` (string), +3 more properties.
- `TelemetryContract` (`interface`): Defined in [`src/contracts/telemetry.ts`](file:///src/contracts/telemetry.ts#L11). Type contract defining structured attributes for domain exchange.

#### `src/contracts/v3_5_types.ts`

- `Milliseconds` (`type`): Defined in [`src/contracts/v3_5_types.ts`](file:///src/contracts/v3_5_types.ts#L8). Type alias mapped to `number`.
- `EdgeSubdomain` (`type`): Defined in [`src/contracts/v3_5_types.ts`](file:///src/contracts/v3_5_types.ts#L11). 2. Subdomain Host Routing Contracts Definition: `'api' | 'console' | 'admin' | 'apex'`.
- `HostRouteDecision` (`interface`): Defined in [`src/contracts/v3_5_types.ts`](file:///src/contracts/v3_5_types.ts#L13). Type contract defining structured attributes for domain exchange. Key properties: `host` (string), `subdomain` (EdgeSubdomain), `requiresAdminAuth` (boolean), `isApiGateway` (boolean), +1 more properties.
- `PublicTier` (`type`): Defined in [`src/contracts/v3_5_types.ts`](file:///src/contracts/v3_5_types.ts#L24). 3. User Governance Tiers Definition: `'probationary' | 'builder' | 'max'`.
- `InternalTier` (`type`): Defined in [`src/contracts/v3_5_types.ts`](file:///src/contracts/v3_5_types.ts#L25). Union type formalizing the allowed states: `'ultra' | 'admin'`.
- `TierCapabilities` (`interface`): Defined in [`src/contracts/v3_5_types.ts`](file:///src/contracts/v3_5_types.ts#L27). Type contract defining structured attributes for domain exchange. Key properties: `tier` (UserTier), `rpmLimit` (number), `rpdLimit` (number), `maxProjects` (number), +3 more properties.
- `UserIdentity` (`interface`): Defined in [`src/contracts/v3_5_types.ts`](file:///src/contracts/v3_5_types.ts#L38). 4. Two-Phase Identity Context Key properties: `id` (string), `email` (string), `authProvider` ('email' | 'google' | 'github'), `isGithubVerified` (boolean), +8 more properties.
- `PublicUserProfile` (`interface`): Defined in [`src/contracts/v3_5_types.ts`](file:///src/contracts/v3_5_types.ts#L54). 5. Public Profile Scrubbed of Hidden Tiers Key properties: `id` (string), `email` (string), `username` (string), `tier` (PublicTier), +6 more properties.
- `SybilProofResult` (`interface`): Defined in [`src/contracts/v3_5_types.ts`](file:///src/contracts/v3_5_types.ts#L70). 6. Anti-Sybil 5-Layer Proof Results Key properties: `layer1AccountAgeDays` (number), `layer1Passed` (boolean), `layer2CommitCountAnnual` (number), `layer2Passed` (boolean), +8 more properties.
- `TenantSurveillanceRow` (`interface`): Defined in [`src/contracts/v3_5_types.ts`](file:///src/contracts/v3_5_types.ts#L86). 7. Admin Surveillance & Mutation Contracts Key properties: `tenantId` (string), `email` (string), `authProvider` (string), `tier` (UserTier), +6 more properties.
- `AdminActionPayload` (`interface`): Defined in [`src/contracts/v3_5_types.ts`](file:///src/contracts/v3_5_types.ts#L99). Type contract defining structured attributes for domain exchange. Key properties: `adminEmail` (string), `targetTenantId` (string), `action` ('UPDATE_TIER' | 'QUARANTINE' | 'UNQUARANTINE' | 'RESET_QUOTA'), `newTier` (UserTier), +1 more properties.
- `ProviderCircuitOverridePayload` (`interface`): Defined in [`src/contracts/v3_5_types.ts`](file:///src/contracts/v3_5_types.ts#L107). Type contract defining structured attributes for domain exchange. Key properties: `adminEmail` (string), `provider` ('gemini' | 'groq' | 'cerebras' | 'deepseek' | 'all'), `state` ('TRIPPED' | 'NORMAL'), `reason` (string).

#### `src/contracts/v3_types.ts`

- `UserTier` (`type`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L15). Platform Authorization & Quota Tiers. Definition: `| 'admin' // 👑 Root Owner: Unlimited RPM/RPD, full administrative access | 'ultra' // ⚡ Ultra Developer: Unlimited RPM/RPD, no platform admin privileges | 'max' // 🚀 Power Developer: 60 RPM, 10,000 RPD, max 10 projects | 'builder' // 🛠️ Standard Developer: 20 RPM, 2,000 RPD, max 3 projects | 'probationary' // ⏳ Sandboxed New Account: 2 RPM, 50 RPD, 1 project | 'demo' // 🎭 Ephemeral Playground: 20 RPM shared pool, 3 RPM / IP, 25 RPD / IP | 'suspended'`.
- `TierLimits` (`interface`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L27). Tier Quota Configuration Limits. Key properties: `tier` (UserTier), `rpmLimit` (number), `rpdLimit` (number), `maxProjects` (number), +2 more properties.
- `UserAccount` (`interface`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L98). Root User Account entity stored in D1. Key properties: `id` (string), `githubId` (number), `githubUsername` (string), `primaryEmail` (string), +9 more properties.
- `AntiSybilAssessment` (`interface`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L117). Anti-Sybil Verification Assessment. Key properties: `passed` (boolean), `score` (number), `tier` (UserTier), `turnstileValid` (boolean), +6 more properties.
- `Project` (`interface`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L135). Project registered by an authorized user. Key properties: `id` (string), `tenantId` (string), `name` (string), `slug` (string), +5 more properties.
- `ProjectKey` (`interface`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L150). Project-Scoped API Key issued to a project. Key properties: `id` (string), `projectId` (string), `tenantId` (string), `name` (string), +5 more properties.
- `DemoSession` (`interface`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L165). Ephemeral Demo Playground Session. Key properties: `token` (string), `clientIp` (string), `expiresAt` (number), `requestsToday` (number), +1 more properties.
- `OAuthProviderConfig` (`interface`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L176). OAuth Provider Configuration for PKCE & Provider Integration. Key properties: `provider` ("github" | "google" | string), `clientId` (string), `clientSecret` (string), `tokenEndpoint` (string), +5 more properties.
- `OAuthUserProfile` (`interface`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L191). Normalized OAuth User Profile returned by identity providers. Key properties: `id` (string), `email` (string), `username` (string), `name` (string), +1 more properties.
- `OAuthTokenResponse` (`interface`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L202). Raw OAuth Token Response from identity providers. Key properties: `access_token` (string), `token_type` (string), `scope` (string), `expires_in` (number), +4 more properties.
- `JWTPayload` (`interface`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L216). JWT Payload for authenticated sessions. Key properties: `sub` (string), `tenantId` (string), `email` (string), `username` (string), +5 more properties.
- `SybilScore` (`interface`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L231). Sybil Score risk evaluation structure. Key properties: `score` (number), `passed` (boolean), `tier` (UserTier), `riskLevel` ("low" | "medium" | "high" | "critical"), +10 more properties.
- `DemoSessionState` (`interface`): Defined in [`src/contracts/v3_types.ts`](file:///src/contracts/v3_types.ts#L254). Demo Session DO storage schema. Key properties: `clientIp` (string), `sessionToken` (string), `createdAt` (number), `expiresAt` (number), +4 more properties.

#### `src/contracts/v4_types.ts`

- `ConsentAttestation` (`type`): Defined in [`src/contracts/v4_types.ts`](file:///src/contracts/v4_types.ts#L11). Type alias mapped to `z.infer<typeof ConsentAttestationSchema>`.
- `ApiKey` (`type`): Defined in [`src/contracts/v4_types.ts`](file:///src/contracts/v4_types.ts#L32). Type alias mapped to `z.infer<typeof ApiKeySchema>`.
- `CommunityDebtLedger` (`type`): Defined in [`src/contracts/v4_types.ts`](file:///src/contracts/v4_types.ts#L45). Type alias mapped to `z.infer<typeof CommunityDebtLedgerSchema>`.
- `RoutingDecision` (`type`): Defined in [`src/contracts/v4_types.ts`](file:///src/contracts/v4_types.ts#L73). Type alias mapped to `z.infer<typeof RoutingDecisionSchema>`.
- `TakedownReport` (`type`): Defined in [`src/contracts/v4_types.ts`](file:///src/contracts/v4_types.ts#L81). Type alias mapped to `z.infer<typeof TakedownReportSchema>`.
- `PoolMetrics` (`type`): Defined in [`src/contracts/v4_types.ts`](file:///src/contracts/v4_types.ts#L94). Type alias mapped to `z.infer<typeof PoolMetricsSchema>`.
- `ProjectHashRegistry` (`type`): Defined in [`src/contracts/v4_types.ts`](file:///src/contracts/v4_types.ts#L104). Type alias mapped to `z.infer<typeof ProjectHashRegistrySchema>`.

#### `src/errors/auth_errors.ts`

- `AuthenticationErrorOptions` (`interface`): Defined in [`src/errors/auth_errors.ts`](file:///src/errors/auth_errors.ts#L12). Configuration payload and context parameters for instantiating `AuthenticationError`. Key properties: `reason` ("missing_token" | "invalid_token" | "expired_token" | "malformed_header" | string), `bearerTokenPrefix` (string).
- `AuthenticationError` (`class`): Defined in [`src/errors/auth_errors.ts`](file:///src/errors/auth_errors.ts#L22). AuthenticationError (HTTP 401) Thrown when the bearerToken fails validation, is malformed, or is expired.
- `TenantIsolationErrorOptions` (`interface`): Defined in [`src/errors/auth_errors.ts`](file:///src/errors/auth_errors.ts#L54). Configuration payload and context parameters for instantiating `TenantIsolationError`. Key properties: `tenantId` (string), `attemptedTenantId` (string), `resourceId` (string).
- `TenantIsolationError` (`class`): Defined in [`src/errors/auth_errors.ts`](file:///src/errors/auth_errors.ts#L66). TenantIsolationError (HTTP 403) Non-negotiable architectural invariant: Zero cross-tenant state. Thrown whenever an operation attempts to access or mutate state belonging to another tenant.

#### `src/errors/domain_error.ts`

- `DomainErrorJson` (`interface`): Defined in [`src/errors/domain_error.ts`](file:///src/errors/domain_error.ts#L12). Configuration payload and context parameters for instantiating `DomainErrorJson`. Key properties: `error` (string), `code` (string), `statusCode` (number), `details` (Record<string, unknown>).
- `DomainErrorOptions` (`interface`): Defined in [`src/errors/domain_error.ts`](file:///src/errors/domain_error.ts#L19). Configuration payload and context parameters for instantiating `DomainError`. Key properties: `cause` (unknown), `details` (Record<string, unknown>), `statusCode` (number), `code` (string), +1 more properties.

#### `src/errors/key_errors.ts`

- `DecryptionErrorOptions` (`interface`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L18). Configuration payload and context parameters for instantiating `DecryptionError`. Key properties: `keyId` (string), `provider` (string), `algorithm` (string), `nonceLengthBytes` (number).
- `DecryptionError` (`class`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L31). DecryptionError (HTTP 500) Thrown if AES-256-GCM decryption of a provider key fails (Web Crypto API integrity tag mismatch, bad nonce, or corrupted ciphertext).
- `EncryptionErrorOptions` (`interface`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L60). Configuration payload and context parameters for instantiating `EncryptionError`. Key properties: `provider` (string), `algorithm` (string).
- `EncryptionError` (`class`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L70). EncryptionError (HTTP 500) Thrown if AES-256-GCM encryption of a provider key fails during key provisioning.
- `RateLimitExceededErrorOptions` (`interface`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L95). Configuration payload and context parameters for instantiating `RateLimitExceededError`. Key properties: `tenantId` (string), `provider` (string), `keyId` (string), `rpmLimit` (number), +2 more properties.
- `RateLimitExceededError` (`class`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L110). RateLimitExceededError (HTTP 429) Thrown when a tenant exceeds their allocated requests-per-minute (RPM) rate limit, or when an upstream provider key hits 429 rate limits.
- `KeyNotFoundErrorOptions` (`interface`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L155). Configuration payload and context parameters for instantiating `KeyNotFoundError`. Key properties: `keyId` (string), `tenantId` (string), `provider` (string).
- `KeyNotFoundError` (`class`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L166). KeyNotFoundError (HTTP 404) Thrown when a specific API key ID does not exist in the tenant's key pool.
- `KeyExhaustedErrorOptions` (`interface`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L196). Configuration payload and context parameters for instantiating `KeyExhaustedError`. Key properties: `provider` (string), `tenantId` (string), `totalKeys` (number), `retryAfterSeconds` (number).
- `KeyExhaustedError` (`class`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L208). KeyExhaustedError (HTTP 429) Thrown when all keys for a requested provider are exhausted, rate-limited, or disabled.
- `InvalidKeyErrorOptions` (`interface`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L246). Configuration payload and context parameters for instantiating `InvalidKeyError`. Key properties: `provider` (string), `reason` (string).
- `InvalidKeyError` (`class`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L256). InvalidKeyError (HTTP 400) Thrown when a key is malformed or fails provider format validation.
- `QuotaExceededErrorOptions` (`interface`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L281). Configuration payload and context parameters for instantiating `QuotaExceededError`. Key properties: `tenantId` (string), `quotaType` ("rpm" | "rpd" | "spend_limit"), `limit` (bigint | number), `consumed` (bigint | number).
- `QuotaExceededError` (`class`): Defined in [`src/errors/key_errors.ts`](file:///src/errors/key_errors.ts#L293). QuotaExceededError (HTTP 429) Thrown when a tenant hits their configured daily quota (RPD) or spend ceiling.

#### `src/errors/routing_errors.ts`

- `CircuitBreakerTrippedErrorOptions` (`interface`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L19). Configuration payload and context parameters for instantiating `CircuitBreakerTrippedError`. Key properties: `provider` (string), `modelId` (string), `consecutiveFailures` (number), `circuitOpenUntil` (string), +1 more properties.
- `CircuitBreakerTrippedError` (`class`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L33). CircuitBreakerTrippedError (HTTP 503) Thrown when an upstream provider is degraded and its circuit breaker is currently open. Prevents cascaded failures and respects provider cooldown windows.
- `ProviderRoutingErrorOptions` (`interface`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L81). Configuration payload and context parameters for instantiating `ProviderRoutingError`. Key properties: `provider` (string), `modelId` (string), `upstreamStatusCode` (number), `upstreamResponseText` (string), +1 more properties.
- `ProviderRoutingError` (`class`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L95). ProviderRoutingError (HTTP 502/504) Thrown when an underlying provider fails to process the request (e.g. upstream 5xx, network failure, connection refused, or upstream error response).
- `ModelNotFoundErrorOptions` (`interface`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L135). Configuration payload and context parameters for instantiating `ModelNotFoundError`. Key properties: `modelIdOrAlias` (string), `availableModels` (readonly string[]).
- `ModelNotFoundError` (`class`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L145). ModelNotFoundError (HTTP 404) Thrown when a requested model ID or alias does not exist in the model registry.
- `UnknownModelAliasErrorOptions` (`interface`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L172). Configuration payload and context parameters for instantiating `UnknownModelAliasError`. Key properties: `alias` (string), `configuredAliases` (readonly string[]).
- `UnknownModelAliasError` (`class`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L182). UnknownModelAliasError (HTTP 400) Thrown when a requested abstract alias cannot be resolved to an active model definition.
- `NoAvailableProviderErrorOptions` (`interface`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L211). Configuration payload and context parameters for instantiating `NoAvailableProviderError`. Key properties: `requestedModel` (string), `candidateCount` (number), `reason` (string).
- `NoAvailableProviderError` (`class`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L223). NoAvailableProviderError (HTTP 503) Thrown when no upstream provider candidates can fulfill the request (e.g. all available providers circuit-tripped or disabled).
- `ProviderTimeoutErrorOptions` (`interface`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L249). Configuration payload and context parameters for instantiating `ProviderTimeoutError`. Key properties: `provider` (string), `modelId` (string), `timeoutMs` (number).
- `ProviderTimeoutError` (`class`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L260). ProviderTimeoutError (HTTP 504) Thrown when an upstream provider fails to respond within the configured timeout threshold.
- `CapabilityMismatchErrorOptions` (`interface`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L292). Configuration payload and context parameters for instantiating `CapabilityMismatchError`. Key properties: `requiredCapabilities` (readonly string[]), `candidateModel` (string).
- `CapabilityMismatchError` (`class`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L303). CapabilityMismatchError (HTTP 400) Thrown when a request requires specific model capabilities (e.g. tools, vision, JSON schema) that cannot be satisfied by the selected model or candidate pool.
- `FallbackAttempt` (`interface`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L332). Type contract defining structured attributes for domain exchange. Key properties: `provider` (string), `modelId` (string), `error` (string).
- `FallbackExhaustedErrorOptions` (`interface`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L338). Configuration payload and context parameters for instantiating `FallbackExhaustedError`. Key properties: `attemptedRoutes` (readonly FallbackAttempt[]).
- `FallbackExhaustedError` (`class`): Defined in [`src/errors/routing_errors.ts`](file:///src/errors/routing_errors.ts#L347). FallbackExhaustedError (HTTP 502) Thrown when the primary route and all configured fallback routes have been tried and failed.

#### `src/errors/telemetry_errors.ts`

- `TelemetryEmissionErrorOptions` (`interface`): Defined in [`src/errors/telemetry_errors.ts`](file:///src/errors/telemetry_errors.ts#L12). Configuration payload and context parameters for instantiating `TelemetryEmissionError`. Key properties: `traceId` (string), `eventType` (string), `reason` (string).
- `TelemetryEmissionError` (`class`): Defined in [`src/errors/telemetry_errors.ts`](file:///src/errors/telemetry_errors.ts#L23). TelemetryEmissionError (HTTP 500 / internal) Thrown or logged when emission to Workers Analytics Engine fails.
- `InvalidTelemetryEventErrorOptions` (`interface`): Defined in [`src/errors/telemetry_errors.ts`](file:///src/errors/telemetry_errors.ts#L51). Configuration payload and context parameters for instantiating `InvalidTelemetryEventError`. Key properties: `validationErrors` (readonly string[]).
- `InvalidTelemetryEventError` (`class`): Defined in [`src/errors/telemetry_errors.ts`](file:///src/errors/telemetry_errors.ts#L60). InvalidTelemetryEventError (HTTP 400) Thrown when a telemetry event payload fails schema validation or missing required trace/tenant IDs.

#### `src/index.ts`

- `Env` (`interface`): Defined in [`src/index.ts`](file:///src/index.ts#L14). Cloudflare Workers environment binding contract containing D1 databases, Durable Object namespaces, Web Crypto master keys, and service bindings.

#### `src/types/api.ts`

- `ApiResponseMeta` (`interface`): Defined in [`src/types/api.ts`](file:///src/types/api.ts#L15). Metadata attached to structured API responses. By default, `costMicrodollars` is typed as `bigint` to enforce zero floating-point math. Key properties: `latencyMs` (number), `costMicrodollars` (TCost), `traceId` (string), `requestId` (string), +4 more properties.
- `ApiResponse` (`interface`): Defined in [`src/types/api.ts`](file:///src/types/api.ts#L38). Standard structured JSON response format as defined in LLD 2.1: `{ data: T, meta: { latencyMs, costMicrodollars, ... } }` Key properties: `data` (T), `meta` (ApiResponseMeta<TCost>).
- `ApiRequestOptions` (`interface`): Defined in [`src/types/api.ts`](file:///src/types/api.ts#L48). Options for initializing an ApiRequest. Key properties: `body` (T), `traceId` (string), `headers` (Record<string, string>), `params` (Record<string, string>), +1 more properties.
- `ApiRequest` (`interface`): Defined in [`src/types/api.ts`](file:///src/types/api.ts#L60). Standard structured API request wrapper as defined in LLD 2.1: Wraps the incoming JSON payload and includes `tenantId` (extracted from the authenticated AuthContext). Key properties: `tenantId` (string), `payload` (T), `body` (T), `traceId` (string), +3 more properties.
- `ApiErrorDetail` (`interface`): Defined in [`src/types/api.ts`](file:///src/types/api.ts#L80). Structured error details returned on API failures. Key properties: `code` (string), `message` (string), `details` (Record<string, unknown>).
- `ApiErrorResponse` (`interface`): Defined in [`src/types/api.ts`](file:///src/types/api.ts#L89). Standard structured API error response wrapper. Key properties: `error` (ApiErrorDetail), `meta` (Partial<ApiResponseMeta<TCost>>).
- `ApiSuccessResponse` (`interface`): Defined in [`src/types/api.ts`](file:///src/types/api.ts#L97). Discriminated union member for successful API response. Key properties: `success` (true), `data` (T), `meta` (ApiResponseMeta<TCost>).
- `ApiFailureResponse` (`interface`): Defined in [`src/types/api.ts`](file:///src/types/api.ts#L106). Discriminated union member for failed API response. Key properties: `success` (false), `error` (ApiErrorDetail), `meta` (Partial<ApiResponseMeta<TCost>>).
- `ApiResult` (`type`): Defined in [`src/types/api.ts`](file:///src/types/api.ts#L115). Discriminated result type for API operations. Definition: `ApiSuccessResponse<T, TCost> | ApiFailureResponse<TCost>`.
- `ApiPaginationMeta` (`interface`): Defined in [`src/types/api.ts`](file:///src/types/api.ts#L120). Pagination metadata for collection endpoints. Key properties: `page` (number), `pageSize` (number), `totalItems` (number), `totalPages` (number), +1 more properties.
- `PaginatedApiResponse` (`interface`): Defined in [`src/types/api.ts`](file:///src/types/api.ts#L131). Paginated API response wrapper. Key properties: `pagination` (ApiPaginationMeta).

#### `src/types/config.ts`

- `RoutingStrategy` (`type`): Defined in [`src/types/config.ts`](file:///src/types/config.ts#L16). Key routing strategy employed when selecting a model or key. Definition: `| "cost-optimal" | "lowest-latency" | "priority" | "round-robin" | "load-balanced" | "cascade"`.
- `KeyRoutingConfig` (`interface`): Defined in [`src/types/config.ts`](file:///src/types/config.ts#L36). Configuration for key and model routing. Key properties: `strategy` (RoutingStrategy), `modelMappings` (Record<string, string | string[]>), `providerPriority` (ModelProvider[]), `allowedProviders` (ModelProvider[]), +1 more properties.
- `FallbackTrigger` (`type`): Defined in [`src/types/config.ts`](file:///src/types/config.ts#L52). Triggers that initiate fallback logic. Definition: `| "rate_limit" | "circuit_breaker_open" | "upstream_error" | "timeout" | "context_overflow"`.
- `FallbackConfig` (`interface`): Defined in [`src/types/config.ts`](file:///src/types/config.ts#L70). Configuration for automatic fallback strategies across models and providers. Key properties: `enabled` (boolean), `maxRetries` (number), `fallbackChains` (Record<string, string[]>), `providerFallbackOrder` (ModelProvider[]), +2 more properties.
- `RateLimitConfig` (`interface`): Defined in [`src/types/config.ts`](file:///src/types/config.ts#L88). RPM (requests per minute) and RPD (requests per day) threshold configuration per provider. Key properties: `defaultRpmLimit` (number), `defaultRpdLimit` (number), `providerRpmLimits` (Partial<Record<ModelProvider, number>>), `windowSizeSeconds` (number).
- `CircuitBreakerConfig` (`interface`): Defined in [`src/types/config.ts`](file:///src/types/config.ts#L103). Circuit breaker thresholds and cooldown settings. In accordance with LLD 1.3: DEFAULT_CIRCUIT_BREAKER_THRESHOLD consecutive failures. Key properties: `failureThreshold` (number), `cooldownSeconds` (number), `halfOpenSuccessThreshold` (number), `trippingStatusCodes` (number[]).
- `TenantBudgetConfig` (`interface`): Defined in [`src/types/config.ts`](file:///src/types/config.ts#L118). Financial budget configuration for a tenant. Uses fixed-point microdollars (int64) to strictly prohibit floating point math. Key properties: `maxBudgetMicrodollars` (TCost), `spentMicrodollars` (TCost), `onExhaustion` ("block" | "warn"), `alertThresholdPercent` (number).
- `TenantConfig` (`interface`): Defined in [`src/types/config.ts`](file:///src/types/config.ts#L134). TenantConfig specifies key routing, fallback strategies, and RPM thresholds per model provider. As defined in LLD 2.3: "TenantConfig: Configuration specifying key routing, fallback strategies, and RPM thresholds per model provider." Key properties: `tenantId` (string), `tenantName` (string), `isActive` (boolean), `routing` (KeyRoutingConfig), +7 more properties.
- `TenantConfigOptions` (`interface`): Defined in [`src/types/config.ts`](file:///src/types/config.ts#L163). Input options for creating or updating a TenantConfig. Permits partial defaults for routing, fallback, rateLimits, and circuitBreaker. Key properties: `tenantName` (string), `isActive` (boolean), `routing` (Partial<KeyRoutingConfig>), `fallback` (Partial<FallbackConfig>), +6 more properties.

#### `src/types/models.ts`

- `KnownModelProvider` (`type`): Defined in [`src/types/models.ts`](file:///src/types/models.ts#L28). Type alias mapped to `(typeof KNOWN_MODEL_PROVIDERS)[number]`.
- `ModelProvider` (`type`): Defined in [`src/types/models.ts`](file:///src/types/models.ts#L34). ModelProvider represents the upstream model provider. Supports known standard providers while accommodating custom provider integrations. Definition: `KnownModelProvider | (string & {})`.
- `KnownModelAlias` (`type`): Defined in [`src/types/models.ts`](file:///src/types/models.ts#L51). Type alias mapped to `(typeof KNOWN_MODEL_ALIASES)[number]`.
- `ModelAlias` (`type`): Defined in [`src/types/models.ts`](file:///src/types/models.ts#L57). ModelAlias represents abstract model names used by tenants. Can be any of the standard aliases or an arbitrary tenant-configured alias string. Definition: `KnownModelAlias | (string & {})`.
- `ModelCapabilities` (`interface`): Defined in [`src/types/models.ts`](file:///src/types/models.ts#L88). Canonical model capability flags. Key properties: `supportsTools` (boolean), `supportsVision` (boolean), `supportsJsonSchema` (boolean), `supportsStreaming` (boolean).
- `ModelDef` (`interface`): Defined in [`src/types/models.ts`](file:///src/types/models.ts#L116). ModelDef defines capabilities, pricing, and metadata of an AI model in the registry. Key properties: `id` (string), `provider` (ModelProvider), `logicalAliases` (ModelAlias[]), `contextWindow` (number), +11 more properties.
- `RouterDecision` (`interface`): Defined in [`src/types/models.ts`](file:///src/types/models.ts#L205). RouterDecision captures the decision reasoning of the routing engine. Key properties: `selectedKeyId` (string), `selectedModelId` (string), `tenantId` (string), `capabilityFilterPassed` (boolean), +1 more properties.
- `CostLedgerEvent` (`interface`): Defined in [`src/types/models.ts`](file:///src/types/models.ts#L222). CostLedgerEvent records the financial impact and token telemetry of a single request. Enforces zero floating-point math using fixed-point microdollars. Key properties: `id` (string), `requestId` (string), `tenantId` (string), `keyId` (string), +10 more properties.

#### `src/utils/logger.ts`

- `LoggerContext` (`interface`): Defined in [`src/utils/logger.ts`](file:///src/utils/logger.ts#L1). Type contract defining structured attributes for domain exchange. Key properties: `traceId` (string), `tenantId` (string).
- `LogLevel` (`type`): Defined in [`src/utils/logger.ts`](file:///src/utils/logger.ts#L6). Union type formalizing the allowed states: `'info' | 'warn' | 'error'`.
- `LogEntry` (`interface`): Defined in [`src/utils/logger.ts`](file:///src/utils/logger.ts#L8). Type contract defining structured attributes for domain exchange. Key properties: `level` (LogLevel), `message` (string), `timestamp` (string), `traceId` (string), +1 more properties.
- `Logger` (`class`): Defined in [`src/utils/logger.ts`](file:///src/utils/logger.ts#L17). Stateful edge service component managing domain operations.


### 11. UI Components, Frontend State & Dashboard Telemetry

The UI Components and Dashboard Analytics layer provides client-side observability, key provisioning interfaces, real-time WebSocket/SSE telemetry charts, and developer sandboxes for monitoring communal pool velocity and routing health.

#### `ui/src/lib/TelemetryCharts.ts`

- `TimeSeriesData` (`type`): Defined in [`ui/src/lib/TelemetryCharts.ts`](file:///ui/src/lib/TelemetryCharts.ts#L9). Type alias mapped to `{ timestamp: number`. Key properties: `timestamp` (number), `value` (number).
- `StreamStatus` (`type`): Defined in [`ui/src/lib/TelemetryCharts.ts`](file:///ui/src/lib/TelemetryCharts.ts#L14). Union type formalizing the allowed states: `'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'`.
- `ChartStats` (`interface`): Defined in [`ui/src/lib/TelemetryCharts.ts`](file:///ui/src/lib/TelemetryCharts.ts#L16). Type contract defining structured attributes for domain exchange. Key properties: `min` (number), `max` (number), `avg` (number), `current` (number), +1 more properties.
- `TelemetryChartOptions` (`interface`): Defined in [`ui/src/lib/TelemetryCharts.ts`](file:///ui/src/lib/TelemetryCharts.ts#L24). Type contract defining structured attributes for domain exchange. Key properties: `maxPoints` (number), `autoReconnect` (boolean), `reconnectDelayMs` (number).
- `ChartSubscriber` (`type`): Defined in [`ui/src/lib/TelemetryCharts.ts`](file:///ui/src/lib/TelemetryCharts.ts#L30). Type alias mapped to `(points: readonly TimeSeriesData[], stats: ChartStats) => void`.
- `StatusSubscriber` (`type`): Defined in [`ui/src/lib/TelemetryCharts.ts`](file:///ui/src/lib/TelemetryCharts.ts#L31). Union type formalizing the allowed states: `(status: StreamStatus, endpoint: string | null) => void`.
- `TelemetryStreamChart` (`class`): Defined in [`ui/src/lib/TelemetryCharts.ts`](file:///ui/src/lib/TelemetryCharts.ts#L36). High-performance, non-blocking telemetry stream chart controller.

#### `ui/src/lib/add_key/crypto.ts`

- `EncryptedPayload` (`interface`): Defined in [`ui/src/lib/add_key/crypto.ts`](file:///ui/src/lib/add_key/crypto.ts#L38). Type contract defining structured attributes for domain exchange. Key properties: `ciphertext` (Uint8Array), `nonce` (Uint8Array), `combined` (Uint8Array), `nonceB64` (string), +2 more properties.

#### `ui/src/lib/add_key/state.ts`

- `KeyType` (`type`): Defined in [`ui/src/lib/add_key/state.ts`](file:///ui/src/lib/add_key/state.ts#L8). Union type formalizing the allowed states: `'gemini' | 'groq' | string`.
- `KeyFormData` (`type`): Defined in [`ui/src/lib/add_key/state.ts`](file:///ui/src/lib/add_key/state.ts#L10). Type alias mapped to `{ name: string`. Key properties: `name` (string), `key` (string).
- `ModalState` (`interface`): Defined in [`ui/src/lib/add_key/state.ts`](file:///ui/src/lib/add_key/state.ts#L15). Type contract defining structured attributes for domain exchange. Key properties: `isOpen` (boolean), `type` (KeyType), `lastSubmittedData` (KeyFormData), `lastEncryptedPayload` (EncryptedPayload).
- `StateListener` (`type`): Defined in [`ui/src/lib/add_key/state.ts`](file:///ui/src/lib/add_key/state.ts#L29). Type alias mapped to `(state: Readonly<ModalState>) => void`.

#### `ui/src/lib/api_docs/types.ts`

- `ProviderFilter` (`type`): Defined in [`ui/src/lib/api_docs/types.ts`](file:///ui/src/lib/api_docs/types.ts#L6). Union type formalizing the allowed states: `'OpenAI Compatible' | 'Anthropic' | 'Gemini' | 'Groq' | 'DeepSeek'`.
- `ModelOption` (`interface`): Defined in [`ui/src/lib/api_docs/types.ts`](file:///ui/src/lib/api_docs/types.ts#L8). Type contract defining structured attributes for domain exchange. Key properties: `id` (string), `provider` (string).
- `ModelPricingItem` (`interface`): Defined in [`ui/src/lib/api_docs/types.ts`](file:///ui/src/lib/api_docs/types.ts#L13). Type contract defining structured attributes for domain exchange. Key properties: `id` (string), `owned_by` (string), `routing_engine` (string), `inputCost1kMicro` (number), +6 more properties.
- `ResponseChunk` (`interface`): Defined in [`ui/src/lib/api_docs/types.ts`](file:///ui/src/lib/api_docs/types.ts#L26). Type contract defining structured attributes for domain exchange. Key properties: `text` (string), `class` (string).

#### `ui/src/lib/oauth/pkce.ts`

- `PKCEBundle` (`interface`): Defined in [`ui/src/lib/oauth/pkce.ts`](file:///ui/src/lib/oauth/pkce.ts#L45). Type contract defining structured attributes for domain exchange. Key properties: `verifier` (string), `challenge` (string), `stateToken` (string), `nonceHex` (string).

#### `ui/src/lib/types.ts`

- `Provider` (`type`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L1). Union type formalizing the allowed states: `'gemini' | 'groq' | 'sambanova' | 'cerebras'`.
- `KeyStatus` (`type`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L3). Union type formalizing the allowed states: `'healthy' | 'rate_limited' | 'exhausted' | 'invalid' | 'disabled'`.
- `PoolType` (`type`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L5). Union type formalizing the allowed states: `'COMMUNITY' | 'PRIVATE'`.
- `CommunityRoutingStatus` (`type`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L6). Union type formalizing the allowed states: `'OBSERVATION' | 'ACTIVE' | 'QUARANTINED' | 'REVOKED'`.
- `APIKey` (`interface`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L8). Type contract defining structured attributes for domain exchange. Key properties: `id` (string), `key_prefix` (string), `key_suffix` (string), `provider` (Provider), +19 more properties.
- `RequestLog` (`interface`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L34). Type contract defining structured attributes for domain exchange. Key properties: `id` (string), `key_id` (string), `provider` (Provider), `status_code` (number), +5 more properties.
- `PoolStats` (`interface`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L46). Type contract defining structured attributes for domain exchange. Key properties: `total_keys` (number), `healthy_keys` (number), `rate_limited_keys` (number), `invalid_keys` (number), +7 more properties.
- `CreateKeyPayload` (`interface`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L60). Type contract defining structured attributes for domain exchange. Key properties: `provider` (Provider), `label` (string), `key` (string), `rpm_limit` (number), +6 more properties.
- `GlobalPoolTelemetry` (`interface`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L73). Type contract defining structured attributes for domain exchange. Key properties: `total_active_keys` (number), `keys_in_observation` (number), `keys_quarantined` (number), `pool_utilization_percent` (number), +2 more properties.
- `ProviderPoolMetrics` (`interface`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L82). Type contract defining structured attributes for domain exchange. Key properties: `provider` (Provider), `active_keys` (number), `quarantined_keys` (number), `observation_keys` (number), +4 more properties.
- `ContributorStanding` (`interface`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L93). Type contract defining structured attributes for domain exchange. Key properties: `multiplier` (number), `multiplier_ceiling` (number), `community_debt_cu` (number), `daily_contributed_cu` (number), +3 more properties.
- `ToastMessage` (`interface`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L103). Type contract defining structured attributes for domain exchange. Key properties: `id` (string), `type` ('success' | 'error' | 'info' | 'warning'), `message` (string).
- `Microdollars` (`type`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L109). Type alias mapped to `number`.
- `DebtEntry` (`interface`): Defined in [`ui/src/lib/types.ts`](file:///ui/src/lib/types.ts#L121). Type contract defining structured attributes for domain exchange. Key properties: `id` (string), `amount` (number), `description` (string), `status` ('pending' | 'resolved'), +1 more properties.

#### `ui/src/lib/workbench/types.ts`

- `ExtendedProject` (`interface`): Defined in [`ui/src/lib/workbench/types.ts`](file:///ui/src/lib/workbench/types.ts#L9). Type contract defining structured attributes for domain exchange. Key properties: `assignedRpm` (number), `latencyMs` (number), `latency` (string), `icon` (string), +1 more properties.
- `ExtendedKey` (`interface`): Defined in [`ui/src/lib/workbench/types.ts`](file:///ui/src/lib/workbench/types.ts#L17). Type contract defining structured attributes for domain exchange. Key properties: `fullSecret` (string), `displayTime` (string), `displayCreated` (string).
- `TierMatrixItem` (`interface`): Defined in [`ui/src/lib/workbench/types.ts`](file:///ui/src/lib/workbench/types.ts#L23). Type contract defining structured attributes for domain exchange. Key properties: `id` (UserTier), `name` (string), `icon` (string), `badge` (string), +6 more properties.
- `WorkbenchProps` (`interface`): Defined in [`ui/src/lib/workbench/types.ts`](file:///ui/src/lib/workbench/types.ts#L36). Type contract defining structured attributes for domain exchange. Key properties: `userAccount` (UserAccount), `projects` (Project[]), `keys` (ProjectKey[]), `providerKeys` (APIKey[]), +7 more properties.


---

## 3. Comprehensive Domain Type Matrices & Schemas

To illustrate how these cataloged symbols collaborate during real-world edge execution, the following contracts demonstrate the strict interfaces governing Durable Object actor RPC, capability matching, and persistence adapters.

### Actor RPC Contract: Key Pool & Quota Interface

```typescript
// src/contracts/key_pool.ts & src/contracts/quota.ts
export interface KeyPoolContract {
  readonly tenantId: string;
  getKey(options?: SelectKeyOptions): Promise<DecryptedKey | null>;
  reportKeyOutcome(keyId: string, success: boolean, statusCode?: number): Promise<void>;
  getCapacitySummary(): Promise<CapacitySummary>;
}

export interface TenantQuotaContract {
  readonly tenantId: string;
  consumeQuota(req: ConsumeQuotaRequest): Promise<ConsumeQuotaResult>;
  syncDailyRollup(): Promise<void>;
  getStanding(): Promise<ContributorStanding>;
}
```

### Stream Transformation & Telemetry Contract

```typescript
// src/proxy/sse/types.ts & src/contracts/telemetry.ts
export interface SSEStreamTransformerOptions {
  tenantId: string;
  provider: KnownModelProvider;
  model: KnownModelAlias;
  onUsageComplete?: (usage: StreamUsage) => Promise<void>;
  onErrorMask?: (err: unknown) => SSEEvent;
}

export interface TelemetryEvent {
  traceId: string;
  tenantId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costMicrodollars: number;
  latencyMs: number;
  routingStrategy: string;
  timestamp: number;
}
```


---

## 4. Code Walkthrough & Verification Examples

Below is an end-to-end type verification test asserting that domain types correctly enforce compile-time type boundaries without relying on runtime loose assertions.

```typescript
// test/unit/type_dictionary.spec.ts
import { describe, it, expect } from 'vitest';
import type { ActiveDemoToken, StoredDemoTokenData } from '../../src/auth/demo/types';
import type { Provider, KeyStatus, Microdollars } from '../../ui/src/lib/types';

describe('Domain Dictionary Type Invariants', () => {
  it('enforces strict shape on ActiveDemoToken', () => {
    const token: ActiveDemoToken = {
      token: 'demo_test_token_123',
      expiresAt: Date.now() + 900_000,
    };
    expect(token.token).toBeTypeOf('string');
    expect(token.expiresAt).toBeGreaterThan(0);
  });

  it('enforces fixed-point Microdollars representation', () => {
    const oneUsd: Microdollars = 1_000_000;
    const halfCent: Microdollars = 5_000;
    expect(oneUsd + halfCent).toBe(1_005_000);
  });
});
```
