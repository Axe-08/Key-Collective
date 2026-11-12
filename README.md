# 🔑 Key Collective v4.0 (Community Capacity & Developer Platform)

[![TypeScript Strict](https://img.shields.io/badge/TypeScript-Strict%20Mode-blue.svg)](https://www.typescriptlang.org/)
[![Cloudflare Workers & Durable Objects](https://img.shields.io/badge/Cloudflare-Workers%20%26%20Durable%20Objects-orange.svg)](https://developers.cloudflare.com/workers/)
[![Quality Gate](https://img.shields.io/badge/Quality%20Gate-1199%2F1199%20Passed%20(<10s)-brightgreen.svg)](Makefile)
[![Zero Plaintext Keys](https://img.shields.io/badge/Security-AES--256--GCM%20Web%20Crypto-blueviolet.svg)](src/crypto/)

Key Collective is a **high-throughput, edge-native AI proxy, community capacity exchange, and quota multiplexer** running globally on Cloudflare Workers and Durable Objects. It federates free-tier and provisioned API keys across frontier AI providers (Google Gemini, GroqCloud, SambaNova, Cerebras) into unified, OpenAI-compatible streaming endpoints (`/v1/chat/completions`) with sub-millisecond failover, continuous credit scoring, and zero cross-tenant state leakage.

---

## 🌐 Live Deployment & Production Endpoints

| Environment / Service | Live URL | Description |
|---|---|---|
| **Web Console & Playground** | [console.key-col.axe08.tech](https://console.key-col.axe08.tech/) | Interactive developer console, live testing sandbox, and pool analytics |
| **API Edge Gateway** | [api.key-col.axe08.tech](https://api.key-col.axe08.tech/) | OpenAI-compatible completions gateway (`/v1/chat/completions`, `/v1/models`) |
| **Admin Surveillance** | [admin.key-col.axe08.tech](https://admin.key-col.axe08.tech/) | Restricted admin governance & circuit-breaker control plane |
| **Dev API Gateway** | [api-dev.key-col.axe08.tech](https://api-dev.key-col.axe08.tech/v1) | Staging and preview edge completions API |
| **Dev Console** | [console-dev.key-col.axe08.tech](https://console-dev.key-col.axe08.tech/) | Staging developer console and testing workbench |
| **Dev Admin** | [admin-dev.key-col.axe08.tech](https://admin-dev.key-col.axe08.tech/) | Staging surveillance and governance control plane |
| **Main Portal** | [key-col.axe08.tech](https://key-col.axe08.tech/) | Root custom domain and marketing / entry portal |

---

## ⚡ Key Capabilities & Architecture Highlights

- **Zero-Idle Event-Driven UI & In-Browser SWR Cache:** Completely eliminated background `setInterval` polling in the console. Idle open tabs make **0 requests/day** and **0 D1 queries/day**. Data is served instantly via a client-side SWR cache (`ui/src/lib/cache/browser_cache.ts`) with request deduplication, mutation invalidation, throttled window-focus revalidation (5 minutes), and dedicated manual refresh controls on stats and logs.
- **Non-Blocking Hot-Path & Bounded Analytics:** The completions proxy serving `/v1/chat/completions` offloads all telemetry emission and D1 credit rollups to asynchronous `ctx.waitUntil()` promises, delivering client responses with 0ms added database latency. Live analytics queries are bounded to rolling 7-day windows (`WHERE created_at >= datetime('now', '-7 days')`), avoiding full-table SQLite scans.
- **Communal Capacity Exchange:** A cooperative key pool where developers contribute provider keys in exchange for elevated capacity multipliers (`1.5x` up to `4.5x`).
- **Commons Economy & 24h Observation Window:** Community-contributed keys undergo an automated 24-hour observation quarantine before on-demand promotion into the active routing pool, protected by community eligibility checks (`community_eligible = 1`).
- **Normalized Shard Coordination & Cold Reconcile:** The global `PoolCoordinatorDO` enforces deterministic shard addressing (`pool:google`, `pool:groq`), managing state synchronization across distributed isolates with cold-start DO reconciliation derived directly from the actor ID.
- **5-Minute Surge Emergency Brake:** Monitors communal token consumption and automatically applies a 60-second isolation brake to any tenant whose traffic exceeds **35% of total pool volume** in a rolling 5-minute window.
- **Graduated Jail Demotion Cycle:** Contributor standing evaluates Community Debt against Contributed Capacity:
  - `PRISTINE` ($\text{Debt} / \text{Contributed} \le 0.50$): Full capacity multipliers and burst headroom.
  - `SOFT_WARNING` ($0.50 < \text{Debt} / \text{Contributed} \le 1.00$): Multiplier frozen, warning surfaced.
  - `HARD_JAIL` ($\text{Debt} / \text{Contributed} > 1.00$): Clamped to probationary bounds (2 RPM / 50 RPD).
- **Dedicated Interactive Playground & Developer Workbench:** Full-featured testing bench in the web console (`ui/src/lib/Playground.svelte`) with real-time SSE streaming inspection, latency profiling, dynamic model discovery via `/v1/models`, virtual client API keys, sub-caps, and responsive mobile navigation.

---

## 🏗️ System Topology

```mermaid
flowchart TD
    Client["Client / Agent Swarm / Web Playground"] -->|"POST /v1/chat/completions (Bearer Auth)"| Edge["Cloudflare Worker (Edge Ingress)"]
    
    subgraph EdgeIngress["1. Edge Ingress & Triage (<2ms)"]
        Edge -->|"Constant-Time Token Auth"| D1Auth["D1 SQLite: auth_tokens"]
        Edge -->|"Turnstile & Rate Check"| AntiAbuse["Anti-Sybil & Abuse Filter"]
        Edge -->|"Alias & Capability Resolution"| CascadeRouter["CascadeRouter & ModelRegistry"]
    end
    
    subgraph CoordinatorActor["2. Global Pool Coordination (Singleton DO)"]
        Edge -->|"report-volume & brake-check"| CoordinatorDO["PoolCoordinatorDO"]
        CoordinatorDO -->|"Surge Guard"| Brake["35% / 5-Min Emergency Brake"]
    end

    subgraph TenantActor["3. Isolated Tenant Actor (Per-Tenant DO)"]
        Edge -->|"env.KEY_POOL.idFromName(tenantId)"| TenantDO["KeyPoolDO & TenantQuotaDO"]
        TenantDO -->|"Sliding Window Counters"| Quota["RPM / RPD Enforcement"]
        TenantDO -->|"Health & Latency Sorting"| KeySelector["KeySelector & CircuitBreaker"]
        KeySelector -->|"AES-256-GCM Web Crypto"| Decrypt["In-Memory Key Decryption"]
        TenantDO -.->|"State Synchronization"| DOStorage["DO Transactional Storage"]
    end

    Decrypt -->|"HTTPS Dispatch (Bearer Auth)"| Upstream["Frontier Providers (Gemini / Groq / Cerebras)"]
    
    subgraph StreamPassthrough["4. Non-Blocking Passthrough & Rollup"]
        Upstream -->|"HTTP 200 SSE Chunks"| StreamTransformer["SSEStreamTransformer"]
        StreamTransformer -->|"0ms Added Latency"| Client
        StreamTransformer -.->|"ctx.waitUntil() Ledger Write"| D1Ledger["D1: cost_ledger & contributor_standing"]
        StreamTransformer -.->|"ctx.waitUntil() Telemetry"| Analytics["Workers Analytics Engine"]
        Upstream -->|"HTTP 429 Throttled"| Failover["60s Quarantine ➔ Sibling Escalation (<50ms)"]
    end
```

---

## 🛡️ Non-Negotiable Invariants

1. **Zero Plaintext Keys at Rest:** Upstream provider keys are encrypted with AES-256-GCM using unique 12-byte CSPRNG nonces and PBKDF2/HKDF master key derivation. Plaintext keys exist only in ephemeral V8 isolate memory during request dispatch.
2. **Per-Tenant Compute Isolation:** Routed via `env.KEY_POOL.idFromName(tenantId)`. Each tenant executes inside an isolated Durable Object actor with zero cross-tenant state.
3. **Integer Credit Units (`bigint` CU):** All capacity accounting uses 64-bit integer Capacity Units (`bigint` CU). Floating-point math and fractional currency arithmetic are strictly prohibited.
4. **DO Transactional Storage for Hot State:** Sliding-window rate counters and circuit breaker trip states persist to `this.ctx.storage`, surviving worker evictions and edge restarts.
5. **Non-Blocking Telemetry:** High-frequency event emission and cost ledger persistence are deferred to asynchronous `ctx.waitUntil()` tasks, guaranteeing zero proxy latency penalty on the hot path.
6. **Automated Upstream Failover:** Upstream HTTP 429 or 5xx responses trigger immediate key quarantine and transparent escalation across sibling keys or fallback models without breaking client streams.

---

## 📊 Live Model Registry & Cascades

The proxy maps logical aliases to canonical models and automatically falls back when capacity limits or upstream rate-limits occur:

| Model Alias | Primary Upstream Model | Fallback Candidates | Supported Capabilities |
|---|---|---|---|
| `auto` | Cheapest capable model across providers the tenant can get a lease for | — | Chat, Tools, JSON Mode |
| `smart-fast` | `gemini-2.5-flash` | `groq/llama-3.3-70b-versatile` | Chat, Tools, Vision |
| `coder-high` | `gemini-3.1-pro-preview` | `groq/openai/gpt-oss-120b` | Extended Reasoning, Coding, Long Context |
| `open-groq` | `groq/llama-3.3-70b-versatile` | `groq/openai/gpt-oss-20b` | Ultra-Low Latency, Chat |

---

## 🚀 Quickstart & Development

### 1. Prerequisites
- Node.js >= 20.x
- `npm` or `pnpm`
- Cloudflare Wrangler CLI (`npm install -g wrangler`)

### 2. Installation & Quality Gate
```bash
# Install root and UI dependencies
make setup

# Run strict typecheck and all 1,199 automated tests in <10s
make gate
```

### 3. Local Development
```bash
# Initialize local development environment variables
cp .dev.vars.example .dev.vars

# Apply local D1 schema migrations
npx wrangler d1 migrations apply key-collective-db --local

# Start local Worker & Durable Objects runtime
npm run dev

# In another terminal, run the Svelte 5 frontend console
cd ui && npm run dev
```

### 4. Sending an OpenAI-Compatible Chat Request
```bash
curl -X POST https://api.key-col.axe08.tech/v1/chat/completions \
  -H "Authorization: Bearer kc_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Explain zero-knowledge proofs in one concise paragraph."}
    ],
    "stream": true
  }'
```

---

## 📁 Repository Structure

```
.
├── src/                     # Backend Worker & Durable Objects (see src/README.md)
│   ├── durable_objects/     # KeyPoolDO, CircuitBreakers, KeySelector & RateLimiter
│   ├── pool/                # PoolCoordinatorDO (35% surge brake, leaky bucket, debt engine)
│   ├── quota/               # TenantQuotaDO (sliding-window multi-project limits)
│   ├── router/              # CascadeRouter, ModelRegistry, CapabilityFilter
│   ├── proxy/               # UpstreamClient, SSEStreamTransformer, CostCalculator
│   ├── crypto/              # AES-256-GCM Web Crypto encryption & nonce utilities
│   ├── worker/              # Worker entry, router_handler, pool_routes, auth_middleware
│   └── contracts/           # Strict TypeScript contracts & telemetry models
├── ui/                      # Svelte 5 Developer Console & Interactive Playground
│   ├── src/lib/Playground.svelte   # Standalone model testbench & stream reader
│   ├── src/lib/Workbench.svelte    # Multi-project key management & sub-caps
│   ├── src/lib/PoolCommonsTab.svelte # Communal pool telemetry & contributor standing
│   ├── src/lib/MetricCards.svelte  # Real-time telemetry cards with manual refresh
│   └── src/lib/cache/              # Browser SWR cache engine & deduplicator
├── docs/
│   ├── adr/                 # Architecture Decision Records (ADR-001 through ADR-006)
│   ├── architecture/        # LLDs, UI designs, and state machines
│   └── codeflow/            # Microscopic CFGs, call graphs, and Def-Use matrices
├── migrations/              # D1 SQL relational schema migrations
├── CONTRIBUTING.md           # Developer onboarding & contribution guidelines
└── Makefile                 # Quality gate & development automation harness
```

---

## 🤝 Contributing

We welcome community contributions! Please review [`CONTRIBUTING.md`](CONTRIBUTING.md) for architectural guidelines, coding standards, and our pull request checklist.

---

## 🏛️ Governance & Knowledge Integration

- **Architecture Decision Records:** Documented in [`docs/adr/`](docs/adr/) and mirrored to `~/Vault/1-Projects/Key-Collective/`.
- **Knowledge Base Synchronization:** Codebase Scribe exports evergreen concepts (`communal-capacity-credit-and-jail-cycle`, `adaptive-cascade-routing-and-fallback-escalation`) to Obsidian Vault at `~/Vault/2-Areas/ai-systems/`.
