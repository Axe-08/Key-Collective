# Part 6: Hands-On Exercises, Active Recall & Graduation Challenge

Welcome to the crucible. You have explored the architecture, traced execution pathways, and inspected the synchronization primitives of Key Collective. Now, it is time to transition from passive reading to active architectural interrogation.

This chapter presents three progressive hands-on sections designed to test your mental model against actual production code:
1. **Codebase Treasure Hunts**: Guided source code investigations targeting critical concurrency, ranking, and cryptographic mechanisms.
2. **Active-Recall Socratic Quiz**: Five real-world failure scenarios challenging your understanding of distributed proxy failure modes, state lifecycles, and database isolation.
3. **Graduation Coding Challenge**: A hands-on enhancement task where you will implement dynamic exponential backoff cooldowns within the core circuit breaker.

---

## Section 1: Codebase Treasure Hunts

True mastery of a Go codebase begins by locating the exact lines where abstract architectural principles translate into concrete runtime operations. Embark on these three targeted explorations.

### Hunt 1: The Zero-Drop Log Guard
* **Location:** [`internal/proxy/handler.go`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/handler.go#L85-L98)
* **Target AST Symbols:** [`ProxyServer`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/handler.go#L16), [`RequestLog`](file:///home/akshit/Projects/Key%20Collective/internal/domain/contracts.go#L45)
* **Objective:** Find the `select` statement containing a `default` case inside the reverse proxy response modifier.

Inspect the `ServeHTTP` implementation on [`ProxyServer`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/handler.go#L16). When an upstream inference call completes, the proxy must record an audit entry into `LogChannel` without introducing tail latency to the client response.

Notice lines 85–98:
```go
// Async logging
select {
case p.LogChannel <- &domain.RequestLog{
    KeyID:      bestKey.ID,
    Provider:   bestKey.Provider,
    StatusCode: resp.StatusCode,
    LatencyMs:  latency,
    BytesIn:    int64(len(bodyBytes)),
    BytesOut:   resp.ContentLength,
    CreatedAt:  time.Now(),
}:
default:
    // channel full, drop log to avoid blocking
    log.Println("Warning: Log channel full, dropping log entry")
}
```

**Architectural Analysis:**
If the channel send were synchronous (`p.LogChannel <- log`), any temporary database disk stall or slow disk write in the persistence goroutine would fill the 1,000-element channel buffer. Once saturated, subsequent client requests would block at line 86 waiting for channel capacity, directly coupling proxy latency to SQLite disk I/O. The `select`/`default` construct guarantees an O(1) non-blocking send: if the channel buffer is exhausted, the log entry is safely shed to protect client request throughput.

---

### Hunt 2: The Multi-Tiered Sorter
* **Location:** [`internal/proxy/manager.go`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/manager.go#L76-L111)
* **Target AST Symbol:** [`KeyManager`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/manager.go#L12)
* **Objective:** Locate the multi-tiered comparator passed to `sort.Slice` in `GetBestKey`.

Examine lines 76–111 within [`KeyManager.GetBestKey`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/manager.go#L26). When multiple healthy keys qualify for an inference request, the pool executes a four-tier sorting ladder:

```go
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

    var aAvg, bAvg float64
    if a.TotalRequests > 0 {
        aAvg = a.TotalLatencyMs / float64(a.TotalRequests)
    }
    if b.TotalRequests > 0 {
        bAvg = b.TotalLatencyMs / float64(b.TotalRequests)
    }
    return aAvg < bAvg
})
```

**Architectural Analysis:**
1. **Tier 1 (Provider Match):** Keys matching `preferredProvider` receive rank 0, while cross-provider fallbacks receive rank 1.
2. **Tier 2 (Configured Priority):** Lower numeric priority integers take precedence (priority 0 precedes priority 1).
3. **Tier 3 (RPM Headroom):** Keys with higher remaining requests in the current minute window are preferred, distributing burst traffic evenly.
4. **Tier 4 (Historical Latency):** Ties are resolved by comparing mean response time (`TotalLatencyMs / TotalRequests`), routing traffic toward upstream endpoints responding fastest.

---

### Hunt 3: The Cryptographic Envelope
* **Location:** [`internal/proxy/crypto.go`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/crypto.go#L26-L32) and [`internal/proxy/crypto.go`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/crypto.go#L48-L54)
* **Target AST Symbol:** [`APIKey`](file:///home/akshit/Projects/Key%20Collective/internal/domain/contracts.go#L22)
* **Objective:** Trace how the 12-byte initialization vector (nonce) is generated, prepended to the ciphertext, and extracted during decryption.

Inspect `Encrypt` and `Decrypt` in [`internal/proxy/crypto.go`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/crypto.go).
- In `Encrypt` (line 26), `gcm.NonceSize()` allocates 12 bytes read from `rand.Reader`. Line 31 executes:
  ```go
  ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
  ```
  The first argument to `gcm.Seal` is the destination slice `dst`. Passing `nonce` instructs Go to append the encrypted payload and the 16-byte Poly1305 authentication tag immediately behind the 12-byte nonce in contiguous memory.
- In `Decrypt` (lines 48–54), the envelope is unpacked:
  ```go
  nonceSize := gcm.NonceSize()
  if len(ciphertext) < nonceSize {
      return "", errors.New("ciphertext too short")
  }
  nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
  plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
  ```

**Architectural Analysis:**
AES-GCM security relies on never repeating a nonce with the same key. By packing the randomly generated 12-byte nonce directly into the binary blob stored in SQLite's `encrypted_key` column, Key Collective eliminates the need for separate database nonce columns while keeping ciphertext payloads cryptographically self-contained.

---

## Section 2: Active-Recall Socratic Quiz

Reflect on these real-world production scenarios before opening the answer details. Test your understanding of failure domains, recovery lifecycles, and concurrency boundaries.

---

### Question 1: Upstream Rate-Limit Cascades & Circuit Breakers
**Scenario:** A sudden spike in client traffic causes Google Gemini to return consecutive `HTTP 429 Too Many Requests` responses.
What exact state transitions occur inside [`KeyManager.ReportError`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/manager.go#L128-L138), how does [`KeyManager.GetBestKey`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/manager.go#L26-L74) react to incoming requests over the next 60 seconds, and when does fallback to Groq engage?

<details>
<summary>Reveal Answer & Engineering Rationale</summary>

**Underlying Mechanics:**
1. **Circuit Tripping:** When [`ProxyServer.ServeHTTP`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/handler.go#L103) observes `resp.StatusCode == 429`, it calls `km.ReportError(bestKey, 429)`. Under mutex acquisition, `ReportError` mutates the key's state:
   - `key.Status` changes from `KeyHealthy` to `KeyRateLimited`.
   - `key.CooldownUntil` is set to `time.Now().Add(60 * time.Second)`.
2. **Candidate Filtering:** On subsequent calls to `GetBestKey`, the candidate filter on lines 54–60 verifies `k.Status == domain.KeyHealthy`. Because `CooldownUntil` is in the future, the rate-limited Gemini key is filtered out.
3. **Provider Fallback:** If all Gemini keys are in cooldown, `len(available)` becomes 0. Lines 63–69 trigger the fallback loop across all providers regardless of `preferredProvider`. The router automatically selects an available healthy Groq key.
4. **Auto-Recovery:** Once 60 seconds elapse, lines 44–46 of `GetBestKey` detect that `now.After(k.CooldownUntil)` is true, resetting `k.Status` back to `KeyHealthy` without requiring human intervention or polling workers.
</details>

---

### Question 2: Container Reboot and Ephemeral Counter Evaporation
**Scenario:** Key Collective runs in a containerized environment. An operator notes that key `gemini_primary` has an RPM limit of 15 and has served 14 requests between 14:00:00 and 14:00:45. At 14:00:46, the container restarts. At 14:00:50, a burst of 10 requests arrives.
What happens to the rate-limiting enforcement? Why are the counters reset, and what was the deliberate design trade-off?

<details>
<summary>Reveal Answer & Engineering Rationale</summary>

**Underlying Mechanics:**
In [`internal/domain/contracts.go`](file:///home/akshit/Projects/Key%20Collective/internal/domain/contracts.go#L35-L43), the fields `RequestsThisMin`, `RequestsToday`, and `MinuteWindowStart` are intentionally tagged with `json:"-"` and have no database column mappings.
1. **Counter Evaporation:** When the container restarts, [`cmd/key-collective/main.go`](file:///home/akshit/Projects/Key%20Collective/cmd/key-collective/main.go#L32-L50) calls [`DB.GetKeys`](file:///home/akshit/Projects/Key%20Collective/internal/db/sqlite.go#L111) to rehydrate in-memory state. All keys initialize with `RequestsThisMin = 0` and `MinuteWindowStart = time.Now()`.
2. **Quota Trade-Off:** As a consequence, the proxy allows up to 15 fresh requests in the new minute window, meaning 29 total requests could reach Gemini within a 60-second span across the restart boundary.
3. **Engineering Justification:** Storing sliding-window request counters in memory eliminates SQLite disk writes on every single proxy transaction. Persisting counters synchronously to disk on every proxy request would create write contention on SQLite. The safety valve is the upstream provider's rate limiter: if Gemini rejects excess requests with HTTP 429, Key Collective's circuit breaker immediately traps the error and quarantines the key for 60 seconds.
</details>

---

### Question 3: WAL Concurrency Under Saturated Logging Pressure
**Scenario:** The proxy server routes 300 requests per second. The background logger goroutine in [`cmd/key-collective/main.go`](file:///home/akshit/Projects/Key%20Collective/cmd/key-collective/main.go#L100-L106) continuously executes `INSERT INTO request_logs` via [`DB.InsertLog`](file:///home/akshit/Projects/Key%20Collective/internal/db/sqlite.go#L298-L303). Simultaneously, an administrator refreshes the dashboard, executing `GET /api/stats` and `GET /api/logs`.
Why does this concurrent read-write load not trigger database deadlocks or `SQLITE_BUSY` errors?

<details>
<summary>Reveal Answer & Engineering Rationale</summary>

**Underlying Mechanics:**
During database setup in [`InitDB`](file:///home/akshit/Projects/Key%20Collective/internal/db/sqlite.go#L29-L31), the server executes:
```sql
PRAGMA journal_mode=WAL;
```
1. **Write-Ahead Logging (WAL):** In default rollback journal mode, SQLite locks the entire database file during writes, blocking readers. In WAL mode, writes do not overwrite database pages directly; they append to a separate `-wal` write-ahead log file.
2. **Reader Isolation:** Dashboard readers reading from [`DB.GetRecentLogs`](file:///home/akshit/Projects/Key%20Collective/internal/db/sqlite.go#L173) and [`DB.GetStats`](file:///home/akshit/Projects/Key%20Collective/internal/db/sqlite.go#L229) operate on a consistent snapshot defined by the WAL index file (`-shm`). Readers never block writers, and writers never block readers.
3. **Channel Buffering:** The decoupling of logging through Go channels prevents goroutine contention: HTTP proxy workers drop items into `LogChannel`, while a single dedicated worker executes insertions sequentially, preventing multiple writers from conflicting on SQLite.
</details>

---

### Question 4: Database Leak and Master Key Cryptographic Perimeter
**Scenario:** A misconfigured server backup results in the public exposure of the `keys.db` SQLite file. However, the host environment and `KC_MASTER_KEY` remain secure and uncompromised.
What exact information has been leaked to the attacker, what remains cryptographically protected, and why does [`DB`](file:///home/akshit/Projects/Key%20Collective/internal/db/sqlite.go#L14) maintain a `key_hash` column?

<details>
<summary>Reveal Answer & Engineering Rationale</summary>

**Underlying Mechanics:**
1. **Exposed Metadata:** The attacker gains access to schema definitions, key identifiers (`id`), labels, provider names, configured RPM/RPD limits, and the public prefix (`key_prefix`, e.g., `AIzaSy...`) and suffix (`key_suffix`).
2. **Protected Secrets:** The actual plaintext API keys are completely protected inside the `encrypted_key` BLOB. Because encryption uses AES-256-GCM with SHA-256 key derivation from `KC_MASTER_KEY` and a cryptographically random 12-byte nonce, recovering the secret token without `KC_MASTER_KEY` is computationally intractable.
3. **Role of `key_hash`:** The `key_hash` column contains a hex-encoded SHA-256 digest of the raw key. This allows [`DB.InsertKey`](file:///home/akshit/Projects/Key%20Collective/internal/db/sqlite.go#L88-L103) to enforce a `UNIQUE` SQL constraint, preventing duplicate keys from being inserted without needing to decrypt existing keys in the database. Because SHA-256 is a one-way preimage-resistant function, the raw key cannot be reversed from `key_hash`.
</details>

---

### Question 5: Method-Aware Multiplexing in HTTP Routing
**Scenario:** Consider the routing declarations registered in [`cmd/key-collective/main.go`](file:///home/akshit/Projects/Key%20Collective/cmd/key-collective/main.go#L82-L93) and [`internal/api/handler.go`](file:///home/akshit/Projects/Key%20Collective/internal/api/handler.go#L69-L76):
- `mux.HandleFunc("GET /api/keys", h.HandleGetKeys)`
- `mux.HandleFunc("POST /api/keys", h.HandleCreateKey)`
- `mux.HandleFunc("DELETE /api/keys/{id}", h.HandleDeleteKey)`
- `mux.Handle("/v1/", proxyServer)`
- `mux.Handle("/", ui.Handler())`

If an external client sends `PUT /api/keys`, what does Go's `http.ServeMux` return? If a client requests `POST /v1/chat/completions`, why does it route to [`ProxyServer`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/handler.go#L16) rather than falling through to `ui.Handler()`?

<details>
<summary>Reveal Answer & Engineering Rationale</summary>

**Underlying Mechanics:**
Key Collective leverages Go 1.22+ enhanced routing semantics within `http.ServeMux`:
1. **Automatic Method Rejection:** Go 1.22 tracks which methods are registered for a given pattern path. Because `/api/keys` is registered for `GET` and `POST`, sending a `PUT` request causes `http.ServeMux` to automatically respond with `405 Method Not Allowed`, setting an `Allow: GET, POST, OPTIONS` header without executing handler code.
2. **Longest-Prefix Subtree Precedence:** Paths ending with a trailing slash (`/v1/` and `/`) define routed subtrees. When multiple subtree patterns match an incoming URI, `http.ServeMux` evaluates precedence by pattern specificity (length). Since `/v1/` (4 characters) is a longer match than `/` (1 character), any request starting with `/v1/` routes exclusively to `proxyServer`.
3. **Path Parameter Extraction:** In `HandleDeleteKey`, the dynamic path segment `{id}` is resolved via `r.PathValue("id")`, cleanly separating route parameter extraction from legacy string-splitting logic.
</details>

---

## Section 3: Graduation Coding Challenge: Dynamic Exponential Backoff Cooldowns

In the current implementation, [`KeyManager.ReportError`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/manager.go#L128-L138) applies a static 60-second cooldown whenever an upstream provider returns an HTTP 429 status code:
```go
if statusCode == 429 || statusCode >= 500 {
    key.Status = domain.KeyRateLimited
    key.CooldownUntil = time.Now().Add(60 * time.Second)
}
```

**The Flaw:** If an upstream account has exhausted its quota tier, a flat 60-second cooldown causes the proxy to hammer the upstream provider every 60 seconds, continually triggering 429 errors and wasting inference bandwidth.

**Your Objective:** Implement a dynamic exponential backoff cooldown with jitter-free progressive scaling and automatic recovery reset.

---

### Step-by-Step Implementation Guide

#### Step 1: Extend the Domain Contract
Open [`internal/domain/contracts.go`](file:///home/akshit/Projects/Key%20Collective/internal/domain/contracts.go) and locate the [`APIKey`](file:///home/akshit/Projects/Key%20Collective/internal/domain/contracts.go#L22-L43) struct. Add a runtime counter field named `ConsecutiveErrors`:

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
    ConsecutiveErrors int       `json:"-"` // Tracks sequential upstream 429/5xx errors
}
```

---

#### Step 2: Implement Exponential Escalation in KeyManager
Open [`internal/proxy/manager.go`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/manager.go) and update both `ReportError` and `ReportSuccess`:

1. In `ReportError`, increment `ConsecutiveErrors` on 429 or 5xx responses.
2. Calculate the cooldown duration using base 30 seconds doubled for each subsequent failure ($30s \times 2^{failures - 1}$), capped at a maximum of 960 seconds (16 minutes).
3. In `ReportSuccess`, reset `ConsecutiveErrors` back to zero.

```go
func (km *KeyManager) ReportSuccess(key *domain.APIKey, latencyMs float64) {
    km.mu.Lock()
    defer km.mu.Unlock()

    key.TotalRequests++
    key.TotalLatencyMs += latencyMs
    key.ConsecutiveErrors = 0
    key.Status = domain.KeyHealthy
}

func (km *KeyManager) ReportError(key *domain.APIKey, statusCode int) {
    km.mu.Lock()
    defer km.mu.Unlock()

    if statusCode == 429 || statusCode >= 500 {
        key.Status = domain.KeyRateLimited
        key.ConsecutiveErrors++

        // Calculate exponential backoff: 30s, 60s, 120s, 240s, 480s, capped at 960s
        shift := key.ConsecutiveErrors - 1
        if shift > 5 {
            shift = 5
        }
        backoffSeconds := 30 * (1 << shift)
        key.CooldownUntil = time.Now().Add(time.Duration(backoffSeconds) * time.Second)
    } else if statusCode == 401 || statusCode == 403 {
        key.Status = domain.KeyInvalid
    }
}
```

---

#### Step 3: Write the Verification Test
Open [`internal/proxy/manager_test.go`](file:///home/akshit/Projects/Key%20Collective/internal/proxy/manager_test.go) and append a comprehensive test function to verify backoff progression and recovery:

```go
func TestKeyManager_DynamicExponentialBackoff(t *testing.T) {
    key := &domain.APIKey{
        ID:       "gemini_exp_test",
        Provider: domain.ProviderGemini,
        RPMLimit: 60,
        Status:   domain.KeyHealthy,
    }

    km := NewKeyManager([]*domain.APIKey{key}, 500)

    // Expected cooldown sequence in seconds: 30s, 60s, 120s
    expectedBackoffs := []int{30, 60, 120}

    for i, expectedSec := range expectedBackoffs {
        start := time.Now()
        km.ReportError(key, 429)

        if key.Status != domain.KeyRateLimited {
            t.Fatalf("iteration %d: expected status to be rate_limited", i)
        }
        if key.ConsecutiveErrors != i+1 {
            t.Fatalf("iteration %d: expected ConsecutiveErrors=%d, got %d", i, i+1, key.ConsecutiveErrors)
        }

        diff := key.CooldownUntil.Sub(start).Seconds()
        if diff < float64(expectedSec-1) || diff > float64(expectedSec+2) {
            t.Errorf("iteration %d: expected cooldown ~%ds, got %.1fs", i, expectedSec, diff)
        }
    }

    // Report success and verify complete reset
    km.ReportSuccess(key, 120.5)

    if key.Status != domain.KeyHealthy {
        t.Errorf("expected status healthy after success, got %v", key.Status)
    }
    if key.ConsecutiveErrors != 0 {
        t.Errorf("expected ConsecutiveErrors to reset to 0, got %d", key.ConsecutiveErrors)
    }
}
```

---

#### Step 4: Run Test Verification
Execute the test suite from the repository root:

```bash
export PATH=$PATH:/home/akshit/.local/go-1.23.0/bin
go test -v ./internal/proxy/...
```

Expected verification output:
```text
=== RUN   TestKeyManager_GetBestKey
--- PASS: TestKeyManager_GetBestKey (0.00s)
=== RUN   TestKeyManager_AddRemoveAndStats
--- PASS: TestKeyManager_AddRemoveAndStats (0.00s)
=== RUN   TestKeyManager_DynamicExponentialBackoff
--- PASS: TestKeyManager_DynamicExponentialBackoff (0.00s)
PASS
ok      github.com/akshit/key-collective/internal/proxy 0.004s
```

When all tests report green, you have implemented and verified dynamic exponential backoff cooldowns in Key Collective!

---

[← Previous: Part 5 — Idioms, Patterns & Architectural Trade-offs](05_idioms_patterns_and_tradeoffs.md)
