# Codeflow: `ProxyServer.ServeHTTP()`

**Purity Badge:** 🔴 I/O Mutating (Network calls, HTTP streaming, SQLite writes)
**Path:** `internal/proxy/handler.go`

## Control Flow Graph (CFG)
```mermaid
flowchart TD
    Start[ServeHTTP] --> ValidateAuth{Validate Authorization Bearer Token}
    ValidateAuth -- Invalid --> HTTP401[http.Error 401]
    ValidateAuth -- Valid --> ReadBody[Read & Unmarshal Request Body JSON]
    
    ReadBody --> ExtractModel[Extract 'model' field]
    ExtractModel --> InferProvider{Model starts with 'gemini'?}
    InferProvider -- Yes --> SetGemini[preferred = Gemini]
    InferProvider -- No --> SetGroq[preferred = Groq]
    
    SetGemini --> GetKey[GetBestKey(preferred)]
    SetGroq --> GetKey
    
    GetKey --> KeyExists{Key available?}
    KeyExists -- No --> HTTP429[http.Error 429 Too Many Requests]
    KeyExists -- Yes --> SetURL{Provider type}
    
    SetURL -- Gemini --> GemURL[https://generativelanguage.googleapis.com]
    SetURL -- Groq --> GroqURL[https://api.groq.com/openai]
    
    GemURL --> BuildProxy[NewSingleHostReverseProxy]
    GroqURL --> BuildProxy
    
    BuildProxy --> Intercept[Define ModifyResponse interceptor]
    Intercept --> ModifyHeaders[Rewrite Host, Scheme, Authorization with Plaintext Key]
    ModifyHeaders --> Serve[proxy.ServeHTTP]
    
    subgraph ModifyResponse [Async Response Interceptor]
        Resp[HTTP Response Returns] --> Log[Send RequestLog to Go Channel]
        Log --> CheckStatus{Status == 200?}
        CheckStatus -- Yes --> ReportSuccess[Manager.ReportSuccess]
        CheckStatus -- No --> ReportError[Manager.ReportError 429/500]
    end
    
    Serve -.-> Resp
```
