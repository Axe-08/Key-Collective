---
status: Accepted
date: 2026-09-06
tags: [architecture, go, svelte, railway]
---

# ADR 001: Backend, Frontend, and Hosting Stack

**Context:** 
We need to build a centralized proxy to pool and route LLM API keys. The system must have high concurrency handling, a web dashboard, and run on a free cloud tier without cold starts or spin-downs.

**Decisions:**
1. **Backend:** Go (`net/http`). Why: Extremely low memory footprint (~8-15MB), compiles to a static binary, native goroutines for high-concurrency proxying without ASGI overhead.
2. **Frontend:** Svelte 5 + Tailwind. Why: Compiles to vanilla JS (~5KB bundle), zero runtime overhead, can be embedded directly into the Go binary using `embed.FS`.
3. **Database:** SQLite in WAL mode. Why: Zero-ops, ultra-fast local reads, single-file backup.
4. **Hosting:** Railway Free Tier. Why: $1/mo free credit completely covers the ~$0.40/mo cost of running a 15MB Go binary 24/7 with a 1GB persistent volume. No 15-minute spin-down limits like Render.

**Consequences:**
- *Positive:* Total cost is $0/month. No cold starts. Single container deployment.
- *Negative:* Requires porting the existing Python `KeyManager` prototype to Go.
