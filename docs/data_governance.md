# Data Governance & Privacy

## Prompt Privacy
**Rule:** Prompts and Completions MUST NOT touch the disk.
**Enforcement:** The Go HTTP proxy uses `httputil.ReverseProxy` streams. The request body is streamed directly to the upstream provider and the response directly back to the client. It is never materialized fully in memory or written to SQLite.

## PII and Audit
Key Collective does not inspect the payload for PII. It operates purely at the transport layer. The only data logged are metadata metrics (bytes, status codes, timestamps, key IDs).

## Master Secret
`KC_MASTER_KEY` must be a 32-byte cryptographically secure random string. It must never be stored in the codebase or the SQLite database.
