---
status: Accepted
date: 2026-09-06
tags: [security, encryption, sqlite]
---

# ADR 002: Key Encryption & Asynchronous Logging

**Context:**
Storing 22 API keys in plaintext on a cloud volume is a security risk. Additionally, logging every proxied request directly to SQLite could cause I/O write contention under high RPM load.

**Decisions:**
1. **AES-256-GCM at Rest:** All API keys will be encrypted before being inserted into SQLite. The encryption master secret will be stored as an environment variable in Railway (`KC_MASTER_KEY`).
2. **In-Memory Decryption:** Keys are decrypted on boot and held in memory. They are never written back to disk unencrypted.
3. **Dashboard Masking:** Only `KeyPrefix` (first 6 chars) and `KeySuffix` (last 4 chars) are stored in plaintext for UI display.
4. **Batched Async Logging:** Request logs are sent to a buffered Go channel. A background goroutine flushes them to SQLite every 100 requests or 5 seconds, avoiding hot-path latency.

**Consequences:**
- *Positive:* High security posture. No disk I/O blocking the proxy proxy path.
- *Negative:* Loss of up to 5 seconds of log data if the container crashes abruptly. Accepted as a reasonable trade-off for performance.
