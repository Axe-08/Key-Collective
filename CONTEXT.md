# CONTEXT.md: Key Collective Grounding Specification

> **Grounding Prompt:** This file serves as the canonical single-source-of-truth grounding prompt for autonomous AI coding agents (Antigravity, Cursor, HIVE) operating in this repository.

---

## 🎯 1. Mission & Problem Statement

### The Market Paradox
Frontier and open-weights AI providers (Google Gemini, GroqCloud, SambaNova, Cerebras) offer generous free-tier APIs (e.g., Google Gemini provides 15 RPM / 1,500 RPD per project at zero cost, without requiring a credit card). However:
1. **Idle Waste:** The average developer uses their free tier only during evenings and weekends; over 90% of their daily free quota expires unutilized.
2. **Quota Choke:** During active coding sprints, evals, or agentic loops, developers hit rate limits (429 Resource Exhausted) within minutes.
3. **Credit Card Barrier:** Students, global developers without international payment cards, and indie hackers cannot upgrade to commercial paid tiers. Existing gateways (LiteLLM, Portkey) are designed for billing meters and virtual credit deductions, not communal free-tier pooling.

### The Key Collective Solution (v4.0 Commons)
Key Collective transforms fragmented, idle free-tier capacity into a **high-throughput, resilient reciprocal commons**:
- **Contribution Model:** Developers deposit their zero-credit-card free-tier API keys into the pool.
- **Multiplier Reward:** Contributing idle keys earns the developer a dynamic burst multiplier (1.5× to 4.5× baseline, up to 5.0× for Trusted Contributors).
- **Self-Key Priority:** All personal requests route through the tenant's own keys first (+10000 priority boost); communal pool quota is engaged only when personal keys are exhausted or rate-limited.
- **Zero-Credit-Card Guarantee:** Strict legal attestations (K1) and forced-error GCP ingress probing prevent accidental exposure to paid billing.
- **Statutory Safe Harbor:** Operates as a non-commercial, open-source platform under Section 79 of the Indian Information Technology Act, 2000.

---

## 🏛️ 2. Architectural Invariants (GEMINI.md Constitution)

Every line of code and every architectural change must satisfy these non-negotiable invariants:

1. **Strict TypeScript (No `any`):** Full strict mode across Cloudflare Workers, Durable Objects, and UI. No loose typing or untyped dictionaries.
2. **No Plaintext Keys:** Upstream keys are encrypted via AES-256-GCM with unique 12-byte CSPRNG nonces stored alongside ciphertext in D1. Keys are encrypted using per-tenant subkeys derived via Web Crypto HKDF (`deriveTenantKey(KC_MASTER_KEY, tenantId)`). Plaintext keys are never logged, persisted, or returned to clients.
3. **Per-Tenant DO Isolation:** Compute and memory isolation enforced via `env.KEY_POOL.idFromName(tenantId)` and `env.TENANT_QUOTA.idFromName(tenantId)`. Zero cross-tenant state within tenant DO instances.
4. **Fixed-Point Microdollars:** All financial accounting, cost metrics, and communal debt units are represented in `int64` / `bigint` microdollars (1 USD = 1,000,000 µ$). `MICRODOLLAR_MULTIPLIER = 1_000_000n`. Zero IEEE 754 floating-point math in financial calculations.
5. **DO Transactional Storage for Hot State:** In-memory circuit breakers, rate limiters, communal dispatch counters, and debt registers must synchronize to `this.ctx.storage` to survive DO eviction. D1 is reserved for persistence and rollups.
6. **Non-Blocking Telemetry:** High-frequency telemetry streams to Cloudflare Workers Analytics Engine (`env.TELEMETRY`) via `ctx.waitUntil()`. The proxy hot path is never blocked by database writes.
7. **Strict Quality Gate:** All code changes must pass `make gate` (<10s, `tsc --noEmit` and `vitest run`) before merge.

---

## 🌐 3. Cloudflare Bindings & Edge Environment

Configured in `wrangler.jsonc`:

| Binding | Type | Target Class / Database | Description |
|:---|:---|:---|:---|
| `KEY_POOL` | Durable Object | `KeyPoolDO` | Per-tenant key health, rate limits, circuit breaker, dispatch counters, hero/parasite classifier |
| `TENANT_QUOTA` | Durable Object | `TenantQuotaDO` | Per-tenant sliding window RPM/RPD, int64 community debt tracking, multiplier ceiling governor |
| `POOL_COORDINATOR` | Durable Object | `PoolCoordinatorDO` | Global singleton: provider health aggregation, quality weights (`wProvider`), spiker emergency brake |
| `DEMO_POOL` | Durable Object | `DemoDO` | Ephemeral playground rate limiting: 3 RPM / IP, 25 RPD / IP |
| `DB` | D1 Database | `key-collective-d1` | Persistent relational storage (`api_keys`, `users`, `contributor_standing`, `consent_attestations`) |
| `TELEMETRY` | Analytics Engine | `key_collective_telemetry` | High-throughput non-blocking telemetry stream |
| `ASSETS` | Static Assets | `./ui/dist` | Svelte 5 single page application frontend |
| `KC_MASTER_KEY` | Secret | Web Crypto Secret | Master key for HKDF tenant subkey derivation |
| `TURNSTILE_SECRET`| Secret | Cloudflare Turnstile | Anti-bot verification secret for registrations, key adds, and takedowns |

### Subdomain Host Routing

Incoming requests are triaged by `src/worker/gateway/subdomain.ts`:
- `key-col.axe08.tech` / `apex`: Public landing page and documentation
- `api.key-col.axe08.tech`: Inference API gateway (`/v1/chat/completions`, `/v1/models`, `/v1beta/...`)
- `console.key-col.axe08.tech`: Contributor console SPA (`ui/src/`)
- `admin.key-col.axe08.tech`: Admin surveillance panel (`/admin/api/...`)

---

## 📂 4. Ground-Truth Decoupled Directory Structure

The codebase has been refactored from legacy monoliths into highly modular, decoupled subsystems (ADR-0011 through ADR-0046):

```
Key Collective/
├── CONTEXT.md                     # Canonical grounding specification for AI coding agents
├── GEMINI.md                      # AI Constitution & non-negotiable architectural invariants
├── Makefile                       # make gate (<10s quality gate: tsc + vitest)
├── wrangler.jsonc                 # Cloudflare Workers & DO configuration
├── migrations/                    # D1 schema migrations (0001 through 0010)
│   ├── 0001_initial_schema.sql    # Base tables: users, auth_tokens, api_keys, cost_ledger
│   ├── 0002_v3_multi_project.sql  # Multi-project workspaces & project keys
│   ├── 0003_v3_5_governance.sql   # Governance tiers & quota sub-caps
│   ├── 0004_v3_5_quarantine.sql   # Anti-Sybil quarantine flags
│   ├── 0005_commons_pooling.sql   # Pool mode, observation status, dispatch counters
│   ├── 0006_project_hash_registry.sql # 3-state GCP project hash registry
│   ├── 0007_contributor_standing.sql # Community debt ledger & consent attestations
│   ├── 0008_abuse_ratelimit_cleanup.sql # Rate limit cleanup
│   ├── 0009_hkdf_flag.sql         # HKDF rolling migration tracking flag
│   └── 0010_purge_all_keys.sql    # Clean-slate key purge utility
│
├── src/
│   ├── index.ts                   # Root Cloudflare Worker entrypoint & DO re-exports
│   │
│   ├── contracts/                 # Canonical TypeScript contracts & Zod schemas
│   │   ├── v4_types.ts            # v4 schemas: ConsentAttestation, ApiKey, CommunityDebtLedger, PoolMetrics
│   │   ├── v3_5_types.ts          # Two-phase auth, public profile, admin surveillance
│   │   ├── v3_types.ts            # User tiers, tier limits map, user accounts, projects
│   │   ├── key_pool.ts            # EncryptedKey interface, KeyMetrics, KeyPoolContract
│   │   ├── router.ts              # RouteRequest, RouteResponse, RouterContract
│   │   ├── auth.ts                # AuthToken, AuthContext, AuthContract
│   │   ├── telemetry.ts           # TelemetryEvent, TelemetryContract
│   │   └── index.ts               # Barrel exports
│   │
│   ├── worker/                    # Worker HTTP layer & routing
│   │   ├── index.ts               # Worker router dispatcher
│   │   ├── error_normalizer.ts    # Downstream error normalizer & header sanitizer (FR-10, IR-12)
│   │   ├── pool_routes.ts         # Pool telemetry, standing, contribution, and notifications
│   │   ├── openapi_spec.ts        # OpenAPI 3.1 schema specification
│   │   ├── telemetry_emitter.ts   # Non-blocking Analytics Engine emitter
│   │   ├── gateway/               # Subdomain routing, console asset serving, admin verification
│   │   │   ├── subdomain.ts       # Hostname triage (api, console, admin, apex)
│   │   │   ├── console_handler.ts # SPA asset delegation
│   │   │   ├── admin_verifier.ts  # Admin token and role validation
│   │   │   └── admin_handler.ts   # Surveillance and circuit override handlers
│   │   ├── router/
│   │   │   ├── chat/              # /v1/chat/completions handler
│   │   │   │   ├── handler.ts     # Cascade coordination, token estimation, emergency brake check
│   │   │   │   ├── stream.ts      # SSE streaming handler with X-KC headers
│   │   │   │   └── non_streaming.ts # JSON completion response handler
│   │   │   ├── core/              # Key resolution and upstream dispatch
│   │   │   │   ├── key_resolver.ts # Decrypts keys via tenant HKDF subkey with cache
│   │   │   │   └── dispatcher.ts  # Core HTTP request forwarding
│   │   │   └── dashboard/         # Dashboard API endpoints
│   │   │       ├── keys/          # /api/keys: get_keys.ts, post_key.ts, ops.ts (rotate, test, pool-mode)
│   │   │       ├── abuse_routes.ts # /api/abuse/report-key takedown with 200ms timing shield
│   │   │       ├── metrics_routes.ts # Aggregated usage and latency metrics
│   │   │       ├── project_routes.ts # Multi-project management
│   │   │       ├── token_routes.ts # Project API token generation
│   │   │       └── auth_routes.ts  # Authentication state & profile endpoints
│   │   └── auth/                  # Bearer token validation and auth middleware
│   │
│   ├── durable_objects/           # Stateful per-tenant Durable Objects
│   │   ├── key_pool/              # KeyPoolDO per-tenant key management
│   │   │   ├── key_pool_do.ts     # DO lifecycle, alarm, health, selection, and dispatch tracking
│   │   │   ├── rpc.ts             # HTTP RPC method router
│   │   │   └── types.ts           # DO state interfaces and type guards
│   │   ├── circuit_breaker/       # 3-State circuit breaker (Closed, Open, Half-Open)
│   │   ├── rate_limiter/          # Sliding-window RPM rate limiter
│   │   └── key_selector/          # Priority-weighted key selector (+10000 boost for own keys)
│   │
│   ├── pool/                      # Global commons coordination
│   │   └── coordinator_do.ts      # PoolCoordinatorDO: global singleton, wProvider, spiker emergency brake
│   │
│   ├── quota/                     # Quota & Debt tracking
│   │   └── tenant/
│   │       ├── tenant_do.ts       # TenantQuotaDO: sliding-window RPM/RPD, int64 debt engine, decay alarm
│   │       ├── debt.ts            # calculateMultiplierCeiling, determineJailStatus, processDailyDebtReset
│   │       ├── evaluator.ts       # RPM/RPD hierarchical quota evaluation
│   │       └── types.ts           # Quota data models
│   │
│   ├── crypto/                    # Cryptographic subsystems
│   │   └── encryption/
│   │       ├── aes.ts             # AES-256-GCM encrypt/decrypt with 12-byte nonces & HKDF subkeys
│   │       ├── digest.ts          # SHA-256 digests and hashing utilities
│   │       └── index.ts           # deriveTenantKey, encrypt, decrypt
│   │
│   ├── ingress/                   # Ingress probes & project verification
│   │   └── probe.ts               # forceErrorGcpProbe: extracts GCP project number from ErrorInfo
│   │
│   ├── auth/                      # Authentication & Anti-Sybil
│   │   ├── oauth/                 # GitHub OAuth 2.0 PKCE client and token exchange
│   │   ├── sybil/                 # 5-Layer Anti-Sybil engine, Turnstile verification, subnet velocity
│   │   └── demo/                  # DemoDO ephemeral sandbox rate limiting
│   │
│   ├── router/                    # Routing engine & cascade fallbacks
│   │   ├── cascade/               # CascadeRouter: multi-provider fallback escalation
│   │   ├── capability/            # CapabilityFilter: model capabilities & context token sizing
│   │   └── registry/              # ModelRegistry: active models and pricing catalog
│   │
│   ├── proxy/                     # Provider proxying & stream transformers
│   │   ├── upstream/              # Upstream HTTP client with timeout and connection handling
│   │   └── sse/                   # SSEStreamTransformer for OpenAI-compatible streaming
│   │
│   └── storage/                   # Database persistence layer
│       ├── d1/                    # D1 query operations for keys, ledger, and rollups
│       └── repositories/          # Repositories for api_keys, auth_tokens, cost_ledger, model_registry
│
└── ui/                            # Contributor Console Frontend (Svelte 5 + TailwindCSS)
    └── src/
        ├── App.svelte             # Root SPA routing
        ├── lib/
        │   ├── PoolCommonsTab.svelte # Global pool telemetry, provider metrics, contribution gauges
        │   ├── AddKeyModal.svelte # Key submission modal with C1–C3/K1–K2 legal checkboxes & Turnstile
        │   ├── DebtLedgerWidget.svelte # Real-time debt ledger widget with dynamic multiplier meter
        │   ├── TelemetryCharts.svelte # Non-blocking streaming telemetry visualization
        │   ├── KeysTable.svelte   # Contributed keys table with pool mode toggles & status badges
        │   ├── admin/             # Admin surveillance table, velocity dials, circuit overrides
        │   ├── workbench/         # Project workspaces, identity cards, tier matrix
        │   ├── oauth/             # PKCE inspector, Sybil matrix visualization
        │   └── playground/        # Model testing playground with live SSE streaming
        └── main.ts
```

---

## ⚖️ 5. Legal Compliance Layer & Consent Invariants

To guarantee statutory safe harbor and prevent liability traps, Key Collective enforces mandatory clickwrap consent:

### Checkbox Specification

| Checkbox | Flow | Requirement | Statutory / Threat Vector Purpose |
|:---|:---|:---:|:---|
| **C1** | Registration | Mandatory | Intermediary Safe Harbor under Section 79 of the Indian Information Technology Act, 2000; non-commercial platform declaration. |
| **C2** | Registration | Mandatory | Prompt Eavesdropping Disclosure (Vector 13): User acknowledges requests are processed by third-party upstream providers (Google, Groq) and may appear in provider developer dashboards; no PII/confidential data allowed. |
| **C3** | Registration | Mandatory | Export Sanctions & Provider TOS (Vector 16): Contributor assumes individual responsibility for compliance with local and international export regulations. |
| **K1** | Key Submission | Mandatory | Paid-Tier Trap Liability (Vector 10): Contributor certifies the API key belongs to a project with NO credit card or billing account attached; Key Collective disclaims liability for any provider charges. |
| **K2** | Key Submission | Mandatory | Stolen Key Liability (Vector 05): Contributor certifies authorized ownership and the legal right to pool the key's free-tier quota. |

### Enforcement & Audit Trail
- **Runtime Block:** `src/worker/router/dashboard/keys/post_key.ts` asserts `body.k1 === true && body.k2 === true`. Missing attestations return `HTTP 400 Bad Request`.
- **Immutable Audit Log:** Stored in D1 table `consent_attestations` with `tenant_id`, `event_type`, `checkbox_id`, `attested_at`, `ip_address`, and `user_agent`. Append-only; zero updates or deletions permitted.

---

## 🔢 6. Fixed-Point Microdollars & Financial Invariants

Floating-point arithmetic (IEEE 754) is strictly forbidden across the codebase to prevent cumulative financial drift and precision loss:

- **Base Unit:** 1 USD = 1,000,000 microdollars (µ$). `MICRODOLLAR_MULTIPLIER = 1_000_000n` (`src/constants/financial.ts`).
- **Data Type:** All internal accounting uses `bigint` / `int64`.
- **Parsing:** String splitting (`dollarsToMicrodollars`) is used to convert dollar representations without float coercion.
- **Presentation:** Floating-point conversion (`microdollarsToDollars`) is restricted to the UI presentation layer.
- **Community Debt Accounting:** `community_debt_micro_cu` tracks consumption from the commons in micro-CU. Settled in real time when the contributor's own key serves other tenants' requests.
- **Multiplier Formulas (`src/quota/tenant/debt.ts`):**
  - Ratio $R = \frac{\text{Debt}}{\text{Daily Contributed CU}}$
  - $R > 1.0$ (Debt exceeded contribution): **Hard Jail** $\rightarrow$ multiplier locked to 1.0×, communal routing blocked.
  - $0.5 < R \le 1.0$: **Soft Warning** $\rightarrow$ multiplier capped at 1.5×.
  - $R \le 0.5$: **Pristine** $\rightarrow$ full multiplier ceiling up to 4.5×.
  - **Trusted Contributor:** 30 consecutive debt-free days unlocks a 5.0× ceiling and 30%/day debt decay (vs 20%/day standard).

---

## 🚦 7. Architectural Decision Records (ADRs)

The codebase evolution is captured in 65 formal Architecture Decision Records located in `docs/architecture/adr/`:

| Milestone | ADRs | Core Decision & Impact |
|:---|:---|:---|
| **Round 2 QA & Remediation** | ADR-0001 to ADR-0006 | Strict auth hardening, Firebase/OAuth live sync, profile state reactivity |
| **Gateway & Migration Core** | ADR-0007 to ADR-0009 | Error normalizer, D1 migrations 0002–0004 for v4.0, pool route API expansion |
| **Comprehensive Architecture** | ADR-0010 | Full codebase flow analysis and decoupling blueprint |
| **Decoupling Campaign** | ADR-0011 to ADR-0046 | Surgical decomposition of monoliths: `router_handler`, `upstream_client`, `cost_ledger`, `model_registry`, `sybil`, `key_selector`, `key_pool`, `tenant_do`, `sse_transformer`, `main_worker`, and Svelte UI modules into modular subdirectories |
| **Security & Isolation Gates** | ADR-0047 to ADR-0050 | Strict per-tenant D1 isolation, private key resolver security, live OAuth sync |
| **Packaging & Real Wiring** | ADR-0051 to ADR-0059 | Migration test safety, quota delegation, real SSE streaming, live token routes |
| **Hardening & Verification** | ADR-0060 to ADR-0065 | Dead code elimination, `.env.example` security, constant-time takedown, test context completeness |

---

## 🛡️ 8. Quality Gate & Verification Protocol

Every change must be validated through the repository quality gate:

```bash
make gate
```

**Gate Invariants (<10s runtime):**
1. `tsc --noEmit`: TypeScript compiler strict type check across all source files. Zero errors, zero `any`.
2. `vitest run`: Comprehensive unit and integration test suites validating:
   - AES-256-GCM and HKDF cryptographic isolation
   - Per-tenant DO boundary enforcement
   - Self-key priority cascade routing
   - Continuous community debt accumulation and multiplier clamping
   - Fixed-point microdollar math and string parsing
   - Downstream error sanitization and header stripping
   - Abuse takedown timing shield (200ms uniform padding)
   - TelemetryCharts non-blocking stream consumption
