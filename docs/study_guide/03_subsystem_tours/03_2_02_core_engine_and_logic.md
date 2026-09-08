# Core Engine and Logic

Operating as the primary traffic intersection, the core engine intercepts inbound client requests and routes them to optimal AI providers. We now investigate how the `ProxyServer` achieves zero-downtime routing and how cryptographic primitives defend secret material.

## Three-Pass Dissection

### 1. Purpose

The engine acts as an invisible shield and intelligent router. The `ProxyServer` handles stream interception, modifying headers on the fly, calculating request latencies, and applying provider-specific URL rewrites. Supporting this is a cryptography suite utilizing AES-256-GCM to ensure that API keys remain protected at rest.

### 2. Invariants

-   **Secret Ephemerality**: Decrypted upstream tokens exist exclusively in memory buffers during request transit. `Encrypt` and `Decrypt` routines guarantee secrets traversing disk are mathematically inaccessible without the master key.
-   **Stream Integrity**: The proxy rewrites HTTP requests transparently, preserving the original body payload so the upstream provider (`ProviderGemini` or `ProviderGroq`) processes the prompt cleanly.
-   **Non-Blocking Telemetry**: The reverse proxy issues telemetry to a buffered channel, preventing slow database inserts from degrading TTFB (Time To First Byte).

### 3. State Lifecycle

An incoming request enters `ServeHTTP`, triggering an immediate authentication check using `HashToken`. Once authorized, the proxy reads the payload to identify model preferences. It requests a routing decision from the key manager. The request stream shifts to the upstream target, and upon return, an interceptor records the exact duration before transmitting the async `RequestLog`.

## Complexity Matrix

| Operation | Component | Time Complexity | Space Complexity | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Request Authentication** | `ProxyServer` | O(1) | O(1) | Hash map lookup of the bearer token. |
| **Payload Extraction** | `ProxyServer` | O(N) | O(N) | N = Body size. Full copy required to parse model JSON. |
| **Token Hashing** | `crypto` | O(M) | O(1) | M = Token length. SHA-256 computation over small fixed buffers. |
| **Encryption (AES-GCM)** | `crypto` | O(K) | O(K) | K = Plaintext length. Symmetric encryption pass. |

## Intercepting the Traffic Stream

The `ProxyServer` implements `http.Handler`, overriding the standard lifecycle to inject proxy intelligence.

```go
type ProxyServer struct {
	Manager     *KeyManager
	ValidTokens map[string]bool // hashed token -> true
	LogChannel  chan *domain.RequestLog
}

func (p *ProxyServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	startTime := time.Now()

	// 1. Validate Auth Token
	authHeader := r.Header.Get("Authorization")
	if len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	token := authHeader[7:]
	hashed := HashToken(token)
	if !p.ValidTokens[hashed] {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
    // ... body reading and model extraction
```

The system first neutralizes unauthorized traffic. Because tokens exist as SHA-256 hashes in memory, an attacker extracting memory dumps cannot reverse the raw bearer tokens. 

Next, it duplicates the request stream.

```go
	// 2. Read body to parse provider if possible (e.g., model name checking)
	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body.Close()
	r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	var reqBody struct {
		Model string `json:"model"`
	}
	_ = json.Unmarshal(bodyBytes, &reqBody)
	modelName := reqBody.Model
```

Because `http.Request.Body` functions as a forward-only stream, the proxy must read the payload, parse the JSON to identify the requested model, and then reseal the buffer using `io.NopCloser`. This technique lets the upstream proxy read the body naturally.

## Response Modification and Latency Capture

Once the `KeyManager` selects an active API key, the system configures a reverse proxy and hijacks the response flow.

```go
	proxy := httputil.NewSingleHostReverseProxy(targetUrl)

	// Intercept response to check status code
	proxy.ModifyResponse = func(resp *http.Response) error {
		latency := float64(time.Since(startTime).Milliseconds())

		// Async logging
		select {
		case p.LogChannel <- &domain.RequestLog{
			KeyID:      bestKey.ID,
			Provider:   bestKey.Provider,
			StatusCode: resp.StatusCode,
			LatencyMs:  latency,
			BytesIn:    int64(len(bodyBytes)),
			BytesOut:   resp.ContentLength, // approximate
			CreatedAt:  time.Now(),
		}:
		default:
			// channel full, drop log to avoid blocking
			log.Println("Warning: Log channel full, dropping log entry")
		}
// ...
```

The `ModifyResponse` closure intercepts the returning headers before streaming body chunks. Here, we calculate precision latency and construct the `RequestLog`. The `select` statement using a `default` case represents a non-blocking channel send. If the telemetry pipeline backs up, we drop the log rather than stalling the end user's AI completion.

## Cryptographic Defenses

To ensure robust storage, all secrets run through an AES-256-GCM cipher block.

```go
// Encrypt payload using AES-256-GCM
func Encrypt(plaintext string, masterKey string) ([]byte, error) {
	keyHash := sha256.Sum256([]byte(masterKey))
	block, err := aes.NewCipher(keyHash[:])
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return ciphertext, nil
}
```

We derive the AES block key securely by hashing the configured master key. The GCM mode provides authenticated encryption, guaranteeing that any tampering with the cipher blob on disk instantly triggers an authentication failure upon `Decrypt`. 

Together, the resilient proxy routing and military-grade encryption ensure traffic flows optimally and securely across Key Collective boundaries.

### Concurrency and Thread Safety

The proxy engine coordinates thousands of concurrent client requests. The standard HTTP network listener dispatches a dedicated goroutine for each incoming connection. Consequently, our request pipeline must maintain strict thread safety without introducing global lock contention.

Notice that the proxy avoids acquiring global locks during the request stream. The token validation uses a highly optimized map lookup. While map reads are concurrent-safe in Go (provided there are no concurrent writes), any updates to `ValidTokens` would require careful synchronization.

Furthermore, the cryptography suite operates completely statelessly. Functions like `Encrypt` and `Decrypt` instantiate new AES cipher blocks per invocation. While this adds minor CPU overhead, it entirely eliminates lock contention during the encryption phase, allowing the proxy to encrypt and decrypt multiple payloads in parallel without bottlenecking. This mechanical sympathy for Go's concurrency model ensures Key Collective scales linearly with available CPU cores.

### Graceful Degradation and Failover

When an upstream AI provider experiences an outage, the `ProxyServer` must react instantaneously. The current architecture achieves this by immediately registering HTTP 5xx errors against the offending API key, plunging it into a rate-limited cooldown state. The very next inbound request will naturally bypass this exhausted key, seamlessly failing over to the next highest-priority, healthy key. This active probing and reactive failover mechanism ensure that transient network blips or sudden API rate limits on a single key do not cascade into global proxy failures. The engine simply routes around the damage, presenting a highly available interface to the downstream client.

### Optimizing Body Inspection

Reading the HTTP body to extract the requested model name introduces an unavoidable performance penalty, as the stream must be fully buffered into memory before it can be proxied. However, the engine mitigates this by restricting the JSON unmarshaling to a minimal struct containing only the `model` field. We intentionally ignore the dense prompt data or generation parameters, parsing only the exact bytes necessary to make a routing decision. By avoiding a full deserialization of the client payload, the proxy engine saves precious CPU cycles and dramatically reduces garbage collection pressure, ensuring that even large, multi-megabyte payloads are routed with minimal overhead.
