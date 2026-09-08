# Observability and Infrastructure

The architectural foundation relies heavily on state durability and active telemetry aggregation. We examine how the `KeyManager` operates as an intelligent memory nexus, while the `DB` struct acts as an unbreakable persistence anchor.

## Three-Pass Dissection

### 1. Purpose

The infrastructure layer guarantees fault tolerance. The `KeyManager` monitors quota ceilings and applies load-balancing heuristics to maintain high throughput. The `DB` encapsulates SQLite interactions, organizing schema configurations, indexing telemetry, and providing aggregate read models for system dashboards.

### 2. Invariants

-   **Concurrency Safety**: Memory structures within `KeyManager` utilize strict mutex locks to prevent race conditions during rapid quota manipulation.
-   **Durability Guarantee**: SQLite operates in WAL (Write-Ahead Logging) mode, securing concurrent read/write access without database locking bottlenecks.
-   **Circuit Breaker Cooling**: A key entering a rate-limited state strictly rejects traffic until the temporal `CooldownUntil` window expires.

### 3. State Lifecycle

API keys initiate their existence via an `InsertKey` operation hitting disk. Upon boot, the server loads these entities from disk, populating the `KeyManager` slice. As proxy traffic flows, the manager mutates runtime counters. The proxy asynchronously flushes `RequestLog` rows to the database. Over time, queries aggregate these facts to compute overall fleet health.

## Complexity Matrix

| Operation | Component | Time Complexity | Space Complexity | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **GetBestKey** | `KeyManager` | O(K log K) | O(K) | K = Active keys. Filters and sorts available keys dynamically. |
| **Log Insertion** | `DB` | O(1) | O(1) | Async write appending to SQLite WAL. |
| **Stats Aggregation** | `DB` | O(L) | O(1) | L = Number of logs today. Scans daily logs for request totals. |
| **Key Removal** | `KeyManager` | O(K) | O(1) | Linear scan over slice to slice out the removed key. |

## The Key Manager: Load Balancing and Cooling

The `KeyManager` maintains the active routing pool and shields upstream endpoints from abuse.

```go
func NewKeyManager(keys []*domain.APIKey, dailyLimit int) *KeyManager {
	return &KeyManager{
		keys:       keys,
		dailyLimit: dailyLimit,
	}
}
```

The primary intelligence resides in the sliding window calculations and sorting algorithm inside `GetBestKey`.

```go
	// Sort logic: Provider Match (1st) -> Priority (Lowest first) -> RPM Headroom (Most) -> Avg Latency (Lowest)
	sort.Slice(available, func(i, j int) bool {
		a := available[i]
		b := available[j]

		aMatch := 1
		if a.Provider == preferredProvider {
			aMatch = 0
		}
		bMatch := 1
		if b.Provider == preferredProvider {
			bMatch = 0
		}

		if aMatch != bMatch {
			return aMatch < bMatch
		}

		if a.Priority != b.Priority {
			return a.Priority < b.Priority
		}

		aRPMRemaining := a.RPMLimit - a.RequestsThisMin
		bRPMRemaining := b.RPMLimit - b.RequestsThisMin
		if aRPMRemaining != bRPMRemaining {
			return aRPMRemaining > bRPMRemaining
		}
        // ... latency fallbacks
```

The multi-tiered sorting prioritizes strict provider alignment, ensuring Gemini traffic hits Gemini keys. It then defers to user-configured priority levels. When keys tie on priority, the engine favors the token possessing the highest RPM headroom, thereby naturally distributing load across the cluster.

If a provider responds with HTTP 429 (Too Many Requests), the circuit breaker trips.

```go
func (km *KeyManager) ReportError(key *domain.APIKey, statusCode int) {
	km.mu.Lock()
	defer km.mu.Unlock()

	if statusCode == 429 || statusCode >= 500 {
		key.Status = domain.KeyRateLimited
		key.CooldownUntil = time.Now().Add(60 * time.Second)
	} else if statusCode == 401 || statusCode == 403 {
		key.Status = domain.KeyInvalid
	}
}
```

The 60-second temporal cooldown forces the engine to shift traffic to healthier keys, restoring balance.

## The Database Anchor

Operating synchronously alongside memory, the `DB` struct hardens the operational baseline. By forcing WAL mode upon initialization, SQLite scales beautifully.

```go
	// WAL mode for concurrency
	if _, err := db.Exec("PRAGMA journal_mode=WAL;"); err != nil {
		return nil, fmt.Errorf("failed to enable WAL: %w", err)
	}
```

The system demands rapid telemetry insertion without stalling readers fetching dashboard metrics.

```go
func (db *DB) GetStats() (*domain.ProxyStats, error) {
	stats := &domain.ProxyStats{}
	row := db.QueryRow(`
		SELECT 
			COUNT(CASE WHEN status != 'disabled' THEN 1 END),
			COUNT(CASE WHEN status = 'healthy' THEN 1 END),
			COUNT(CASE WHEN status = 'rate_limited' THEN 1 END)
		FROM api_keys
	`)
    // ...
```

By leveraging standard SQL aggregates, the backend rapidly computes total healthy endpoints and delegates metric tracking to the C-based SQLite runtime engine. This ensures the Go application's garbage collector avoids managing vast arrays of historical `RequestLog` allocations, preserving CPU cycles for reverse proxy routing.

### Managing WAL Growth and Checkpointing

While Write-Ahead Logging (WAL) significantly boosts concurrent throughput, it introduces the operational complexity of WAL file growth. SQLite appends changes to a `-wal` file instead of directly modifying the main database file. When the proxy engine aggressively flushes `RequestLog` entries, this WAL file can grow rapidly.

SQLite handles this via automatic checkpointing, merging WAL contents back into the main database file after reaching a specific threshold (typically 1000 pages). In a highly active proxy environment, these checkpoints run concurrently, ensuring that log insertions never block. 

Furthermore, the `KeyManager` operates as a localized write-back cache. Rather than updating SQLite every time a key's `RequestsThisMin` counter increments—which would obliterate disk I/O—the manager holds this state in RAM. We only write to disk when creating or deleting keys, or when appending the immutable `RequestLog` audit trail. This hybrid approach—volatile state in RAM, immutable facts on disk—represents the pinnacle of mechanical sympathy for infrastructure scaling.

### Operational Resiliency Under Load

When the proxy is bombarded with traffic, the infrastructure tier acts as the ultimate shock absorber. The `KeyManager` is specifically designed to degrade gracefully rather than crash. If the global daily quota is reached, the manager short-circuits the routing logic, instantly rejecting new connections with a localized error rather than overwhelming the upstream providers. This global quota check executes entirely in RAM, costing less than a microsecond, thus preventing the proxy from wasting network bandwidth on doomed requests.

### Archival and Log Rotation

Currently, the `DB` eagerly ingests `RequestLog` entries to provide real-time dashboard analytics. However, as the system scales, these logs will eventually consume significant disk space. The schema anticipates this by stamping every log with a precise `created_at` timestamp. This enables trivial pruning strategies, such as a background cron job executing a simple `DELETE FROM request_logs WHERE created_at < datetime('now', '-7 days')`. By leveraging SQLite's inherent time-series capabilities, we can maintain a lightweight rolling window of telemetry, ensuring the system remains responsive and disk I/O remains manageable without requiring complex external logging infrastructure.
