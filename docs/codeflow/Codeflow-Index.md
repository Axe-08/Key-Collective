---
tags: [type/index, project/Key-Collective, codeflow]
---

# 🗺️ Codeflow Index: Key-Collective

> Microscopic control flow graphs (CFGs), Def-Use data flow matrices, and purity profiles for the entire `Key-Collective` architecture.

## 📄 Core Architecture Modules

### Edge Routing & Ingress
- [[edge_auth_and_router_handler_cfg|Edge Auth & Router Handler CFG]] — Worker edge ingress, DO RPC, cascade routing & streaming
- [[cascade_router_and_priority_cfg|Cascade Router & Priority CFG]] — Cascade key resolution, capability filter & fallback tiers
- [[api_handler_cfg|API Handler CFG]] — Legacy / fallback proxy routing interface
- [[proxy_handler_cfg|Proxy Handler CFG]] — Upstream proxy execution handler
- [[proxy_key_manager_cfg|Proxy Key Manager CFG]] — Dynamic key selector & rotation engine

### Durable Object State & Quota Isolation
- [[durable_object_key_pool_cfg|Durable Object Key Pool CFG]] — Per-tenant stateful key isolation, circuit breaker & RPM counters
- [[pool_coordinator_and_quota_do_cfg|Pool Coordinator & Quota DO CFG]] — 35% surge emergency brake & multi-project sliding quotas
- [[pool_coordinator_and_emergency_brake_cfg|Pool Coordinator & Emergency Brake CFG]] — Anomalous 35% spiker throttling & active key selector
- [[pool_routes_and_community_telemetry_cfg|Pool Routes & Community Telemetry CFG]] — Contributor standing, capacity multiplier & jail cycle
- [[tenant_quota_and_debt_ledger_cfg|Tenant Quota & Debt Ledger CFG]] — Fixed-point microdollar debt ledger & reciprocal standing state machine
- [[key_hydration_startup_cfg|Key Hydration Startup CFG]] — D1 persistence to DO in-memory cache startup hydration

### Streaming & Cryptographic Security
- [[sse_transformer_and_upstream_client_cfg|SSE Transformer & Upstream Client CFG]] — Zero-latency SSE chunk passthrough & usage extraction
- [[sse_transformer_and_error_sanitizer_cfg|SSE Transformer & Error Sanitizer CFG]] — Stream normalization & zero-leak upstream error masking
- [[web_crypto_encryption_cfg|Web Crypto Encryption CFG]] — Zero-plaintext AES-256-GCM encryption & HKDF derivation
- [[hkdf_and_aes_encryption_cfg|HKDF & AES Encryption CFG]] — Ephemeral tenant HKDF key derivation & Web Crypto encryption

### Analysis & Frontend Workbench
- [[code_review_and_def_use_matrix|Code Review & Def-Use Matrix]] — Exhaustive symbol variable lifecycles & cognitive complexity
- [[frontend_workbench_and_playground_cfg|Frontend Workbench & Playground CFG]] — Svelte 5 interactive testing bench & real-time telemetry
- [[frontend_dataflow|Frontend Dataflow]] — Reactive runes state architecture and metric synchronizer

```dataview
LIST FROM "1-Projects/Key-Collective/codeflow"
WHERE file.name != "Codeflow-Index"
SORT file.name ASC
```

## 🔗 Navigation
- [[Key-Collective-Hub]] — Master Project Hub
- [[Dashboard]] — Central Vault Command
