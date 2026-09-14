---
file: src/worker/router_handler.ts
project: Key-Collective
purity: 🟡 I/O Bound
cyclomatic_avg: 2.8
date: 2026-09-15
tags: [type/codeflow, Key-Collective, edge-worker, router]
---

# 📄 Codeflow: `src/worker/router_handler.ts`

> **Module Responsibility:** Cloudflare Worker edge HTTP request router, Per-Tenant Durable Object key-pool dispatch, multi-model cascade resolution, and non-blocking streaming telemetry & cost recording.
> **Purity Profile:** `🟡 I/O Bound` (dispatches edge fetch RPC, coordinates D1 persistence via non-blocking `ctx.waitUntil`, and emits Workers Analytics Engine events).

---

## 1. 🕸️ Inbound & Outbound Dependency Graph

```mermaid
graph LR
    subgraph Callers
        WorkerEntry["src/worker/index.ts (fetch)"]
        TestHarness["src/worker/router_handler.test.ts"]
    end
    subgraph `src/worker/router_handler.ts`
        Handle["RouterHandler.handle(req, env, ctx)"]
        HandleChat["RouterHandler.handleChatCompletions(...)"]
        HandleStream["RouterHandler.handleStreamingResponse(...)"]
        HandleDashboard["RouterHandler.handleDashboardApi(...)"]
        DOClient["DurableObjectKeyPoolClient"]
    end
    subgraph Callees
        AuthMid["AuthMiddleware.authenticate"]
        Cascade["CascadeRouter.route"]
        KeyPoolDO["KeyPoolDO (RPC / Fetch)"]
        CostLedger["CostLedgerRepository.recordEvent"]
        Telemetry["TelemetryEmitter.emit"]
    end

    WorkerEntry --> Handle
    TestHarness --> Handle
    Handle --> AuthMid
    Handle --> HandleDashboard
    Handle --> HandleChat
    HandleChat --> Cascade
    Cascade --> DOClient
    DOClient --> KeyPoolDO
    HandleChat --> HandleStream
    HandleStream --> CostLedger
    HandleStream --> Telemetry
```

---

## 2. 🔍 Core Function Logic & Control Flow Deep Dive

### `public async handle(request: Request, env: WorkerEnv, ctx?: ExecutionContextLike, preAuthenticatedContext?: AuthenticatedContext): Promise<Response>`
* **Purity:** `🟡 I/O Bound`
* **Complexity:** Cyclomatic: 8 | Cognitive: 7

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    Start([Inbound HTTP Request]) --> FreezeCheck{MIDNIGHT_FREEZE active?}
    FreezeCheck -->|Yes| RetFreeze[Return HTTP 503 Maintenance]
    FreezeCheck -->|No| TraceGen[Resolve or Generate x-kc-trace-id]
    
    TraceGen --> HealthCheck{Path == /health or /v1/health?}
    HealthCheck -->|Yes| RetHealth[Return HTTP 200 Healthy JSON]
    HealthCheck -->|No| DashboardCheck{Path starts with /api/?}
    
    DashboardCheck -->|Yes| ExecDashboard[handleDashboardApi: keys, stats, logs, oauth]
    DashboardCheck -->|No| AuthPhase[Authenticate via AuthMiddleware]
    
    AuthPhase --> IsoGate{Header x-tenant-id matches Token tenantId?}
    IsoGate -->|Mismatch| ErrIso[Throw TenantIsolationError HTTP 403]
    IsoGate -->|Valid| RoutePath{Path Dispatch}
    
    RoutePath -->|GET /v1/models| RetModels[Return Filtered Models List]
    RoutePath -->|POST /v1/chat/completions| ChatParse[Parse JSON & HandleChatCompletions]
    RoutePath -->|/v1/keys or /v1/metrics| ForwardDO[forwardToDO RPC Proxy]
    RoutePath -->|Unknown| Ret404[Return HTTP 404 Route Not Found]

    ChatParse --> StreamFork{stream == true?}
    StreamFork -->|Yes| StreamPipe[handleStreamingResponse: 0ms Passthrough + Async Ledger]
    StreamFork -->|No| NonStreamExec[handleNonStreamingResponse: Complete & Cost Record]
    
    ErrIso --> ErrCatch[Format Error Response & Emit Error Telemetry]
    RetFreeze --> Done([Response Sent])
    RetHealth --> Done
    ExecDashboard --> Done
    RetModels --> Done
    StreamPipe --> Done
    NonStreamExec --> Done
    Ret404 --> Done
    ErrCatch --> Done
```

#### Def-Use Data Flow Matrix
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `request` | Edge Fetch Event | Read headers, method, URL, and body stream | Passed to Route Handlers & Auth |
| `traceId` | Inbound Header / `randomUUID()` | Validated / Fallback generated | Forwarded in downstream headers, D1 ledger, Telemetry |
| `authContext` | `AuthMiddleware` | Decoded token, asserted tenant boundary | Invariant guard against cross-tenant state leak |
| `cascadeRes` | `CascadeRouter.route()` | Dynamic model fallback resolution | Returned as stream/body, recorded in cost ledger |
| `ctx` | Cloudflare Worker runtime | Non-blocking execution context | `ctx.waitUntil(finalizeStream)` |

#### Edge Cases & Exception Audit
- ⚠️ **Edge Case 1: Tenant Boundary Breach:** Inbound client passes `x-tenant-id: tenant_b` with a valid Bearer token for `tenant_a`. Trapped immediately with `TenantIsolationError` (HTTP 403) before any Durable Object stub lookup.
- ⚠️ **Edge Case 2: Client Disconnect during SSE Stream:** Cloudflare worker aborts stream reading early; `finalizeStream` still captures accumulated prompt and partial completion tokens and flushes them to D1 without throwing unhandled exceptions.

---

## 3. 🛠️ Code Review & Optimization Notes
- **Strengths:** Zero-blocking hot path using `ctx.waitUntil()`, strictly typed error serialization through `formatRouterError()`, and fixed-point microdollar accounting (`int64` / `bigint`).
- **Optimization:** Dynamic model registry is lazily instantiated to minimize isolate cold-start overhead (<15ms).
