# Data Contracts and Models

We begin our examination by dissecting the core structures serving as the nervous system of Key Collective. The data domain outlines the strict shapes transferring state between the client boundary, the proxy engine, and the durable database.

## Three-Pass Dissection

### 1. Purpose

The domain models isolate business concepts from transport mechanics. Structs like `APIKey` and `RequestLog` function as canonical source-of-truth abstractions. They establish vocabulary constraints, ensuring the database layer (`DB`) and the presentation layer (`ui/src/lib/types.ts`) communicate using an agreed-upon lexicon, specifically tracking provider limits, telemetry, and lifecycle markers.

### 2. Invariants

-   **Data Masking**: Cryptographic blobs never leak to the UI. The plaintext `Decrypted` key rests purely in runtime memory and escapes serialization due to the `json:"-"` struct tag.
-   **Immutable Telemetry**: A `RequestLog` represents a historical fact. Once generated, its latency and byte counts cannot mutate.
-   **Strict Enums**: The `Provider` and `KeyStatus` types constrain routing logic to a known universe of states.

### 3. State Lifecycle

Entities shift from ephemeral client payloads (`CreateKeyPayload`) to enriched runtime models (`APIKey`), eventually flushing to persistent records. During execution, transient fields like `RequestsThisMin` mutate vigorously but avoid durable storage until aggregated into broader metrics like `PoolStats` or `ProxyStats`.

## Model Breakdown

### Provider and KeyStatus Constraints

The routing engine relies on strict type aliases defining allowable upstream targets and health markers.

```go
type Provider string

const (
	ProviderGemini Provider = "gemini"
	ProviderGroq   Provider = "groq"
)

type KeyStatus string

const (
	KeyHealthy     KeyStatus = "healthy"
	KeyRateLimited KeyStatus = "rate_limited"
	KeyExhausted   KeyStatus = "exhausted"
	KeyInvalid     KeyStatus = "invalid"
	KeyDisabled    KeyStatus = "disabled"
)
```

The `Provider` ensures the reverse proxy targets the correct backend (e.g., Google or Groq), while `KeyStatus` drives the load balancer's circuit breaker logic.

### The APIKey Entity

The `APIKey` struct bridges persistent configuration and highly volatile runtime telemetry. 

```go
type APIKey struct {
	ID           string    `json:"id" db:"id"`
	KeyHash      string    `json:"-" db:"key_hash"`
	KeyPrefix    string    `json:"key_prefix" db:"key_prefix"`
	KeySuffix    string    `json:"key_suffix" db:"key_suffix"`
	EncryptedKey []byte    `json:"-" db:"encrypted_key"`
	Provider     Provider  `json:"provider" db:"provider"`
	Label        string    `json:"label" db:"label"`
	RPMLimit     int       `json:"rpm_limit" db:"rpm_limit"`
	RPDLimit     int       `json:"rpd_limit" db:"rpd_limit"`
	Priority     int       `json:"priority" db:"priority"`
	Status       KeyStatus `json:"status" db:"status"`

	// Runtime State (not persisted to DB immediately)
	Decrypted         string    `json:"-"`
	RequestsThisMin   int       `json:"-"`
	RequestsToday     int       `json:"-"`
	MinuteWindowStart time.Time `json:"-"`
	TotalLatencyMs    float64   `json:"-"`
	TotalRequests     int64     `json:"-"`
	CooldownUntil     time.Time `json:"-"`
}
```

Notice the division of fields. The top half describes the durable configuration stored in SQLite, heavily relying on structural masking (`KeyPrefix` and `KeySuffix`) to display identity without revealing secrets. The bottom half contains transient fields that the `KeyManager` actively mutates during traffic routing. These runtime metrics avoid constant database writes, preserving I/O bandwidth.

### Telemetry Shapes: RequestLog, ProxyStats, and PoolStats

Visibility requires structured logging. `RequestLog` captures atomic proxy events.

```go
type RequestLog struct {
	ID         string    `json:"id"`
	KeyID      string    `json:"key_id"`
	Provider   Provider  `json:"provider"`
	StatusCode int       `json:"status_code"`
	LatencyMs  float64   `json:"latency_ms"`
	BytesIn    int64     `json:"bytes_in"`
	BytesOut   int64     `json:"bytes_out"`
	CreatedAt  time.Time `json:"created_at"`
}
```

This struct enables latency percentiles and error tracking. Aggregation then shapes these events into dashboard-ready formats like `ProxyStats` for backend processing or `PoolStats` in the TypeScript interface.

```typescript
export interface PoolStats {
  total_keys: number;
  healthy_keys: number;
  rate_limited_keys: number;
  invalid_keys: number;
  total_rpm_headroom: number;
  total_rpm_limit: number;
  current_rpm_used: number;
  avg_upstream_latency_ms: number;
  daily_quota_used: number;
  daily_quota_limit: number;
  proxy_status: 'healthy' | 'degraded' | 'offline';
}
```

The UI utilizes `PoolStats` to render fleet health at a glance. The backend generates these counters via optimized SQL aggregates, hiding the complexity of raw `RequestLog` rows from the client.

## Memory Footprint vs. Persistence

Our data strategy leverages a strict boundary between memory and disk. `APIKey` struct definitions illustrate this beautifully. 

A standard `APIKey` config requires minimal disk space, largely constrained to small strings and an AES cipher block. However, its runtime counterpart lives fully in memory, tracking `TotalRequests` and `RequestsThisMin` inside localized CPU caches. This separation prevents database lock contention. A proxy request only reads the cached struct via a read-write lock, avoiding a synchronous round-trip to SQLite for quota enforcement.

The `RequestLog` structure adopts the opposite pattern. These entries flow aggressively from memory into the database via an async channel, minimizing heap allocation pressure. We retain only a finite slice of logs in memory, relying on SQLite's durable WAL files to answer historical queries.

By formalizing `Provider`, `KeyStatus`, and the bridging telemetry models, Key Collective sustains a typed, resilient domain language extending from the database up to the user interface.

### Advanced Telemetry Considerations

When operating at scale, the distinction between runtime state and persistent state becomes critical. While the `APIKey` struct holds pointers to active requests, `ProxyStats` provides the historical snapshot. 

We must also consider how these models evolve. If Key Collective introduces a third AI provider, the `Provider` enum expands, but the underlying struct definitions remain stable. This polymorphism allows the UI to render provider-agnostic health metrics. A `RequestLog` representing a Groq failure structurally matches a Gemini failure, ensuring that aggregation logic never requires provider-specific branching.

By meticulously curating these domain primitives, the system prevents spaghetti dependencies. The HTTP handler, the reverse proxy, and the database engine all speak this unified language, ensuring structural integrity across the entire application lifecycle.

### Cross-Layer Type Synchronization

One of the most profound benefits of our structured modeling approach is the ability to project domain constraints directly into the frontend. The TypeScript definitions like `PoolStats` and `APIKey` are not merely loose approximations; they are exact reflections of the Go structs. This structural parity eliminates an entire class of serialization bugs where the frontend expects a field that the backend fails to provide. By unifying the terminology—referring to a rate-limited key explicitly as `KeyRateLimited` in both Go and TypeScript—we establish a ubiquitous language that spans the entire codebase, dramatically reducing cognitive load for developers moving across the stack.

### Future Extensibility Vectors

Looking ahead, these data models are primed for expansion. Should we introduce token budgeting or cost allocation, the `APIKey` struct can easily accommodate a `CostAccrued` float, while the `RequestLog` can capture the precise `TokenCount` consumed. Because the foundation rigidly separates durable metadata from ephemeral runtime telemetry, we can weave these new dimensions into the system without compromising the latency or throughput of the existing proxy engine. The contracts remain the ultimate source of truth, dictating how the system reasons about its own state.
