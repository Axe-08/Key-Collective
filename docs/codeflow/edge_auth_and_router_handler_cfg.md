---
file: docs/codeflow/edge_auth_and_router_handler_cfg.md
project: Key Collective
purity: [🟡 I/O Bound]
cyclomatic_avg: 5
date: 2026-09-10
tags: [type/codeflow, Key Collective]
---

# 📄 Codeflow: `docs/codeflow/edge_auth_and_router_handler_cfg.md`

> **Module Responsibility:** Edge Authentication, Token Validation, RPM Checking & Budget Gating. Model Routing, DO Dispatch, and Streaming Response Passthrough.
> **Purity Profile:** `🟡 I/O Bound`

---

## 1. 🕸️ Inbound & Outbound Dependency Graph
```mermaid
graph LR
    subgraph Callers
        WorkerFetch[Worker fetch Event]
    end
    subgraph `edge_auth_and_router`
        AuthMiddleware_extractBearerToken[AuthMiddleware.extractBearerToken]
        AuthMiddleware_authenticate[AuthMiddleware.authenticate]
        RouterHandler_handle[RouterHandler.handle]
        RouterHandler_dispatchStreamingResponse[RouterHandler.dispatchStreamingResponse]
        RouterHandler_dispatchNonStreamingResponse[RouterHandler.dispatchNonStreamingResponse]
    end
    subgraph Callees
        D1Database[D1 Database]
        RateLimiter_check[RateLimiter.checkLimitDetailed]
        KeyPoolDO[Key Pool DO RPC]
        Upstream_fetch[Upstream Fetch]
    end

    WorkerFetch --> RouterHandler_handle
    RouterHandler_handle --> AuthMiddleware_authenticate
    AuthMiddleware_authenticate --> AuthMiddleware_extractBearerToken
    AuthMiddleware_authenticate --> D1Database
    AuthMiddleware_authenticate --> RateLimiter_check
    RouterHandler_handle --> RouterHandler_dispatchStreamingResponse
    RouterHandler_handle --> RouterHandler_dispatchNonStreamingResponse
    RouterHandler_dispatchStreamingResponse --> KeyPoolDO
    RouterHandler_dispatchStreamingResponse --> Upstream_fetch
```

---

## 2. 🔍 Function Logic & Control Flow Deep Dive

### `def AuthMiddleware.authenticate(request, env, options) -> AuthenticatedContext`
* **Purity:** `🟡 I/O Bound`
* **Complexity:** Cyclomatic: `8` | Cognitive: `10`

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    Start[Start: authenticate] --> ExtractToken[Extract Bearer Token]
    ExtractToken --> ValidFormat{Is Format Valid?}
    ValidFormat -- No --> ThrowAuthErr[Throw AuthenticationError]
    ValidFormat -- Yes --> D1Lookup[Lookup Token in D1]
    D1Lookup --> TokenExists{Token Exists?}
    TokenExists -- No --> ThrowAuthErr2[Throw AuthenticationError]
    TokenExists -- Yes --> CheckExpiry{Is Expired?}
    CheckExpiry -- Yes --> ThrowAuthErr3[Throw AuthenticationError]
    CheckExpiry -- No --> CheckProvider{Provider Allowed?}
    CheckProvider -- No --> ThrowAuthErr4[Throw AuthenticationError]
    CheckProvider -- Yes --> CheckBudget{Budget Sufficient?}
    CheckBudget -- No --> ThrowQuotaErr[Throw QuotaExceededError]
    CheckBudget -- Yes --> CheckRPM[Check Rate Limit]
    CheckRPM --> RpmOk{Allowed?}
    RpmOk -- No --> ThrowRPMErr[Throw RateLimitExceededError]
    RpmOk -- Yes --> Increment[Increment Rate Limiter]
    Increment --> ReturnCtx[Return AuthenticatedContext]
```

#### Def-Use Data Flow Matrix
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `request` | Argument | Header extracted | N/A |
| `rawToken` | Local | Sanitized & Trimmed | Used for D1 lookup |
| `record` | D1 DB | Validated | Returned in context |

#### Edge Cases & Exception Audit
- ⚠️ **Edge Case 1:** Token missing or malformed header format.
- ⚠️ **Edge Case 2:** Expiration time has passed mid-flight.

---

### `def RouterHandler.handle(request, env, ctx, preAuthCtx) -> Response`
* **Purity:** `🟡 I/O Bound`
* **Complexity:** Cyclomatic: `7` | Cognitive: `8`

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    Start[Start: handle] --> ExtractPath[Parse URL & Trace ID]
    ExtractPath --> CheckAuth{Is Authenticated?}
    CheckAuth -- No --> DoAuth[AuthMiddleware.authenticate]
    CheckAuth -- Yes --> VerifyIsolation[Verify Tenant Isolation Header]
    DoAuth --> VerifyIsolation
    VerifyIsolation --> IsValid{Header matches Token?}
    IsValid -- No --> ThrowIsolErr[Throw TenantIsolationError]
    IsValid -- Yes --> RouteSwitch{Match Route}
    RouteSwitch -- Health --> RetHealth[Return Health JSON]
    RouteSwitch -- Models --> RetModels[Handle Models API]
    RouteSwitch -- Keys --> FwdDO[Forward to DO]
    RouteSwitch -- Completions --> ChatCompletions[handleChatCompletions]
    RouteSwitch -- Default --> Ret404[Return 404 Not Found]
```

#### Def-Use Data Flow Matrix
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `request` | Argument | JSON parsed | Forwarded to routes |
| `traceId` | Header/Gen | Used in telemetry | Emitted to telemetry |

#### Edge Cases & Exception Audit
- ⚠️ **Edge Case 1:** Pre-authenticated context vs header mismatch.
- ⚠️ **Edge Case 2:** Malformed JSON in completion body.

---

## 3. 🛠️ Code Review & Optimization Notes
- **Refactoring:** Consider splitting route matching into explicit controller classes for cleaner testing.
- **Strengths:** Strict types, clean encapsulation, distinct error classes.

## 🔗 Related Workflows & MOC
- [[codebase-scribe-workflow]] — Used in Codebase Scribe & Cartographer
- [[Templates-Index]] — Master Index of Workflows
