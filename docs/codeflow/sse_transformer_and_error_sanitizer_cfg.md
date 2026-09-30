# 🗺️ Codeflow: SSE Transformer & Zero-Leak Error Sanitizer

> **Subsystem:** `src/proxy/sse/` & `src/worker/error_normalizer.ts`  
> **Source Files:** `src/proxy/sse/transformer.ts`, `src/proxy/sse/usage_extractor.ts`  
> **Security Invariant:** Zero Plaintext Provider Keys · Non-blocking Telemetry  

---

## 1. Subsystem Overview
The SSE proxy layer handles real-time response transformations between upstream AI providers (OpenAI, Anthropic) and external clients:
- **Chunk Stream Transformation:** Normalizes heterogeneous upstream SSE formats into OpenAI-compatible `data: {...}` lines.
- **Zero-Leak Error Sanitizer (`createErrorSanitizerTransform`):** When upstream emits HTTP $\ge 400$, intercepts the chunked body, strips out raw provider error responses, bearer tokens, or internal endpoints, and formats a canonical, sanitized error envelope.
- **Token Counter Stream Tap:** Asynchronously counts prompt and completion tokens on the fly without introducing pipeline latency.

---

## 2. Control Flow Graph (CFG)

```mermaid
flowchart TD
    UpstreamResponse([Upstream Fetch Response]) --> CheckStatus{Response.status >= 400?}
    
    CheckStatus -->|Yes - Upstream Error| PipeSanitizer[Pipe body through createErrorSanitizerTransform]
    PipeSanitizer --> ReadChunk[Read Raw Error Payload]
    ReadChunk --> StripTokens[Regex Redact: Bearer Keys, Project IDs, Internal IPs]
    StripTokens --> FormatStandardJSON[Wrap into Standard Error JSON Envelope]
    FormatStandardJSON --> ReturnSanitizedResponse[Emit HTTP 502 / Upstream Error to Client]
    
    CheckStatus -->|No - 200 Streaming OK| PipeTransformer[Pipe body through createSSETransformer]
    PipeTransformer --> SplitLines[Line Splitter: Extract 'data: ' Prefixes]
    SplitLines --> ParseJSON{Valid JSON Chunk?}
    ParseJSON -->|No / Done| CheckDone{Is '[DONE]' Chunk?}
    CheckDone -->|Yes| EmitDone[Emit data: [DONE]\n\n]
    CheckDone -->|No| DiscardChunk[Discard Malformed Line]
    
    ParseJSON -->|Yes| ExtractDelta[Extract Delta Content & Usage Metadata]
    ExtractDelta --> AccrueTokens[Increment Local Prompt & Completion Token Counters]
    AccrueTokens --> ReEmitChunk[Emit Transformed JSON Chunk to Client]
    
    EmitDone --> TriggerTelemetry[ctx.waitUntil: Emit Telemetry Event to Analytics Engine]
```

---

## 3. Def-Use Variable Lifecycle Matrix

| Variable | Scope / Type | Def Site | Use Sites | Purity Badge |
|---|---|---|---|---|
| `rawChunk` | `Uint8Array` | Upstream ReadableStream | TextDecoder, Line Buffer | 🟢 Pure |
| `lineBuffer` | `string` | Split on `\n` | JSON Parser | 🔴 State Mutating |
| `tokenCounter` | `{prompt, completion}` | Chunk Usage Extraction | Usage Accumulator, Telemetry Emitter | 🔴 State Mutating |
| `sanitizedPayload`| `string` | Regex Redactor | Response Constructor | 🟢 Pure |
