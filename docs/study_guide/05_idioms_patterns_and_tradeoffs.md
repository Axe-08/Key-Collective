# Chapter 5: Idioms, Patterns, and Trade-offs

Building a robust inference proxy requires navigating specific engineering challenges. 
We utilize proven Go concurrency idioms and design patterns.
These ensure Key Collective remains performant and predictable under massive load.

## Core Design Patterns

### Circuit Breaker Pattern

The `KeyManager` implements a localized circuit breaker for each `APIKey`. 
When an upstream provider returns repeated HTTP 429s or 5xx errors, the `ProxyServer` catches them.
It reports the failure back to the central state manager. 
The `KeyManager` transitions the key to a `KeyRateLimited` state.

This pattern prevents the proxy from hammering a degraded endpoint.
It prevents exhausting the client's retries uselessly. 
Instead, traffic routes to healthy keys immediately. 
The circuit breaker resets automatically after a predefined duration.
This gently allows traffic to verify if the upstream has recovered, preventing a thundering herd problem.

### Mutex-Guarded In-Memory Cache

The `KeyManager` stores the routing table of active keys in a `sync.RWMutex` guarded map.
We optimize aggressively for read-heavy workloads. 
The `ProxyServer` acquires a read lock (`RLock`) thousands of times per minute.
It fetches the optimal key without blocking other readers.

The write lock (`Lock`) is only acquired during administrative operations.
This includes adding a new key or marking a key as exhausted. 

```go
type KeyManager struct {
    mu    sync.RWMutex
    keys  map[string]*APIKey
}

func (km *KeyManager) GetBestKey(model string) (*APIKey, error) {
    km.mu.RLock()
    defer km.mu.RUnlock()
    // Scoring and selection logic evaluates keys
    // Returns the optimal healthy key instance
}
```

This pattern guarantees safe concurrent access.
It keeps latency in the nanosecond range for the hot path.

### Channel-Based Async Worker

We utilize Go channels to decouple the HTTP request lifecycle from persistent storage.
The `ProxyServer` generates a `RequestLog` and sends it to a buffered channel. 
A dedicated background goroutine consumes from this channel continuously.

```go
func (p *ProxyServer) logRequestAsync(log RequestLog) {
    select {
    case p.logChan <- log:
        // Log accepted for async writing
    default:
        // Channel buffer full, log dropped to protect hot path
    }
}
```

This pattern isolates the proxy performance from disk I/O latency. 
If the database locks momentarily, the channel absorbs the backlog.

### Envelope Encryption

The `DB` never stores plaintext credentials. 
We employ envelope encryption using AES-256-GCM. 
The application binary manages a master key (the envelope).
This envelope encrypts and decrypts the individual `APIKey` payloads.
It happens at the boundary between memory and disk. 
This localized encryption ensures data security without requiring external Key Management Systems (KMS).

## Common Engineering Gotchas

### Goroutine Leaks in the Proxy

A common hazard in HTTP proxies involves orphaned goroutines. 
If a client disconnects unexpectedly, the proxy might hang.
If the `ProxyServer` continues reading the upstream response and waiting for a channel send, the goroutine leaks. 

We prevent this by heavily utilizing `context.Context`. 
The client's request context propagates entirely through the `httputil.ReverseProxy`.
When the client aborts, the context cancels.
The cancellation signals immediately abort upstream TCP connections, freeing resources.

### Channel Overflow Drops

The `logRequestAsync` function uses a `select` statement with a `default` case. 
This is a deliberate defense mechanism. 
If the database completely locks and the buffered channel fills up, new logs are dropped.
They are discarded rather than blocking the proxy execution. 

Developers must configure the channel buffer size appropriately based on the expected request volume.
Developers must account for database write latency under load. 
Dropping a telemetry log is preferable to dropping an active user session.

### Clock Drift on Cooldowns

When the `KeyManager` sets a key to `KeyRateLimited`, it relies on the clock.
It measures the cooldown period to determine when to unlock the key. 
If the system clock experiences significant NTP drift or manual adjustments, bugs occur.
Keys might remain locked indefinitely.
Keys might unlock prematurely. 

We mitigate this by using monotonic time intervals.
We evaluate state using `time.Since()` rather than comparing absolute wall-clock timestamps.
Monotonic clocks guarantee forward progression irrespective of NTP adjustments.

## Trade-off Comparison Matrix

Every system design choice involves accepting a trade-off. 
We document these choices to clarify the architectural constraints.

| Architecture Choice | Key Collective Approach | Alternative | Why We Chose It |
| :--- | :--- | :--- | :--- |
| **State Storage** | Mutex-Guarded In-Memory | Distributed Redis | Nanosecond latency, zero network hops, single binary deployment. Redis introduces network failure domains and operational overhead. |
| **Database Engine** | SQLite WAL Mode | PostgreSQL | Zero-configuration setup, local file system durability. Postgres requires dedicated administration, separate networking, and process management. |
| **Application Packaging**| Static Single Binary | Microservices | Operational simplicity. A single deployment unit runs the UI, Proxy, and API. Microservices add orchestration overhead unnecessarily for this scale. |
| **Logging Persistence** | Buffered Async (Eventual) | Synchronous (Immediate)| Protects the proxy hot path from disk latency spikes. We trade the guarantee of 100% log durability for strictly bounded API response times and resilience. |

By explicitly selecting these trade-offs, Key Collective optimizes for the developer experience.
It ensures operational reliability for small-to-medium teams managing LLM access.
It avoids attempting to build hyperscale cloud infrastructure primitives where they are not required.

### Context Cancellation and Timeout Propagation

We aggressively propagate `context.Context` throughout the system.
When a client initiates a request, the HTTP server creates a context.
This context automatically expires if the client drops the connection early.
We thread this context into the `httputil.ReverseProxy`.

```go
func (p *ProxyServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
    defer cancel()
    
    req := r.WithContext(ctx)
    p.reverseProxy.ServeHTTP(w, req)
}
```

If the upstream provider stalls and fails to return bytes, the context timeout fires.
The proxy aborts the TCP connection to the upstream.
It returns an HTTP 504 Gateway Timeout to the client.
This prevents Key Collective from exhausting all its file descriptors when an upstream API experiences a localized outage.
It ensures the proxy remains responsive to requests bound for healthy providers.

### Graceful Degradation under Load

When the system reaches its maximum concurrent connection limit, it degrades gracefully.
We use a semaphore pattern on the hot path to bound concurrency.
If the semaphore is full, the proxy immediately returns an HTTP 503 Service Unavailable.
It does not attempt to queue the request indefinitely.

Queuing requests when the system is saturated only leads to higher latency and memory exhaustion.
Returning a fast failure allows the client application to implement its own retry logic.
This fail-fast philosophy preserves the structural integrity of the `ProxyServer` under distributed denial of service (DDoS) conditions.
