# Chapter 5.4: Observability, Distributed Tracing & Telemetry Architecture

Operating an edge proxy network processing hundreds of millions of requests monthly requires comprehensive, zero-latency observability. Traditional Application Performance Monitoring (APM) agents—such as Datadog, New Relic, or OpenTelemetry daemon sidecars—cannot run inside V8 isolates due to memory constraints, process isolation, and runtime overhead.

Key Collective implements a **non-blocking observability architecture** built on two open standards:
1. **W3C Distributed Tracing (`traceparent`)** for cross-boundary context propagation.
2. **Cloudflare Workers Analytics Engine (WAE)** for zero-cost, high-velocity timeseries event streaming.

---

## 1. W3C Distributed Tracing Architecture

Distributed tracing allows developers to track the end-to-end journey of an inference request as it crosses network boundaries: from client applications through Cloudflare edge isolates, across Durable Object boundaries, and out to third-party LLM providers.

Every incoming request enters the gateway with or without an existing W3C `traceparent` header conforming to the formal specification:
$$\text{traceparent} = \text{version}-\text{trace\_id}-\text{parent\_id}-\text{trace\_flags}$$

- `version`: Always `00` (hex).
- `trace_id`: 32-character hexadecimal string uniquely identifying the global transaction.
- `parent_id`: 16-character hexadecimal string representing the immediate upstream caller span.
- `trace_flags`: 8-bit field where `01` signifies the trace is sampled.

```mermaid
sequenceDiagram
    autonumber
    participant Client as Client Application
    participant Gateway as MainWorker Gateway
    participant Actor as KeyPoolDO Isolate
    participant Upstream as Upstream Provider (OpenAI)

    Client->>Gateway: POST /v1/chat/completions (traceparent: 00-4bf92f...-00f067...-01)
    Note over Gateway: Extract or generate traceparent.<br/>Create Child Span (spanId: a1b2c3...)
    Gateway->>Actor: selectAndDecryptKey(traceContext)
    Note over Actor: Execute in-memory key selection.<br/>Propagate trace context.
    Actor-->>Gateway: Decrypted Key + Span Metadata
    Gateway->>Upstream: POST /v1/chat/completions (traceparent: 00-4bf92f...-a1b2c3...-01)
    Upstream-->>Gateway: HTTP 200 SSE Stream
    Gateway-->>Client: Response (x-kc-trace-id: 4bf92f...)
```

```typescript
// src/worker/tracing.ts
export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

export function extractOrGenerateTrace(request: Request): TraceContext {
  const header = request.headers.get("traceparent");
  if (header) {
    const parts = header.trim().split("-");
    if (parts.length === 4 && parts[0] === "00") {
      return {
        traceId: parts[1],
        spanId: parts[2],
        sampled: parts[3] === "01",
      };
    }
  }

  // Generate cryptographically secure random identifiers
  const buffer = new Uint8Array(24);
  crypto.getRandomValues(buffer);
  const hex = Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");

  return {
    traceId: hex.substring(0, 32),
    spanId: hex.substring(32, 48),
    sampled: true,
  };
}
```

---

## 2. Workers Analytics Engine Telemetry Pipeline

Emitting metrics by writing rows to an external database during request processing adds 20–50ms of blocking I/O to the critical path. 

Key Collective utilizes **Cloudflare Workers Analytics Engine (WAE)**, which writes structured telemetry packets directly to edge hardware buffers. The runtime flushes these buffers asynchronously in the background via `ctx.waitUntil()`:

```typescript
// src/worker/telemetry_emitter.ts
export interface TelemetryPayload {
  tenantId: string;
  provider: string;
  model: string;
  routeType: "PRIVATE" | "COMMUNAL" | "FALLBACK";
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  costMicrodollars: number;
  statusCode: number;
  errorCode?: string;
}

export function emitTelemetry(env: Env, ctx: ExecutionContext, payload: TelemetryPayload): void {
  if (!env.ANALYTICS_ENGINE) return;

  // ctx.waitUntil decouples telemetry emission from HTTP response delivery
  ctx.waitUntil(
    Promise.resolve().then(() => {
      env.ANALYTICS_ENGINE.writeDataPoint({
        blobs: [
          payload.tenantId,
          payload.provider,
          payload.model,
          payload.routeType,
          payload.errorCode ?? "NONE",
        ],
        doubles: [
          payload.durationMs,
          payload.promptTokens,
          payload.completionTokens,
          payload.costMicrodollars,
          payload.statusCode,
        ],
        indexes: [payload.tenantId],
      });
    })
  );
}
```

---

## 3. Core Service Level Indicators (SLIs) & Objectives (SLOs)

| Service Level Indicator (SLI) | Target Objective (SLO) | Measurement Window | Alert Threshold |
|---|---|---|---|
| **Proxy Routing Overhead** | P99 $< 15\text{ms}$ | 5-minute rolling window | $> 25\text{ms}$ for $>3\text{ minutes}$ |
| **Time to First Token (TTFT)** | P90 $< 600\text{ms}$ | 10-minute rolling window | $> 1200\text{ms}$ for $>5\text{ minutes}$ |
| **Zero Secret Leakage** | $100.000\%$ (Zero leaks) | Continuous stream audit | $\ge 1$ leak (Immediate SEV-1) |
| **Communal Pool Availability** | $\ge 99.95\%$ success | 1-hour rolling window | $< 99.0\%$ for $>10\text{ minutes}$ |
| **Financial Ledger Drift** | $0\text{ µ\$}$ drift | 24-hour daily rollup | Variance $\neq 0\text{ µ\$}$ |

---

## 4. Self-Check Active Recall Quiz

1. **Question:** Why does Key Collective emit telemetry using Cloudflare Workers Analytics Engine rather than executing an SQL insert into D1?
<details>
<summary>Click to reveal answer</summary>
Workers Analytics Engine flushes telemetry asynchronously via <code>ctx.waitUntil()</code> without performing blocking I/O on the request hot-path, whereas a synchronous D1 write adds 25–80ms of database latency to Time to First Token.
</details>

2. **Question:** How does the proxy ensure that upstream model providers receive distributed trace context from downstream clients?
<details>
<summary>Click to reveal answer</summary>
The gateway extracts the client's W3C <code>traceparent</code> header (or generates a fresh one if absent), creates a child span identifier, and injects the updated <code>traceparent</code> into the outbound HTTP request forwarded to the upstream provider.
</details>
