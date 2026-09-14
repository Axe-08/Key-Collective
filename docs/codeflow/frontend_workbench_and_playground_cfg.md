---
file: ui/src/lib/Workbench.svelte & ui/src/lib/Playground.svelte
project: Key-Collective
purity: 🟡 I/O Bound
cyclomatic_avg: 3.5
date: 2026-09-15
tags: [type/codeflow, Key-Collective, svelte5, frontend, playground, workbench]
---

# 📄 Codeflow: `ui/src/lib/Workbench.svelte` & `ui/src/lib/Playground.svelte`

> **Module Responsibility:** Developer Workbench (client virtual key provisioning, multi-project sub-caps, and credential management) and Playground (interactive model testbench, SSE streaming inspection, latency profiling, and real-time microdollar spend feedback).
> **Purity Profile:** `🟡 I/O Bound` (executes client HTTP/SSE fetch operations, manages Svelte 5 reactive runes `$state`, `$derived`, `$props`, and dispatches parent metric updates).

---

## 1. 🕸️ Inbound & Outbound Dependency Graph

```mermaid
graph LR
    subgraph UI Root
        App["ui/src/App.svelte"]
        SideNav["ui/src/lib/SideNavBar.svelte"]
    end
    subgraph Svelte Components
        Workbench["Workbench.svelte"]
        Playground["Playground.svelte"]
        Api["ui/src/lib/api.ts"]
    end
    subgraph Edge Worker Endpoints
        ModelsAPI["GET /v1/models"]
        CompletionsAPI["POST /v1/chat/completions"]
        KeysAPI["GET /api/keys, POST /api/keys"]
        TokensAPI["POST /v1/auth/tokens"]
    end

    App --> Workbench
    App --> Playground
    SideNav --> App
    Workbench --> Api
    Workbench --> KeysAPI
    Workbench --> TokensAPI
    Playground --> ModelsAPI
    Playground --> CompletionsAPI
    Playground -.->|onRefreshMetrics| App
```

---

## 2. 🔍 Core Component Logic & Control Flow Deep Dive

### `Playground.svelte: executeCompletion()`
* **Purity:** `🟡 I/O Bound`
* **Complexity:** Cyclomatic: 6 | Cognitive: 5

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    Click([Run / Send Request Clicked]) --> InitState[Set isStreaming=true, outputText='', error=null]
    InitState --> BuildPayload[Construct OpenAI-compatible JSON body: model, messages, stream, temp]
    BuildPayload --> StartClock[Record requestStart = performance.now]
    BuildPayload --> FetchExec[fetch POST /v1/chat/completions with AbortController]
    
    FetchExec --> RespCheck{res.ok?}
    RespCheck -->|No| HandleHttpErr[Parse JSON error / status, set errorMessage, isStreaming=false]
    RespCheck -->|Yes: 200 OK| ExtractHeaders[Extract x-request-cost-micros, x-kc-trace-id, x-model-fallback]
    
    ExtractHeaders --> StreamCheck{stream == true?}
    StreamCheck -->|No| ReadBuffered[Read res.json, append content to outputText]
    StreamCheck -->|Yes| StreamInit[Acquire reader = res.body.getReader with TextDecoder]
    
    StreamInit --> ReadLoop{reader.read()}
    ReadLoop -->|done: true| StreamEnd[Calculate final latencyMs, isStreaming=false]
    ReadLoop -->|chunk received| ParseSSE[Split by 'data: ' and parse chunks]
    ParseSSE --> AppendText[Append delta text to outputText in real-time]
    AppendText --> ReadLoop
    
    ReadBuffered --> StreamEnd
    StreamEnd --> CallbackTrigger[Call onRefreshMetrics() to update overview counters]
    HandleHttpErr --> CallbackTrigger
    CallbackTrigger --> Terminate([Idle])
```

#### Def-Use Data Flow Matrix: `executeCompletion`
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `selectedModel` | User Select Input | Resolved against `/v1/models` | Injected into request body payload |
| `reader` | `res.body.getReader()` | Decoded via `TextDecoder` SSE stream | Emits delta tokens to `outputText` |
| `x-request-cost-micros` | Response Header | Parsed as `Number` | Displays exact microdollars and updates parent |
| `onRefreshMetrics` | Component Prop | Invoked upon stream completion | Triggers `loadData()` in `App.svelte` |

---

### `Workbench.svelte: handleCreateKey()`
* **Purity:** `🟡 I/O Bound`
* **Complexity:** Cyclomatic: 5 | Cognitive: 4

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    Submit([Submit Create Key Form]) --> Validate[Validate label, provider, and raw API key]
    Validate --> EncryptPrep[Verify client-side format or route to /api/keys]
    EncryptPrep --> PostKey[POST /api/keys with label, provider, rawKey, poolType]
    PostKey --> StatusCheck{res.ok?}
    StatusCheck -->|Yes| AppendList[Append new key to state list, show Toast success]
    StatusCheck -->|No| ShowErr[Display error notification]
    AppendList --> CloseModal[Reset form, dismiss modal, refresh telemetry]
    ShowErr --> CloseModal
```

---

## 3. 🛠️ Code Review & Invariant Verification
- **Zero Mock Metrics Invariant:** All token counts, response times, and costs rendered in Playground are derived exclusively from live response payloads and HTTP headers (`x-request-cost-micros`).
- **Reactive Stream Handling:** Uses native `ReadableStream` reader with backpressure awareness, preventing memory leakage during multi-megabyte LLM streams.
