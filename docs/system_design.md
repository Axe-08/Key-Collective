# System Design & Architecture

```mermaid
graph TD
    subgraph "External Clients"
        App1["Python Script"]
        App2["Next.js App"]
    end

    subgraph "Railway Free Tier ($0/mo)"
        subgraph "Go Binary (~15MB)"
            HTTP["net/http Server<br/>(OpenAI Proxy)"]
            Auth["Token Validator<br/>(SHA-256)"]
            Router["Priority Router &<br/>Circuit Breaker"]
            
            subgraph "Embedded FS"
                Svelte["Svelte 5 SPA<br/>Dashboard"]
            end
        end
        
        SQLite[("SQLite Volume<br/>Persistent")]
    end

    subgraph "Upstream APIs"
        Gemini["Google Gemini"]
        Groq["Groq API"]
    end

    App1 -->|Bearer| HTTP
    App2 -->|Bearer| HTTP
    Browser -->|Serves| Svelte
    Svelte -->|REST| HTTP
    
    HTTP --> Auth
    Auth --> Router
    Router -->|Read/Write Logs| SQLite
    Router -->|Proxy Inference| Gemini
    Router -->|Proxy Inference| Groq
```

## Component Breakdown
1. **Proxy Layer:** Parses OpenAI-compatible JSON payloads, extracts model requirements.
2. **Auth Layer:** Validates the incoming Bearer token against the SQLite `tokens` table.
3. **Key Pool Manager:** An in-memory mutex-locked struct holding all keys. Evaluates healthy keys, sliding window RPM, and lowest latency.
4. **Circuit Breaker:** Catches 429s/5xx from upstream, marks key as `RateLimited`, sets a 60s cooldown, and retries the request with the next key.
5. **Logger (Background):** Batches request metrics to a Go channel, flushing to SQLite in WAL mode every 5 seconds to prevent write contention.
