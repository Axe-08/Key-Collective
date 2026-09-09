---
file: docs/codeflow/sse_transformer_and_upstream_client_cfg.md
project: Key Collective
purity: [🟡 I/O Bound]
cyclomatic_avg: 5
date: 2026-09-10
tags: [type/codeflow, Key Collective]
---

# 📄 Codeflow: `docs/codeflow/sse_transformer_and_upstream_client_cfg.md`

> **Module Responsibility:** Passthrough streaming transformation, usage tracking, and upstream proxy requests.
> **Purity Profile:** `🟡 I/O Bound`

---

## 1. 🕸️ Inbound & Outbound Dependency Graph
```mermaid
graph LR
    subgraph Callers
        RouterHandler[Router Handler]
    end
    subgraph `sse_and_upstream`
        UpstreamClient_forwardRequest[UpstreamClient.forwardRequest]
        UpstreamClient_rewriteHeaders[UpstreamClient.rewriteHeaders]
        SSEStreamTransformer_transform[SSEStreamTransformer.transform]
        SSEStreamTransformer_parseUsageBlock[SSEStreamTransformer.parseUsageBlock]
    end
    subgraph Callees
        ProviderAPI[Provider Upstream API]
        TransformStream[Web Streams API]
    end

    RouterHandler --> UpstreamClient_forwardRequest
    UpstreamClient_forwardRequest --> UpstreamClient_rewriteHeaders
    UpstreamClient_forwardRequest --> ProviderAPI
    UpstreamClient_forwardRequest --> SSEStreamTransformer_transform
    SSEStreamTransformer_transform --> SSEStreamTransformer_parseUsageBlock
    SSEStreamTransformer_transform --> TransformStream
```

---

## 2. 🔍 Function Logic & Control Flow Deep Dive

### `def UpstreamClient.forwardRequest(req, key, provider) -> Response`
* **Purity:** `🟡 I/O Bound`
* **Complexity:** Cyclomatic: `4` | Cognitive: `5`

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    Start[Start: forwardRequest] --> RewriteHeaders[Rewrite Headers & Inject Key]
    RewriteHeaders --> Fetch[Fetch Upstream API]
    Fetch --> Ok{Is OK?}
    Ok -- No --> ThrowHttp[Throw ProviderRoutingError]
    Ok -- Yes --> IsStream{Is Streaming?}
    IsStream -- No --> ReturnJSON[Return Buffered JSON]
    IsStream -- Yes --> Transform[Apply SSEStreamTransformer]
    Transform --> ReturnStream[Return Streaming Response]
```

#### Def-Use Data Flow Matrix
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `req` | Argument | Body cloned, Headers modified | Sent via fetch |
| `key` | Argument | Injected into Auth header | Sent via fetch |

#### Edge Cases & Exception Audit
- ⚠️ **Edge Case 1:** Upstream timeout or connection reset.
- ⚠️ **Edge Case 2:** Malformed upstream SSE payload.

---

### `def SSEStreamTransformer.transform(stream) -> ReadableStream`
* **Purity:** `🟡 I/O Bound`
* **Complexity:** Cyclomatic: `6` | Cognitive: `6`

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    Start[Start: transform] --> ReadChunk[Read Chunk from Upstream]
    ReadChunk --> EOF{Is EOF?}
    EOF -- Yes --> CloseStream[Close Outbound Stream]
    EOF -- No --> ParseLine[Parse SSE Line]
    ParseLine --> IsUsage{Contains Usage block?}
    IsUsage -- Yes --> ExtractUsage[Extract Token Usage]
    IsUsage -- No --> EmitChunk[Emit Chunk Unchanged]
    ExtractUsage --> EmitChunk
    EmitChunk --> ReadChunk
```

#### Def-Use Data Flow Matrix
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `stream` | Argument | Read chunk-by-chunk | Piped to new stream |
| `usage` | Local | Parsed from JSON | Yielded to usage callback |

#### Edge Cases & Exception Audit
- ⚠️ **Edge Case 1:** Split chunks where usage block is broken across TCP packets.

---

## 3. 🛠️ Code Review & Optimization Notes
- **Refactoring:** Use TextDecoderStream for cleaner chunk processing.
- **Strengths:** 0ms latency added for streaming text.

## 🔗 Related Workflows & MOC
- [[codebase-scribe-workflow]]
- [[Templates-Index]]
