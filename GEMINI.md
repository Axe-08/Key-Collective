# Key Collective AI Constitution

## 1. Stack & Types
- **Language:** Go (1.23+) for backend, Svelte 5 (TypeScript) for frontend.
- **Typing:** Strict typing mandatory. No `interface{}` where a concrete struct or interface applies.
- **Dependencies:** Standard library preferred for Go (`net/http`, `embed`). Avoid bloated frameworks.

## 2. Invariants & Forbidden Patterns
- **No Plaintext Keys at Rest:** All API keys MUST be encrypted via AES-256-GCM before writing to SQLite. Master secret is an environment variable.
- **No Blocking I/O on Hot Path:** Request logging MUST be asynchronous (pushed to a buffered channel). The main proxy path must never block on a database write.
- **No Ephemeral State Trust:** In-memory rate limits (minute window) will reset on container restart. The circuit breaker (429 handling) is the ultimate source of truth.

## 3. Toolchain
- **Build:** `make build` handles both Svelte compilation and Go binary building.
- **DB:** SQLite with `WAL` mode mandatory.
