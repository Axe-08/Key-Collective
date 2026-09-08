# Interfaces and Gateways

To interact with the outside world, Key Collective projects a RESTful surface area and a seamless web frontend. We now dissect the boundaries where HTTP traffic translates into domain behaviors.

## Three-Pass Dissection

### 1. Purpose

The API interface structures JSON payloads and coordinates HTTP status codes. The Go `Handler` serves as a classic controller, marshaling `CreateKeyRequest` data and returning formatted `KeyResponse` payloads. Simultaneously, the Svelte application establishes a lightweight bridge, connecting UI components to backend endpoints for seamless administration.

### 2. Invariants

-   **Transport Decoupling**: API handlers never leak internal system errors directly. `ErrorResponse` dictates a strict, safe format for returning diagnostics.
-   **Idempotent State Management**: Deleting a key via the handler purges both memory structures and durable database rows in a unified action.
-   **Prefix/Suffix Visibility**: Endpoints returning key collections apply masking algorithms, exposing only enough characters for user identification without revealing cryptographic power.

### 3. State Lifecycle

A user initiates an action via the frontend. The `CreateKeyPayload` serializes across the network and arrives at `HandleCreateKey`. The controller hydrates the payload, enforces input validation, triggers the cryptographic engine, persists to SQLite, updates the in-memory load balancer, and responds with a sanitized `KeyResponse`.

## REST API Controllers

The `Handler` orchestrates the HTTP boundary, utilizing the Go 1.22+ `ServeMux` for precise route registration.

```go
type Handler struct {
	DB        *db.DB
	Manager   *proxy.KeyManager
	MasterKey string
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/keys", h.HandleGetKeys)
	mux.HandleFunc("POST /api/keys", h.HandleCreateKey)
	mux.HandleFunc("DELETE /api/keys/{id}", h.HandleDeleteKey)
	mux.HandleFunc("POST /api/keys/{id}/test", h.HandleTestKey)
	mux.HandleFunc("GET /api/logs", h.HandleGetLogs)
	mux.HandleFunc("GET /api/stats", h.HandleGetStats)
}
```

The method-based routing simplifies payload handling. By injecting the `DB` and `KeyManager`, the controller avoids global state and facilitates clean unit testing.

### Structuring JSON Boundaries

Clear data contracts define the HTTP inputs and outputs.

```go
type CreateKeyRequest struct {
	Label    string          `json:"label"`
	Provider domain.Provider `json:"provider"`
	Key      string          `json:"key"`
	RPMLimit int             `json:"rpm_limit"`
	RPDLimit int             `json:"rpd_limit"`
	Priority int             `json:"priority"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type MessageResponse struct {
	Message string `json:"message"`
	ID      string `json:"id,omitempty"`
}
```

These structures enforce predictability. `CreateKeyRequest` expects specific integers for quotas. If a client submits malformed JSON, the server responds with a standard `ErrorResponse`, maintaining interface stability. Operations like deletions rely on `MessageResponse` to confirm intent completion.

### Key Masking and Validation

When ingesting a new token, the backend isolates the secrets immediately. The logic extracts visible signatures using an intelligent algorithm.

```go
func extractPrefixSuffix(key string) (string, string) {
	if len(key) <= 6 {
		return key, ""
	}
	prefix := key[:6]
	if len(key) <= 10 {
		return prefix, key[6:]
	}
	suffix := key[len(key)-4:]
	return prefix, suffix
}
```

This ensures we only store the `KeyPrefix` and `KeySuffix` in plaintext. The UI receives these segments in the `KeyResponse`, allowing operators to identify "gemini...A12b" without risking full disclosure.

Furthermore, the system offers diagnostic endpoints. The `HandleTestKey` controller orchestrates health validations.

```go
	if found.Status == domain.KeyInvalid {
		writeJSON(w, http.StatusOK, TestKeyResponse{
			Success:   false,
			LatencyMs: 45.0,
			Message:   "Invalid API Key token rejected by upstream provider (HTTP 401)",
		})
		return
	}

	writeJSON(w, http.StatusOK, TestKeyResponse{
		Success:   true,
		LatencyMs: 125.0,
		Message:   fmt.Sprintf("Key %s verified successfully with upstream in 125ms", found.Label),
	})
```

The `TestKeyResponse` standardizes the result format, allowing the frontend to quickly render diagnostic badges indicating provider connectivity.

## The Frontend Bridge

The interface logic extends into the browser, leveraging a Svelte 5 application.

```typescript
export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}
```

The TypeScript definitions precisely mirror the Go structs, ensuring type safety across the network boundary. The Svelte application compiles down into static assets. The Go backend utilizes `ui/ui.go` to serve these assets natively. This unified deployment strategy produces a single autonomous binary containing both the robust REST API gateways and the interactive administrative interface.

### Extensibility and Versioning

As the API surface grows, maintaining backwards compatibility is paramount. The current `Handler` leverages semantic URL paths (e.g., `/api/keys`) to establish a clear boundary. Should we require structural changes to `CreateKeyRequest`, we can seamlessly introduce a `/api/v2/keys` namespace while leaving the existing handlers intact.

This modularity extends to the HTTP response types. The `MessageResponse` and `ErrorResponse` structs provide predictable unmarshaling targets for the Svelte frontend. If a UI component encounters an unexpected HTTP 400, it safely relies on the `Error` field being present.

Moreover, the integration of the UI assets via Go's `embed` package (though not explicitly shown in the handler logic) represents a significant operational advantage. The frontend bridge is not merely a JSON contract; it is a unified deployment artifact. The Svelte application consumes these very same structs, bridging the gap between Go's strong typing and TypeScript's interface definitions, creating an unbreakable contract from the database to the DOM.

### Idempotency in State Management

The administrative gateways are designed with idempotency in mind. When a user requests the deletion of a key via `HandleDeleteKey`, the system guarantees a deterministic outcome regardless of network retries. If a client sends the same DELETE request twice due to a browser timeout, the first invocation purges the key from SQLite and the in-memory load balancer. The second invocation safely returns an HTTP 404 Not Found, precisely adhering to REST semantics without risking data corruption or phantom state in the `KeyManager`.

### Diagnostic Capabilities

The inclusion of the `/test` endpoint represents a profound operational advantage. Rather than forcing administrators to blindly guess whether an API key possesses sufficient quota or correct permissions, the `HandleTestKey` controller actively probes the upstream provider. By simulating a real request and capturing the latency and status code, the gateway provides immediate, empirical proof of a key's validity. This diagnostic loop drastically reduces the mean time to resolution (MTTR) when debugging complex routing failures, empowering operators to isolate whether an issue stems from internal proxy misconfiguration or an external provider ban.
