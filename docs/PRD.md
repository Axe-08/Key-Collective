# Key Collective v4.0 — Complete Product Requirements Document

> **Version Transition:** v3.5 (Private Key Vault & Proxy) → v4.0 (Reciprocal Commons)  
> **Document Type:** Full Product Requirements & System Requirements Specification (PRD/SRS)  
> **Status:** Production Ground Truth — Fully Implemented & Verified  
> **Effective Date:** September 2026  
> **Governing Standards:** `GEMINI.md` Constitution · `docs/legal/threat_vectors.md` · `docs/legal/countermeasures_and_mitigations.md` · ADRs 0001–0065

---

## Table of Contents

1. [Transition Summary: v3.5 → v4.0](#1-transition-summary)
2. [User Personas](#2-user-personas)
3. [Complete User Flow Documentation](#3-complete-user-flow-documentation)
4. [Information Architecture & UI Screen Specification](#4-information-architecture--ui-screen-specification)
5. [Legal Consent & Compliance Layer](#5-legal-consent--compliance-layer)
6. [Functional Requirements (FR)](#6-functional-requirements)
7. [Infrastructure Requirements (IR)](#7-infrastructure-requirements)
8. [D1 Database Schema — Migration Specification](#8-d1-database-schema)
9. [Durable Object Architecture](#9-durable-object-architecture)
10. [API Endpoint Specification](#10-api-endpoint-specification)
11. [Non-Functional Requirements (NFR)](#11-non-functional-requirements)
12. [Information Boundary — What Users See vs. What is Hidden](#12-information-boundary)
13. [Implementation Phasing & Dependency Graph](#13-implementation-phasing)
14. [Verification & Acceptance Criteria](#14-verification--acceptance-criteria)

---

## 1. Transition Summary

### 1.1 What v3.5 Is Today

Key Collective v3.5 is a production-grade Cloudflare Workers + Durable Objects **private multi-model LLM proxy**. A tenant registers, stores their own provider API keys (encrypted AES-256-GCM in D1), and the system routes their personal requests through their own keys using a cascade fallback strategy.

The architecture already implements:
- ✅ GitHub OAuth 2.0 PKCE (`src/auth/oauth/`)
- ✅ 5-Layer Anti-Sybil engine (account age, subnet velocity, email, Turnstile, contributions) (`src/auth/sybil/`)
- ✅ Per-tenant `KeyPoolDO` with circuit breaker and RPM rate limiter (`src/durable_objects/key_pool/`)
- ✅ Per-tenant `TenantQuotaDO` with sliding-window RPM/RPD enforcement (`src/quota/tenant/`)
- ✅ `CascadeRouter` with `CapabilityFilter` and `ModelRegistry` (`src/router/`)
- ✅ AES-256-GCM key encryption with global master secret & HKDF per-tenant keys (`src/crypto/encryption/`)
- ✅ OpenAI-compatible proxy with SSE streaming (`src/proxy/`)
- ✅ Admin surveillance panel (`src/worker/gateway/admin_handler.ts`)
- ✅ D1 schema: `users`, `auth_tokens`, `api_keys`, `projects`, `model_registry`, `cost_ledger`, `daily_spend_rollup`
- ✅ Subdomain routing: `api.*`, `console.*`, `admin.*`, `apex.*`

### 1.2 What v3.5 Could Not Do vs. What v4.0 Delivers (The Commons Gap Closed)

| Capability | v3.5 Status | v4.0 Delivered Status | Implemented Components |
|:---|:---:|:---:|:---|
| Contribute key to shared communal pool | ❌ | ✅ Implemented | FR-01, FR-07, IR-01 (`migrations/0005_commons_pooling.sql`, `src/worker/router/dashboard/keys/post_key.ts`) |
| Draw from other contributors' idle quota | ❌ | ✅ Implemented | FR-02, FR-04, IR-04 (`src/worker/router/chat/handler.ts`, `src/router/cascade/`) |
| Track community debt / dynamic multiplier | ❌ | ✅ Implemented | FR-03, IR-05 (`src/quota/tenant/debt.ts`, `src/quota/tenant/tenant_do.ts`) |
| Global pool health telemetry | ❌ | ✅ Implemented | FR-04, IR-06 (`src/worker/pool_routes.ts`, `src/pool/coordinator_do.ts`) |
| Switch keys between Private and Community pools | ❌ | ✅ Implemented | FR-01, FR-14, FR-22 (`src/worker/router/dashboard/keys/ops.ts`) |
| Anti-Sybil GCP project hash extraction | ❌ | ✅ Implemented | FR-06, IR-09 (`src/ingress/probe.ts`, `migrations/0006_project_hash_registry.sql`) |
| Enforce 24h community routing observation quarantine | ❌ | ✅ Implemented | FR-07 (`src/worker/router/dashboard/keys/post_key.ts`, `migrations/0005_commons_pooling.sql`) |
| 14-day project hash tombstone | ❌ | ✅ Implemented | FR-08 (`src/worker/router/dashboard/keys/post_key.ts`, `project_hash_registry`) |
| Per-tenant HKDF encryption isolation | ❌ (global key) | ✅ Implemented | FR-09, IR-11 (`src/crypto/encryption/aes.ts`, `src/crypto/encryption/index.ts`) |
| Downstream error normalizer (provider leak shield) | Partial | ✅ Implemented | FR-10, IR-12 (`src/worker/error_normalizer.ts`, `src/proxy/upstream/client.ts`) |
| Abuse takedown endpoint with timing shield | ❌ | ✅ Implemented | FR-11, IR-13 (`src/worker/router/dashboard/abuse_routes.ts`) |
| Midnight jitter + leaky-bucket queue | ❌ | ✅ Implemented | FR-05, IR-07, IR-08 (`src/pool/coordinator_do.ts`) |
| Passive contributor canary alarm | ❌ | ✅ Implemented | FR-13, IR-14 (`src/durable_objects/key_pool/key_pool_do.ts`) |
| Hero/Parasite classification engine | ❌ | ✅ Implemented | FR-16, IR-05 (`src/durable_objects/key_pool/key_pool_do.ts`) |
| Progressive vesting ramp (1.5× → 4.5× / 5.0×) | ❌ | ✅ Implemented | FR-17, FR-21 (`src/quota/tenant/debt.ts`, `src/quota/tenant/tenant_do.ts`) |
| Console dashboard with pool/standing/telemetry tabs | ❌ | ✅ Implemented | FR-14, IR-15 (`ui/src/lib/`, `ui/src/lib/PoolCommonsTab.svelte`) |
| Legal clickwrap at registration and key submission | ❌ | ✅ Implemented | FR-15, IR-18 (`src/worker/router/dashboard/keys/post_key.ts`, `migrations/0007_contributor_standing.sql`) |
| Pool Coordinator singleton DO | ❌ | ✅ Implemented | IR-04, IR-06 (`src/pool/coordinator_do.ts`, `wrangler.jsonc`) |
| Forced-error GCP ingress probe | ❌ | ✅ Implemented | IR-09 (`src/ingress/probe.ts`) |

---

## 2. User Personas

### P1: The Indie Hacker / Side-Project Developer
- Builds personal projects evenings and weekends
- Capped hard by 15 RPM / 1,500 RPD free limits
- Cannot afford paid API tiers
- Wants zero config: plug-in compatible with any OpenAI SDK tool

### P2: The Open-Source Maintainer / Research Engineer
- Runs evaluation pipelines, benchmark suites, agent loops
- Needs sustained throughput without hitting rate-limit crashes mid-run
- Willing to contribute keys for multiplier benefit
- Values transparency about what the system does with their key

### P3: The Student / Hackathon Builder
- No international credit card — cannot add billing to Google Cloud
- Hard-locked to free tier
- Needs communal capacity buffer during crunch hours
- Discovered Key Collective via an open-source AI repo or hackathon Discord

### P4: The Altruistic Contributor
- Has multiple Google Cloud projects with free API keys
- Makes few personal requests
- Donates quota as infrastructure contribution to the open-source ecosystem
- Wants to know their keys are healthy without logging in every day

---

## 3. Complete User Flow Documentation

### 3.1 Flow A: First-Time Visitor → Registered Contributor

```
[LANDING PAGE]
     │
     ├── CTA: "Join the Commons" ──► [GITHUB OAUTH SCREEN]
     │
     └── CTA: "Use the API Now" ──► [DEMO MODE] (25 RPD, shared IP pool, no key required)

[GITHUB OAUTH SCREEN]
     │
     ├── GitHub redirects with code + state
     │
     ▼
[OAUTH CALLBACK WORKER]
     │
     ├── Verify PKCE state + nonce (CSRF guard)
     ├── Exchange code for GitHub access token
     ├── Fetch GitHub profile (username, id, created_at, public_repos, contributions)
     │
     ├── 5-Layer Anti-Sybil Check (src/auth/sybil.ts — EXISTING):
     │    ├── L1: Cloudflare Turnstile bot verification
     │    ├── L2: /24 subnet velocity (1 account per /24 per 30 days)
     │    ├── L3: Email domain clean (no disposables)
     │    ├── L4: GitHub account age ≥ 30 days, ≥ 1 public repo, ≥ 5 contributions
     │    └── L5: Datacenter ASN check
     │
     ├── PASS (score ≥ 65) ──► [CONSENT & TOS SCREEN]
     ├── PASS (score 40–64) ──► [PROBATIONARY TIER] (2 RPM, 50 RPD, no key contribution)
     └── FAIL (score < 40) ──► HTTP 403 "Account not eligible"

[CONSENT & TOS SCREEN]  ← NEW in v4.0
     │
     ├── Three mandatory checkboxes (see Section 5.1)
     ├── Privacy disclosure (provider dashboard logging)
     ├── Export control safe-harbor notice
     │
     ├── [ACCEPT & CONTINUE] ──► Account created, JWT issued, redirect to console
     └── [DECLINE] ──► Session abandoned, no account created
```

---

### 3.2 Flow B: First Login → Onboarding → First Key Submission

```
[CONSOLE: WELCOME SCREEN]
     │
     ├── Status Banner: "You're in Probationary Mode — add a provider key to unlock Builder tier"
     ├── How-it-works explainer:
     │    ├── "Your key earns a multiplier (1.5x–4.5x) based on how much idle quota you donate"
     │    ├── "For the first 24 hours, your key serves only your own requests (observation period)"
     │    └── "After 24 hours, your idle quota helps the community and earns you burst access"
     │
     └── CTA: [Add Your First Key] ──► [KEY SUBMISSION MODAL]

[KEY SUBMISSION MODAL]  ← NEW in v4.0
     │
     ├── Step 1: Select Provider
     │    └── Dropdown: [Google Gemini] [GroqCloud] [SambaNova] [Cerebras]
     │
     ├── Step 2: Enter Key
     │    └── Masked input field + paste button
     │         Note displayed: "Your key is encrypted before storage using AES-256-GCM.
     │                          Key Collective cannot read it after submission."
     │
     ├── Step 3: Choose Initial Pool Mode
     │    ├── ◉ Community Pool (Recommended)
     │    │    "Earns 1.5x–4.5x multiplier. 24-hour observation period before
     │    │     your key serves other users. You can switch to Private at any time."
     │    └── ○ Private Pool
     │         "Dedicated to your own requests only. 1.0x passthrough.
     │          No community access. No multiplier earned."
     │
     ├── Step 4: Legal Attestations (BOTH mandatory before submit enabled)
     │    ├── [ ] "I certify this key belongs to a project with NO billing account
     │    │         or credit card attached."
     │    │    [? Help: How to verify billing is disabled →]
     │    └── [ ] "I am the authorized creator of this API key and have the legal
     │              right to contribute its quota to Key Collective."
     │
     ├── Step 5: Invisible Cloudflare Turnstile (fires on form render)
     │
     └── [Submit Key]
          │
          ├── Turnstile token validated
          ├── Phase 1: Forced-error GCP probe  ← NEW in v4.0
          │    ├── Fire invalid model request → extract project number from ErrorInfo
          │    ├── SHA-256 project hash → check D1 project_hash_registry
          │    ├── CONFLICT: HTTP 409 "A key from this Google Cloud project is already
          │    │             registered. Each project may only be contributed once."
          │    └── OK: Proceed to Phase 2
          ├── Phase 2: Proof-of-life probe (1-token health check)
          │    ├── 429 → HTTP 400 "Key has no available quota. Please submit when healthy."
          │    └── 200 → Key accepted
          ├── Key encrypted (HKDF-derived per-tenant AES key)  ← NEW in v4.0
          ├── Saved to D1 with pool_type, community_routing_status='OBSERVATION',
          │    observation_until = NOW + 24h
          ├── project_hash_registry entry created (state='ACTIVE')
          └── Success modal: "Key added! 24-hour observation period active.
                              Your key will join the community pool in 24 hours."
```

---

### 3.3 Flow C: Daily Active Developer — Making Inference Requests

```
Developer sends: POST https://api.keycollective.dev/v1/chat/completions
Headers: Authorization: Bearer kc_live_...
Body: { model, messages, stream, safetySettings (optional), extra_body (optional) }

[EDGE WORKER — AUTH MIDDLEWARE]
     │
     ├── Validate KC Bearer token (SHA-256 hash lookup in D1)
     ├── Resolve tenantId from token
     └── Hydrate TenantQuotaDO via env.TENANT_QUOTA.idFromName(tenantId)

[EDGE WORKER — QUOTA CHECK (TenantQuotaDO)]
     │
     ├── Check RPM (1-minute sliding window)
     │    └── EXCEEDED → HTTP 429 { error: "rate_limited", retry_after: N }
     └── Check RPD (24-hour sliding window)
          └── EXCEEDED → HTTP 429 { error: "quota_exhausted" }

[SELF-KEY PRIORITY ROUTER]  ← NEW in v4.0
     │
     ├── Query: Does tenant own ANY healthy key for requested provider?
     │    (From TenantKeyPoolDO, filter: status=HEALTHY, pool_type=PRIVATE or COMMUNITY)
     │
     ├── YES → Route through tenant's OWN key
     │          dispatched_today += 1, dispatched_communal += 0
     │          Zero community debt incurred for this request
     │
     └── NO (all own keys exhausted / rate-limited) →
          ├── Check community_debt vs daily_contributed_CU
          │    ├── debt > 1.0× → HTTP 429 "Quota jail: community debt exceeded.
          │    │                            Only your own keys are accessible."
          │    └── debt ≤ 1.0× → Dispatch to Global Pool Coordinator DO
          │
          [POOL COORDINATOR DO]  ← NEW in v4.0
               │
               ├── Select optimal key: provider match, W_provider weight, round-robin
               ├── Exclude keys in OBSERVATION status (< 24h old)
               ├── Exclude keys in QUARANTINED/REVOKED status
               ├── Check anomalous spiker: tenant_share_last_5min > 35%?
               │    └── YES → emergency brake, route own key or 429
               └── Route through community key
                    ├── community_debt += Request_CU_Weight (in requester's TenantDO)
                    └── community_debt -= Request_CU_Weight (in key owner's TenantDO)

[UPSTREAM CLIENT]
     │
     ├── Strip all client auth headers (Authorization, x-api-key, etc.)
     ├── Inject upstream provider key (decrypted from tenant/pool key store)
     ├── Transparently forward safetySettings, extra_body, extra_headers
     └── Stream response body through SSEStreamTransformer

[RESPONSE NORMALIZER]  ← PARTIALLY EXISTS, needs full hardening
     │
     ├── Strip upstream provider headers:
     │    x-goog-*, x-groq-*, x-cloud-trace-context, alt-svc, server, cf-ray, x-envoy-*
     ├── Inject: X-KeyCollective-Request-Id: kc_req_<uuid>
     └── On upstream error:
          ├── Extract & discard google.rpc.ErrorInfo (GCP project numbers, billing strings)
          └── Return normalized error: { error: "upstream_unavailable", status: 502 }
```

---

### 3.4 Flow D: Key Rotation (Legitimate Security Hygiene)

```
[DASHBOARD: MY KEYS TAB]
     │
     └── User clicks [Rotate] on an active key

[ROTATION CONFIRMATION MODAL]
     │
     ├── "Rotating a key deletes your current key and starts a 30-minute window to submit
     │    a replacement from the same Google Cloud project. Your vesting tier is preserved."
     │
     └── [Confirm Rotation]
          │
          ├── Current key marked DELETED in api_keys
          ├── project_hash_registry state → 'ROTATING', rotating_until = NOW + 30 min
          ├── TenantKeyPoolDO removes key from active pool
          │
          └── If new key submitted within 30 minutes:
               ├── GCP probe confirms same project (hash matches ROTATING record)
               ├── New key inherits vesting tier from previous key
               └── project_hash_registry state → 'ACTIVE'
          
          If no new key submitted after 30 minutes:
               └── project_hash_registry state → 'TOMBSTONED', expires_at = NOW + 14 days
```

---

### 3.5 Flow E: Pool Mode Toggle (Community ↔ Private)

```
[DASHBOARD: MY KEYS TAB]
     │
     └── User clicks [Community ▾] toggle on a key
          │
          ├── Shows dropdown: [Keep Community] [Switch to Private]
          │
          └── [Switch to Private] →

[POOL TOGGLE CONFIRMATION MODAL]  ← NEW in v4.0
     │
     ├── Anti-Midnight Migration Freeze check:
     │    └── If current UTC time is between 23:30 and 00:30:
     │         → "Pool switching is frozen during midnight quota reset window
     │            (23:30–00:30 UTC). Please try again after 00:30 UTC."
     │
     ├── CU Settlement Gate:
     │    └── Display current community_debt and resolution:
     │         "Switching to Private Pool. Your current community debt (142 CU)
     │          will continue decaying at 20% per day. Your key will leave the
     │          community pool immediately."
     │
     ├── [Confirm Switch to Private]
     │    ├── Update api_keys.pool_type = 'PRIVATE'
     │    ├── TenantKeyPoolDO marks key as private
     │    ├── PoolCoordinatorDO removes key from global communal rotation
     │    └── Dashboard: Pool badge updates to [Private]
     │
     └── [Switch to Community] (reverse):
          ├── No settlement gate needed (joining is always allowed)
          ├── community_routing_status → 'OBSERVATION' (fresh 24h buffer)
          └── Dashboard: "Key entering 24-hour observation period before joining community pool"
```

---

### 3.6 Flow F: Quota Jail Warning & Recovery

```
[BACKGROUND: community_debt crosses 1.0× daily_contributed_CU]
     │
     └── TenantDO fires multiplier clamp to 1.0×

Next request from tenant:
     │
     ├── Router checks community_debt threshold
     └── HTTP 429 with special payload:
          {
            "error": "quota_jail",
            "message": "Community debt limit reached. Only your own keys are available.",
            "community_debt_cu": 1420,
            "daily_contributed_cu": 1380,
            "multiplier": "1.0x",
            "recovery": {
              "debt_decay_rate": "20% per day at 00:00 UTC",
              "estimated_recovery": "3 days"
            }
          }

[DASHBOARD: STANDING TAB]
     │
     └── Standing card shows:
          ┌────────────────────────────────┐
          │ ⚠️  QUOTA JAIL ACTIVE          │
          │ Community Debt: 1,420 CU       │
          │ Daily Contributed: 1,380 CU    │
          │ Multiplier: 1.0x (locked)      │
          │ Recovery: ~3 days natural decay│
          │ Tip: Serve more community      │
          │      requests to pay down debt │
          └────────────────────────────────┘
```

---

### 3.7 Flow G: Key Goes Unhealthy (Upstream 401 / Revocation)

```
[HOT PATH: Upstream provider returns HTTP 401]
     │
     ├── Worker catches 401 from upstream
     ├── TenantKeyPoolDO marks key status = 'QUARANTINED'
     ├── Circuit breaker opened for this keyId
     │
     ├── Analytics Engine event: key_health_event { status: 'revoked', keyId, tenantId }
     │
     └── Background task (ctx.waitUntil):
          └── Dispatch N=50 event-driven re-probe (or next request triggers it)

[DASHBOARD: REAL-TIME NOTIFICATION]  ← NEW in v4.0
     │
     └── Toast notification: "⚠️ Key [Flash Dev Key] (Gemini) went unhealthy.
                               Check your Google AI Studio and re-submit if needed."

[DASHBOARD: MY KEYS TAB]
     │
     └── Key row:
          Provider: Gemini | Label: Flash Dev Key | Status: [⚠️ Unhealthy] |
          Mode: Community | 24h Quota: — | Actions: [Rotate] [Delete]
```

---

### 3.8 Flow H: Abuse Report / Takedown

```
PUBLIC PAGE: /report  (accessible without login)
     │
     ├── Short explanation: "If you found a leaked API key being used in Key Collective,
     │    you can submit it here to have it immediately deactivated."
     ├── Turnstile widget (visible)
     ├── Input: [Paste the leaked API key here]
     └── [Submit Report]

[POST /api/abuse/report-key]
     │
     ├── Turnstile token verified
     ├── Rate limit: 5 requests per IP per hour → HTTP 429 if exceeded
     ├── Artificial delay starts (target: 200ms total response time)
     ├── SHA-256(submitted_key) computed
     ├── D1 lookup: Does hash match any key in api_keys?
     │    ├── MATCH → key.status = 'REVOKED', key.community_routing_status = 'REVOKED'
     │    │            project_hash_registry state → 'TOMBSTONED'
     │    │            TenantKeyPoolDO removes key from rotation
     │    │            (Zero strike on submitter — anti-griefing)
     │    └── NO MATCH → No action taken
     ├── Pad response to exactly 200ms (uniform delay)
     └── HTTP 200 { "message": "Report received. Thank you for keeping the commons safe." }
          (Same response regardless of match — no confirmation of existence)
```

---

### 3.9 Flow I: Passive Contributor Background Health Check

```
[DAILY ALARM: TenantKeyPoolDO.setAlarm() at 00:00 UTC]
     │
     ├── Query all keys owned by this tenant
     ├── If tenant made < 50 personal requests yesterday:
     │    (Passive contributor — no natural health signal)
     │
     └── For each community-mode key:
          ├── Dispatch 1-token health probe to provider
          ├── HTTP 200 → key remains HEALTHY, dispatched_today += 1
          └── HTTP 401 → key moves to QUARANTINED, triggers notification flow (3.7)
```

---

## 4. Information Architecture & UI Screen Specification

### 4.1 Console SPA — Top-Level Navigation

```
keycollective.dev / console.*
┌─────────────────────────────────────────────────────────────┐
│  🔑 Key Collective  [Dashboard] [Keys] [Pool] [Analytics]   │
│                                [⭐ Trusted] [3.2x] [Akshit▾]│
└─────────────────────────────────────────────────────────────┘
```

**Top-level tabs:**
| Tab | Purpose |
|:---|:---|
| **Dashboard** | Personal standing: multiplier, debt, tier, usage summary |
| **Keys** | Manage contributed keys (add, rotate, delete, toggle pool mode) |
| **Pool** | Pool intelligence: community pool telemetry, provider pools |
| **Analytics** | Personal usage graphs, cost ledger, request history |

---

### 4.2 Tab: Dashboard

**Sub-sections (no sub-tabs — single scrollable page):**

```
┌────────────────────────────────────────────────────────────────────────────┐
│  YOUR STANDING                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────┐   │
│  │ Multiplier       │  │ Community Debt   │  │ Trusted Contributor   │   │
│  │    3.2×          │  │    0 CU          │  │   ⭐ ACTIVE           │   │
│  │ (Max: 5.0×)      │  │  Pristine        │  │ 7-day streak          │   │
│  └──────────────────┘  └──────────────────┘  └───────────────────────┘   │
│                                                                            │
│  TODAY'S ACTIVITY                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Personal Requests: 420 ─────────────────────── Burst Used: 980    │   │
│  │ Keys Serving Community: 1,840 requests served for others today     │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  QUICK ACCESS                                                              │
│  [Copy API Endpoint]  [View API Key]  [+ Add Provider Key]                │
│                                                                            │
│  YOUR ACCESS CREDENTIALS                                                   │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Proxy Endpoint:  https://api.keycollective.dev/v1                  │   │
│  │ Your API Key:    kc_live_•••••••••••••••••••••  [Show] [Rotate]   │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
```

**Standing card states:**

| State | Multiplier Display | Debt Display | Color |
|:---|:---|:---|:---|
| Pristine (debt ≤ 0) | 3.2× | "0 CU — Pristine" | Green |
| Soft Warning (debt > 0.5×) | 1.5× (capped) | "1,200 CU — Soft Warning" | Yellow |
| Quota Jail (debt > 1.0×) | 1.0× (locked) | "2,100 CU — Quota Jail ⚠️" | Red |
| Trusted (7-day streak) | 3.2× (⭐ badge) | "0 CU — Pristine" | Green + Gold |

---

### 4.3 Tab: Keys

**Sub-tabs:**
- **My Keys** — All contributed provider keys
- **Private Pool** — Keys currently in Private mode (dedicated to self)
- **Observation** — Keys in the 24h quarantine buffer (newly added)

```
MY KEYS SUB-TAB:
┌────────────────────────────────────────────────────────────────────────────┐
│  MY CONTRIBUTED KEYS                             [+ Add New Provider Key]  │
│  Filter: [All ▾]  [Provider ▾]  [Status ▾]                                │
├──────────┬──────────────────┬───────────────┬────────────┬──────────┬──────┤
│ Provider │ Label            │ Prefix/Suffix  │ Status     │ Mode     │ Actions│
├──────────┼──────────────────┼───────────────┼────────────┼──────────┼──────┤
│ Gemini   │ Flash Dev Key    │ AIza...3x9Z   │ ● Healthy  │[Community]│[⋯]  │
│ Groq     │ Llama-70B Fast   │ gsk_...89a1   │ ● Healthy  │[Community]│[⋯]  │
│ Gemini   │ Private Test Key │ AIza...99kk   │ ● Healthy  │[Private] │[⋯]  │
│ Gemini   │ New Key          │ AIza...ab12   │ ⏳ 23h left │[Observing]│[⋯] │
│ SambaNova│ Old Key          │ snova...9912  │ ⚠ Unhealthy│[Community]│[⋯]  │
└──────────┴──────────────────┴───────────────┴────────────┴──────────┴──────┘

[⋯] expands to: [Rotate] [Switch Pool Mode] [Delete]
```

**Key details expanded (click row):**
```
┌────────────────────────────────────────────────────────────────────────────┐
│  Gemini: Flash Dev Key                                           [Collapse] │
│                                                                            │
│  Pool Mode:     Community Pool (earning 3.2× multiplier)                  │
│  Status:        Healthy                                                    │
│  Observation:   Completed (joined community pool 3 days ago)               │
│  Vesting Tier:  Tier 3 — Full Dynamic Multiplier (12h+ active)            │
│  24h Dispatch:  1,180 / 1,500 (79% used today)                            │
│  Communal:      842 of 1,180 requests served community members             │
│  Project:       [Protected — encrypted at rest]                            │
│  Added:         Sep 11, 2026 · 14:32 IST                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

### 4.4 Tab: Pool

**Sub-tabs:**
- **Community Pool** — Global commons health
- **Provider Pools** — Per-provider breakdown
- **My Contribution** — Personal share of community supply

```
COMMUNITY POOL SUB-TAB:
┌────────────────────────────────────────────────────────────────────────────┐
│  GLOBAL COMMONS HEALTH                          Last updated: just now     │
│                                                                            │
│  Total Active Keys:    ████████████████████░░░░  322 keys (all providers) │
│  Pool Utilization:     ██████████████░░░░░░░░░░  62% (Healthy)            │
│  Keys in Observation:  14 keys (joining community pool in < 24h)          │
│  Keys Quarantined:      3 keys (upstream unhealthy, excluded from routing) │
└────────────────────────────────────────────────────────────────────────────┘

PROVIDER POOLS SUB-TAB:
┌──────────────────┬────────────┬─────────────┬───────────────┬────────────┐
│ Provider         │ Active Keys│ U_pool      │ W_provider    │ P90 Latency│
├──────────────────┼────────────┼─────────────┼───────────────┼────────────┤
│ 🟢 Google Gemini │ 184        │ 62% Healthy │ 1.00× Optimal │ 420 ms     │
│ 🟢 GroqCloud     │  96        │ 71% Healthy │ 1.00× Optimal │ 280 ms     │
│ 🟡 SambaNova     │  42        │ 48% Low Load│ 0.92× Degraded│ 1,620 ms   │
└──────────────────┴────────────┴─────────────┴───────────────┴────────────┘

MY CONTRIBUTION SUB-TAB:
┌────────────────────────────────────────────────────────────────────────────┐
│  YOUR CONTRIBUTION TO THE COMMONS                                          │
│                                                                            │
│  Pool Share:         ~1.8% of community supply (2 community keys)          │
│  Community Served:   1,840 requests helped other members today             │
│  CU Contributed:     2,210 CU donated to pool today                       │
│  CU Consumed:        980 CU drawn from pool today                         │
│  Net Balance:        +1,230 CU credit (reducing community_debt)           │
│  Pool Standing:      Trusted Contributor — top 15% by contribution volume  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

### 4.5 Tab: Analytics

**Sub-tabs:**
- **Usage** — Personal requests over time (by model, provider)
- **Cost Ledger** — Token usage and microdollar cost per request
- **Multiplier History** — Historical multiplier over time

```
USAGE SUB-TAB:
┌────────────────────────────────────────────────────────────────────────────┐
│  MY USAGE: Last 7 days               [7d ▾]  [All Providers ▾]            │
│                                                                            │
│  Requests/day:                                                             │
│  Mon ████████████████████ 1,420 (420 own + 1,000 burst)                   │
│  Tue █████ 320                                                             │
│  Wed ████████████ 840                                                      │
│  Thu ██ 120                                                                │
│                                                                            │
│  Top Models Used:          Requests   Avg Tokens   Success Rate            │
│  gemini-2.5-flash            2,840      420 tok/req  99.8%                 │
│  llama-3.3-70b (Groq)         960      380 tok/req  99.6%                 │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Legal Consent & Compliance Layer

### 5.1 Consent Checkboxes — Complete Specification

**Screen 1 — Account Registration (3 checkboxes, all mandatory):**

| # | Checkbox Text | Legal Purpose |
|:--|:---|:---|
| C1 | *"I agree to the Key Collective Terms of Service and Contributor Agreement. I acknowledge that Key Collective is a non-commercial, open-source platform operating under Section 79 of the Indian Information Technology Act, 2000."* | Safe harbor, intermediary liability |
| C2 | *"I understand that requests I make through Key Collective are processed by third-party providers (Google, Groq, SambaNova, etc.) and may be logged in their developer dashboards. I will not route proprietary, confidential, or personally identifiable data through this service."* | Vector 13 — Prompt eavesdropping disclosure |
| C3 | *"I am individually responsible for ensuring my use of Key Collective complies with all applicable local and international export regulations and provider terms of service."* | Vector 16 — Export sanctions, provider TOS |

**Screen 2 — Key Submission (2 checkboxes, both mandatory):**

| # | Checkbox Text | Legal Purpose |
|:--|:---|:---|
| K1 | *"I certify that this API key belongs to a Google Cloud project with no credit card or billing account attached. I understand Key Collective is a free-tier-only service and disclaims liability for any provider billing charges incurred through keys submitted with billing enabled."* | Vector 10 — Paid-tier trap liability |
| K2 | *"I am the authorized creator of this API key and have the legal right to contribute its quota to Key Collective. I understand that submitting a key I do not own is a violation of these Terms and may expose me to legal liability."* | Vector 05 — Stolen key liability |

**Shown alongside K1:**
> 📘 [How to verify billing is disabled in Google AI Studio →] *(links to help doc)*

---

### 5.2 Terms of Service — Key Clauses (UI Presentation Mapping)

| TOS Clause | Where Displayed | Format |
|:---|:---|:---|
| Non-commercial collective declaration | Registration screen header | Subtitle text |
| Section 79 IT Act intermediary safe harbor | C1 checkbox | Embedded link to full TOS |
| No confidentiality guarantees | C2 checkbox | Bold inline warning |
| Free-tier only declaration | K1 checkbox | Bold + help link |
| Export control individual responsibility | C3 checkbox | Plain text |
| Takedown contact / abuse email | Footer | Static link |
| Canonical domain anti-phishing notice | Footer of every page | Small print |

### 5.3 Runtime Gating & Enforcement Architecture

1. **Registration Gate (`/auth/callback`):**
   - Account creation and JWT issuance are hard-blocked unless all three checkboxes (C1, C2, C3) are explicitly asserted by the user.
   - Missing or unchecked attestations abort the session and prevent account record insertion into D1 `users`.

2. **Key Submission Gate (`POST /api/keys`):**
   - The key creation handler (`src/worker/router/dashboard/keys/post_key.ts`) asserts `body.k1 === true && body.k2 === true`.
   - If either checkbox is false or missing, the API immediately throws a `RouterError("K1 and K2 attestations are required", { statusCode: 400 })`.
   - Cloudflare Turnstile verification (`x-turnstile-token`) is evaluated before processing the payload.
   - Community pool submission requirement: Only GitHub authenticated accounts (`usr_gh_*` or `admin`) are permitted to submit keys to `COMMUNITY` mode (`HTTP 403 Forbidden` for unverified or guest accounts).

### 5.4 Audit Log Storage & D1 Schema (`consent_attestations`)

All legal attestations are immutably logged into Cloudflare D1 to maintain a verifiable compliance trail for statutory safe harbor:

```sql
CREATE TABLE IF NOT EXISTS consent_attestations (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  event_type   TEXT NOT NULL CHECK (event_type IN ('REGISTRATION', 'KEY_SUBMISSION')),
  checkbox_id  TEXT NOT NULL CHECK (checkbox_id IN ('C1', 'C2', 'C3', 'K1', 'K2')),
  attested_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address   TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_consent_tenant ON consent_attestations(tenant_id, event_type);
```

**TypeScript Contract (`src/contracts/v4_types.ts`):**
```typescript
export const ConsentAttestationSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().min(1),
  consent_type: z.enum(["C1", "C2", "C3", "K1", "K2"]),
  consent_version: z.string().min(1),
  attested_at: z.number().int().positive(),
});
export type ConsentAttestation = z.infer<typeof ConsentAttestationSchema>;
```

---

## 6. Functional Requirements

> Every FR is cross-referenced to the Threat Vector it mitigates.

### FR-01: Dual-Pool Key Assignment
**Threat Vector:** V17 (Migration Arbitrage)  
Keys must carry an explicit `pool_type ∈ {PRIVATE, COMMUNITY}`. PRIVATE keys serve only the owning contributor's requests. COMMUNITY keys are eligible for communal routing after their 24h observation window completes.

### FR-02: Self-Key Priority Cascade Routing
**Threat Vector:** V01, V03, V06, V17  
Before drawing from the global communal pool, the router MUST attempt to route through the requesting tenant's own healthy keys (regardless of pool_type). Communal routing is only engaged when all own keys are at burst capacity or RPD exhausted.

### FR-03: Continuous Community Debt Engine
**Threat Vector:** V06, V08, V17  
`community_debt` (in CU-equivalent units, int64 microdollar precision) accumulates in real-time on every communal request and decrements when the contributor's own key serves another user. Multiplier clamping is continuous (not just at migration checkpoints):
- debt > 0.5× daily_contributed_CU → multiplier ceiling capped at 1.5×
- debt > 1.0× daily_contributed_CU → multiplier forced to 1.0×, communal access blocked (quota jail)

### FR-04: Global Pool Coordinator DO
**Threat Vector:** V06, V07, V12  
A singleton Durable Object (`POOL_COORDINATOR`) maintains aggregate pool state: per-provider active key count, U_pool, W_provider, rolling 5-minute per-tenant request volumes. This is the only entity with cross-tenant visibility.

### FR-05: Midnight Reset Jitter & Leaky-Bucket Queue
**Threat Vector:** V12  
Exhausted keys are reactivated at 00:00 UTC with independent jitter: each key receives t_reactivate = 00:00:00 UTC + Uniform(0, 300s). Requests arriving 23:55–00:05 UTC are queued up to 5 seconds before returning 429.

### FR-06: Forced-Error GCP Ingress Probe
**Threat Vector:** V04  
At registration, a deliberately invalid model name is submitted to force Google's API to return HTTP 400 with `google.rpc.ErrorInfo` containing the contributor's GCP project number. This is the only reliable method to extract the project number from a free-tier key.

### FR-07: Silent 24-Hour Community Routing Observation Period
**Threat Vector:** V05, V11  
All newly submitted keys (regardless of pool_type selection) are placed in `community_routing_status = OBSERVATION` for 24 hours. During this period, the key processes only the contributing tenant's own requests. Communal traffic is strictly excluded.

### FR-08: Three-State Project Hash Lifecycle (14-Day Tombstone)
**Threat Vector:** V03, V04  
`project_hash_registry` enforces state machine: ACTIVE → ROTATING (30 min grace on voluntary deletion) → TOMBSTONED (14 days, hard re-registration block). Upstream revocation transitions directly to TOMBSTONED.

### FR-09: Per-Tenant HKDF Key Derivation
**Threat Vector:** V18  
Replace global static AES master key with per-tenant subkeys derived via Web Crypto HKDF: K_tenant = HKDF(K_master, tenantId, "aes-256-gcm-key"). Compromise of one tenant's derived key does not expose any other tenant's key material.

### FR-10: Downstream Error Normalizer & Provider Header Sanitizer
**Threat Vector:** V09, V14  
All upstream error bodies are intercepted and rewritten to remove GCP project numbers, billing strings, cloud trace IDs, and provider-specific metadata. Inject `X-KeyCollective-Request-Id`. All upstream response headers from `x-goog-*`, `x-groq-*`, `server`, `alt-svc`, `x-cloud-trace-context`, `x-envoy-*` must be stripped.

### FR-11: Plaintext Takedown Endpoint with Timing Shield
**Threat Vector:** V05, V19  
`POST /api/abuse/report-key` accepts a plaintext leaked key and revokes it if found. Mandatory: (a) Turnstile verification, (b) 5 req/IP/hr rate limit, (c) constant 200ms response time regardless of DB hit/miss, (d) identical HTTP 200 response body on match or no-match (no existence confirmation).

### FR-12: Cold-Start Contributor Share Cap (40% Hard Ceiling)
**Threat Vector:** V03, V21  
When total active contributors N ≤ 5, single contributor maximum pool share is capped at 40% (hard step-function). For N > 5: max(20%, 2/N) formula applies.

### FR-13: Passive Contributor 24-Hour Canary Alarm
**Threat Vector:** V01  
`TenantKeyPoolDO` schedules a daily `setAlarm()` at 00:00 UTC. If personal request count < 50, fire 1-token health probe per community-mode key. Cost: 1 of 1,500 free RPD = 0.067% quota usage.

### FR-14: Contributor Console SPA (Four Tabs + Sub-tabs)
**Threat Vector:** V06, V07, V14, V17  
Full-featured browser console at `console.*` subdomain:
- **Dashboard** tab: Standing card, multiplier, debt, today's activity, API credentials
- **Keys** tab (sub-tabs: My Keys / Private Pool / Observation)
- **Pool** tab (sub-tabs: Community Pool / Provider Pools / My Contribution)
- **Analytics** tab (sub-tabs: Usage / Cost Ledger / Multiplier History)

### FR-15: Structured Clickwrap Legal Consent Flow
**Threat Vector:** V05, V10, V13, V16, V20  
Three mandatory checkboxes at registration (C1–C3). Two mandatory checkboxes at each key submission (K1–K2). No checkbox = submit button stays disabled. Attestation timestamps stored in D1 against tenant record.

### FR-16: Hero/Parasite Key Classification Engine
**Threat Vector:** V02  
When a key returns upstream 429 RPD exhaustion:
- If `dispatched_communal ≥ 80%` of `dispatched_today`: HERO (communally exhausted) → contributor retains full CU credit, pool reciprocates.
- If `dispatched_communal < 10%` of `dispatched_today`: PARASITE (externally drained) → CU suspended until midnight UTC, warning issued.

### FR-17: Progressive Vesting Ramp
**Threat Vector:** V03  
Multiplier schedule on contributor's own traffic (community routing eligibility is separately governed by 24h delay):
- 0–2 hours: 1.5× baseline
- 2–12 hours: 2.5×
- 12+ hours: Full dynamic (up to 4.5×, or 5.0× for Trusted Contributors)

### FR-18: Anti-Cycling 60-Minute Observation Tier (Re-registration Guard)
**Threat Vector:** V01  
If a contributor re-registers a key from a project that had an upstream revocation within the prior 24 hours, the new key enters a 60-minute observation tier: own requests served at 1.0×, zero communal bonus.

### FR-19: Eye-for-an-Eye Provider Firewall
**Threat Vector:** V07  
Contributor may only draw from communal pool for providers they have contributed at least one key to. A user contributing only a Gemini key cannot draw from the Groq communal pool.

### FR-20: Anomalous Spiker Emergency Brake
**Threat Vector:** V06  
Pool Coordinator monitors per-tenant rolling 5-minute request share. If any single tenant exceeds 35% of total pool traffic in the window, the coordinator fires an emergency brake against that tenant's DO, clamping their throughput to their fair-share ceiling.

### FR-21: Debt Decay & Trusted Contributor Accelerator
**Threat Vector:** V17  
Daily at 00:00 UTC: community_debt ← floor(community_debt × 0.80) for all users. If debt ≤ 0 for 7 consecutive days: TRUSTED_CONTRIBUTOR flag set, multiplier ceiling raised to 5.0×, decay rate accelerates to 30%/day. Trust flag cleared the first day debt goes positive.

### FR-22: Anti-Midnight Migration Freeze
**Threat Vector:** V01, V12, V17  
Pool mode toggle (Community ↔ Private) is blocked from 23:30 to 00:30 UTC to prevent gaming the midnight quota reset synchronization window.

### FR-23: Jittered Key Reactivation (Thundering Herd Prevention)
**Threat Vector:** V12  
When exhausted keys reach midnight UTC reset, the Pool Coordinator assigns each key an independent random reactivation offset in the range [0, 300] seconds, distributing load across the 5-minute window.

### FR-24: Safety Filter & Extra-Body Transparent Passthrough
**Vector:** N/A (Developer DX requirement)  
Upstream provider-specific parameters (`safetySettings`, `generationConfig`, `extra_body`, `extra_headers`) must be transparently forwarded to the provider without alteration. Key Collective does not impose its own content guardrails.

### FR-25: Demo Mode (No-Account API Access)
**Vector:** V08 (Commercial Operator Detection)  
Unauthenticated users may access a shared demo pool with strict IP-level caps: 3 RPM/IP, 25 RPD/IP. No contributor keys involved. Demo mode explicitly excluded from multiplier calculations.

### FR-26: Scale-Aware Dynamic Multiplier Formula
**Threat Vector:** V06, V21  
Multiplier M(t) is a continuous function of pool utilization U_pool:
- U_pool < 60%: M = 4.5× (maximum, incentivize usage)
- 60% ≤ U_pool < 80%: M = 3.0×
- 80% ≤ U_pool < 95%: M = 1.5× (conservation mode)
- U_pool ≥ 95%: M = 1.0× (emergency ration mode)
M is further capped by community_debt state and vesting tier.

---

## 7. Infrastructure Requirements

### IR-01: D1 Migration `0005_commons_pooling.sql`
Extends `api_keys` with columns for pool mode and communal routing: `pool_type` ('PRIVATE' | 'COMMUNITY'), `community_routing_status` ('OBSERVATION' | 'ACTIVE' | 'QUARANTINED' | 'REVOKED'), `observation_until`, `dispatched_today`, `dispatched_communal`, `vesting_tier`, and `provider_project_hash`. See Section 8.

### IR-02: D1 Migration `0006_project_hash_registry.sql`
Creates `project_hash_registry` table for three-state GCP project lifecycle enforcement (`ACTIVE`, `ROTATING`, `TOMBSTONED`). See Section 8.

### IR-03: D1 Migration `0007_contributor_standing.sql`
Creates `contributor_standing` table for persistent `community_debt_micro_cu` (int64), `daily_contributed_cu`, `consecutive_debt_free_days`, `trusted_contributor` flag, `multiplier_ceiling`, and `current_multiplier`. Also creates immutable append-only `consent_attestations` table for C1–C3 and K1–K2 logs.

### IR-04: D1 Migration `0009_hkdf_flag.sql`
Adds `hkdf_migrated` tracking flag and index to `api_keys` table to guarantee zero double-encryption during tenant subkey cutover.

### IR-05: Durable Object: `PoolCoordinatorDO`
Singleton global DO (`POOL_COORDINATOR`) binding. File: `src/pool/coordinator_do.ts`. Maintains: per-provider active/quarantined key counts, latency tracking, quality weight (`wProvider`), per-tenant rolling 5-minute request volumes, 60s emergency spiker brake (`/coordinator/brake-status/:tenantId`), and background alarm-based volume eviction.

### IR-06: `TenantKeyPoolDO` — Stateful Per-Tenant DO
`KeyPoolDO` (`src/durable_objects/key_pool/key_pool_do.ts`). Manages: per-tenant key health, circuit breaker state, RPM rate limiting, key priority selection (prioritizing own keys with +10000 boost), communal dispatch counters (`dispatched_today`, `dispatched_communal`), hero/parasite classification, and 24h midnight reset alarm.

### IR-07: `TenantQuotaDO` — Community Debt Engine
`TenantQuotaDO` (`src/quota/tenant/tenant_do.ts`, `src/quota/tenant/debt.ts`). Manages: sliding-window RPM/RPD, int64 fixed-point microdollar expenditure, `community_debt_micro_cu` accumulation/settlement, continuous multiplier ceiling clamping (1.0× in Hard Jail, 1.5× in Soft Warning, 4.5× Pristine, 5.0× Trusted), and 00:00 UTC debt decay (20%/day standard, 30%/day trusted).

### IR-08: Midnight Reactivation Jitter & Leaky-Bucket Queue
Scheduled alarm in `PoolCoordinatorDO` and `KeyPoolDO` at 00:00 UTC assigns Uniform(0, 300s) jitter offsets to distributed keys. Requests during midnight transition are queued up to 5 seconds before returning 429.

### IR-09: Forced-Error GCP Ingress Probe Client
Implemented in `src/ingress/probe.ts` (`forceErrorGcpProbe`). Deliberately queries `https://generativelanguage.googleapis.com/v1beta/models/invalid-model?key=...` forcing HTTP 400 with `google.rpc.ErrorInfo`. Extracts the consumer project number (`projects/{project_number}`) and hashes with SHA-256 to enforce project uniqueness in `project_hash_registry`. Gracefully returns null for non-Google providers.

### IR-10: Cloudflare Turnstile Integration
Enforced at account registration (`src/auth/sybil/turnstile.ts`), key submission (`src/worker/router/dashboard/keys/post_key.ts`), and abuse takedown (`src/worker/router/dashboard/abuse_routes.ts`). Validates Turnstile tokens with Cloudflare siteverify endpoint.

### IR-11: HKDF Per-Tenant Encryption Migration
Implemented in `src/crypto/encryption/aes.ts` and `src/crypto/encryption/index.ts` via Web Crypto API. Derives per-tenant AES-256-GCM subkeys using HKDF (`deriveTenantKey(masterKey, tenantId)`). Multi-tier fallback in `src/worker/router/core/key_resolver.ts` ensures backward compatibility with legacy global keys during rolling migration.

### IR-12: Downstream Error Normalizer Middleware
Implemented in `src/worker/error_normalizer.ts` (`normalizeUpstreamResponse`, `sanitizeResponseHeaders`, `sanitizeErrorBody`) and wired into `src/proxy/upstream/client.ts`. Strips all upstream provider headers (`x-goog-*`, `x-groq-*`, `server`, `alt-svc`, `x-cloud-trace-context`, `x-envoy-*`), sanitizes error bodies of GCP project IDs and billing strings, and injects `x-kc-request-id`, `x-kc-model-used`, and `x-kc-provider`.

### IR-13: Abuse Takedown Endpoint
Route handler `POST /api/abuse/report-key` in `src/worker/router/dashboard/abuse_routes.ts`. Enforces Turnstile token verification, artificial delay padding to uniform 200ms (constant-time response shield against key existence discovery), SHA-256 hash lookup, key status revocation (`REVOKED`), and project hash tombstoning.

### IR-14: DO Alarm Handler for Passive Canary
Daily `alarm()` handler in `KeyPoolDO` at 00:00 UTC. Evaluates dispatch ratios: keys with `dispatched_communal / total >= 0.8` classified HERO; keys with ratio `< 0.1` classified PARASITE. Emits telemetry events and resets daily counters.

### IR-15: Console SPA Frontend
High-performance Svelte 5 + TailwindCSS SPA served from `ui/src/` via Cloudflare Workers Static Assets (`wrangler.jsonc: assets`). Key components:
- `PoolCommonsTab.svelte` — community pool telemetry, provider breakdown, debt/credit gauges
- `AddKeyModal.svelte` — key submission flow with C1–C3/K1–K2 attestation checkboxes & Turnstile
- `DebtLedgerWidget.svelte` — visual debt ledger with multiplier meter
- `TelemetryCharts.svelte` — non-blocking ring-buffered stream visualization
- `SurveillanceTable.svelte` — admin tenant surveillance panel

### IR-16: Real-Time Key Health Notifications
Endpoint `GET /api/notifications?since={timestamp}` in `src/worker/pool_routes.ts`. Short-polling stream returning toast alerts when keys experience status transitions to invalid or exhausted.

### IR-17: Provider-Level Pool Telemetry Aggregation
Live aggregation in `src/worker/pool_routes.ts` (`handlePoolTelemetry`). Integrates D1 aggregate stats with live `PoolCoordinatorDO` quality weights (`wProvider`) and 24-hour P90 latency metrics from `cost_ledger`.

### IR-18: Consent Attestation Logging
D1 table `consent_attestations` stores immutable records of every C1–C3 and K1–K2 attestation with timestamp, IP address, and user agent. Append-only enforcement.

### IR-19: Analytics Engine Non-Blocking Telemetry Extension
Integrated with Cloudflare Workers Analytics Engine (`env.TELEMETRY`). Emits `key_usage`, `upstream_status_code`, `key_classification`, and routing events via `ctx.waitUntil()` without blocking the hot path.

### IR-20: OpenAPI 3.1 Spec Documentation
`src/worker/openapi_spec.ts` documents all v4.0 routes, schemas, headers, and error models.

---

## 8. D1 Database Schema — Migration Specification

### Full Migration History

| Migration File | Description | Invariants Enforced |
|:---|:---|:---|
| `0001_initial_schema.sql` | Core schema (`users`, `auth_tokens`, `api_keys`, `model_registry`, `cost_ledger`, `daily_spend_rollup`) | AES-256-GCM nonces, fixed-point microdollars |
| `0002_v3_multi_project.sql` | Multi-project workspace support (`projects`, project-scoped tokens) | Per-tenant foreign key scoping |
| `0003_v3_5_governance.sql` | User governance tiers (`builder`, `max`, `ultra`, `admin`) | Quota sub-caps, RBAC |
| `0004_v3_5_quarantine.sql` | Anti-Sybil quarantine flags and surveillance indexing | Fast edge lookup |
| `0005_commons_pooling.sql` | Commons pooling fields on `api_keys` | Dual-pool separation, 24h observation |
| `0006_project_hash_registry.sql` | 3-state GCP project hash registry | Anti-Sybil single project contribution |
| `0007_contributor_standing.sql` | Community debt ledger and immutable consent log | Fixed-point micro-CU, append-only consent |
| `0008_abuse_ratelimit_cleanup.sql` | Deprecates standalone rate limits table | Consolidated in DO memory |
| `0009_hkdf_flag.sql` | Adds `hkdf_migrated` column to `api_keys` | Zero double-encryption during subkey cutover |
| `0010_purge_all_keys.sql` | Test purge utility for clean-slate testing | Preserves users, tokens, and ledger |

### Migration 0005: Commons Pooling Extensions (`0005_commons_pooling.sql`)

```sql
ALTER TABLE api_keys ADD COLUMN pool_type TEXT DEFAULT 'COMMUNITY' CHECK (pool_type IN ('PRIVATE', 'COMMUNITY'));
ALTER TABLE api_keys ADD COLUMN community_routing_status TEXT DEFAULT 'OBSERVATION' CHECK (community_routing_status IN ('OBSERVATION', 'ACTIVE', 'QUARANTINED', 'REVOKED'));
ALTER TABLE api_keys ADD COLUMN observation_until TIMESTAMP;
ALTER TABLE api_keys ADD COLUMN dispatched_today INTEGER DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN dispatched_communal INTEGER DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN vesting_tier INTEGER DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN provider_project_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_api_keys_pool_status ON api_keys(pool_type, community_routing_status);
CREATE INDEX IF NOT EXISTS idx_api_keys_observation ON api_keys(observation_until);
```

### Migration 0006: Project Hash Registry (`0006_project_hash_registry.sql`)

```sql
CREATE TABLE IF NOT EXISTS project_hash_registry (
    project_hash TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'ROTATING', 'TOMBSTONED')),
    rotating_until TIMESTAMP,
    tombstone_until TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_hash_tenant ON project_hash_registry(tenant_id);
```

### Migration 0007: Contributor Standing & Consent (`0007_contributor_standing.sql`)

```sql
CREATE TABLE IF NOT EXISTS contributor_standing (
    tenant_id TEXT PRIMARY KEY,
    community_debt_micro_cu INTEGER NOT NULL DEFAULT 0,
    daily_contributed_cu INTEGER NOT NULL DEFAULT 0,
    consecutive_debt_free_days INTEGER NOT NULL DEFAULT 0,
    trusted_contributor BOOLEAN NOT NULL DEFAULT FALSE,
    multiplier_ceiling INTEGER NOT NULL DEFAULT 100,
    current_multiplier INTEGER NOT NULL DEFAULT 100,
    last_decay_at TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consent_attestations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    checkbox_id TEXT NOT NULL,
    attested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_consent_tenant ON consent_attestations(tenant_id);
```

### Migration 0009: HKDF Migration Tracking (`0009_hkdf_flag.sql`)

```sql
ALTER TABLE api_keys ADD COLUMN hkdf_migrated INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_api_keys_hkdf ON api_keys(hkdf_migrated);
```

---

## 9. Durable Object Architecture

### 9.1 Durable Object Roster (v4.0)

| DO Name | Binding | Scope | Status | v4.0 Capabilities |
|:---|:---|:---|:---:|:---|
| `KeyPoolDO` | `KEY_POOL` | Per-tenant (`idFromName(tenantId)`) | ✅ Active | Dual pool_type, dispatched_today/dispatched_communal counters, priority routing, hero/parasite classification, canary alarm |
| `TenantQuotaDO` | `TENANT_QUOTA` | Per-tenant (`idFromName(tenantId)`) | ✅ Active | Sliding-window RPM/RPD, int64 fixed-point microdollars, community_debt_micro_cu engine, continuous multiplier ceiling (1.0x-5.0x), 00:00 UTC decay |
| `PoolCoordinatorDO` | `POOL_COORDINATOR` | Global singleton (`idFromName("global")`) | ✅ Active | Aggregate provider health, quality weights (wProvider), rolling 5-min per-tenant volumes, 60s emergency spiker brake |
| `DemoDO` | `DEMO_POOL` | Ephemeral playground (`idFromName("global")`) | ✅ Active | Unauthenticated playground sandboxing: 3 RPM / IP, 25 RPD / IP, strict IP sliding window isolation |

### 9.2 PoolCoordinatorDO Implementation (`src/pool/coordinator_do.ts`)

```typescript
export class PoolCoordinatorDO implements DurableObject {
  // Rolling 5-minute request volume per tenant for anomaly detection
  private tenantVolumes: Map<string, { volume: number; timestamp: number }[]>;
  
  // Active emergency brakes with expiry timestamps
  private activeBrakes: Map<string, number>;
  
  // Aggregate provider health metrics and quality weights
  private providers: Map<string, {
    activeKeys: number;
    quarantineKeys: number;
    latencyMs: number;
    wProvider: number;
  }>;

  // Endpoints:
  // GET  /coordinator/health             -> returns all provider stats & wProvider
  // POST /coordinator/report-volume     -> records volume; if tenant > 35% of pool, applies 60s brake
  // POST /coordinator/update-provider   -> updates active/quarantine counts and recalculates wProvider
  // GET  /coordinator/brake-status/:id  -> returns { braked: boolean }
}
```

### 9.3 Cross-DO Communication Patterns

```
TenantKeyPoolDO ──async push──► PoolCoordinatorDO
  (every 10 requests: report rolling 5-min volume)

PoolCoordinatorDO ──RPC call──► TenantKeyPoolDO
  (emergency brake: set throughput clamp)

TenantKeyPoolDO ──RPC call──► TenantQuotaDO
  (update community_debt after communal routing decision)

Worker ──RPC call──► PoolCoordinatorDO
  (getNextCommunityKey: returns optimal community key for provider)
```

---

## 10. API Endpoint Specification

### 10.1 Proxy & Inference Gateway

| Method | Path | Auth | Description | Headers & Behavior |
|:---|:---|:---:|:---|:---|
| `POST` | `/v1/chat/completions` | Bearer (User/Project) | OpenAI-compatible chat completions proxy | Supports streaming SSE; context token estimation; emergency brake pre-check; self-key priority cascade; upstream error normalization; injects `x-kc-request-id`, `x-kc-model-used`, `x-kc-provider` |
| `GET` | `/v1/models` | Bearer | List available models in registry | Returns models filtered by tenant tier and capability registry |

> **Note (Decision D-15):** Google-native Gemini endpoints (`/v1beta/models/:model:generateContent` and `/v1beta/models/:model:streamGenerateContent`) have been dropped from scope to maintain a unified, OpenAI-compatible proxy interface (`/v1/*`). If native Gemini endpoints are reintroduced in future releases, they will be mounted under `/v1/gemini/...` on the canonical API host (`api.key-col.axe08.tech`) in accordance with D-01.


### 10.2 Contributed Key Management (`/api/keys`)

| Method | Path | Auth | Description | Invariants & Constraints |
|:---|:---|:---:|:---|:---|
| `GET` | `/api/keys` | Bearer (Tenant/Admin) | List tenant's keys (or community keys if unauthenticated) | Scoped by tenant; non-owners/non-admins have `tenant_id` redacted for privacy; returns `pool_type`, `community_routing_status`, `observation_until`, `dispatched_today`, `dispatched_communal`, `vesting_tier`, metrics |
| `POST` | `/api/keys` | Bearer + Turnstile | Register and encrypt new upstream provider key | Enforces mandatory `k1: true, k2: true` attestations; fires forced-error GCP probe (`src/ingress/probe.ts`); checks `project_hash_registry` for collisions; encrypts via HKDF per-tenant AES key; assigns 24h `OBSERVATION` window if `COMMUNITY` |
| `DELETE` | `/api/keys/:id` | Bearer (Owner/Admin) | Delete API key | Removes from D1 `api_keys` and evicts from `KeyPoolDO` memory |
| `POST` | `/api/keys/:id/rotate` | Bearer (Owner/Admin) | Rotate plaintext key material | Re-encrypts with fresh 12-byte nonce using tenant subkey; updates prefix/suffix; preserves key ID |
| `POST` | `/api/keys/:id/test` | Bearer (Owner/Admin) | Test live provider connectivity | Probes upstream provider API in real time, returns latency and health |
| `PATCH` | `/api/keys/:id/pool-mode` | Bearer (Owner/Admin) | Toggle `pool_type` between `PRIVATE` and `COMMUNITY` | Blocked during midnight freeze window (23:30–00:30 UTC); switches to `OBSERVATION` with fresh 24h buffer when entering community pool |

### 10.3 Commons Pool & Telemetry (`/api/pool`)

| Method | Path | Auth | Description | Output Data |
|:---|:---|:---:|:---|:---|
| `GET` | `/api/pool/telemetry` | Bearer (Tenant) | Global commons health metrics | `total_active_keys`, `keys_in_observation`, `keys_quarantined`, `pool_utilization_percent`, per-provider breakdown with `w_provider`, P90 latency, and `eye_for_eye_accessible` |
| `GET` | `/api/pool/standing` | Bearer (Tenant) | Contributor standing & multiplier | `multiplier` (1.0x-5.0x), `multiplier_ceiling`, `community_debt_cu`, `daily_contributed_cu`, `jail_status` ('PRISTINE', 'SOFT_WARNING', 'HARD_JAIL'), `trusted_contributor`, `consecutive_debt_free_days` |
| `GET` | `/api/pool/contribution` | Bearer (Tenant) | Personal contribution balance | `total_keys`, `community_active_keys`, `requests_served_for_community_today`, `personal_requests_today`, `cu_contributed_today`, `cu_consumed_today`, `net_cu_balance` |
| `GET` | `/api/notifications` | Bearer (Tenant) | Short-poll notification stream (`?since={timestamp}`) | Real-time key health transitions (e.g. key unhealthy or exhausted) |

### 10.4 Abuse Takedown & Safety (`/api/abuse`)

| Method | Path | Auth | Description | Security Mechanics |
|:---|:---|:---:|:---|:---|
| `POST` | `/api/abuse/report-key` | Turnstile Token | Public unauthenticated leaked key takedown | Requires Turnstile verification; artificial delay padding to uniform 200ms (constant-time response shield against key enumeration); revokes key in `api_keys`; marks `project_hash_registry` state as `TOMBSTONED` |

### 10.5 Authentication & Session Management

| Method | Path | Auth | Description | Behavior |
|:---|:---|:---:|:---|:---|
| `GET` | `/auth/github` | Public | Initiate GitHub OAuth 2.0 PKCE flow | Generates CSRF state & PKCE code challenge |
| `GET` | `/auth/callback` | Public | OAuth redirect handler | Verifies PKCE; runs 5-Layer Anti-Sybil assessment; records C1–C3 consent attestations; issues session JWT |
| `POST` | `/api/auth/demo` | Public | Create ephemeral demo playground session | Bounded to shared `DEMO_POOL` DO (3 RPM / IP, 25 RPD / IP) |
| `GET` | `/api/auth/me` | Bearer | Retrieve authenticated user profile | Scrubs internal tiers (`ultra`, `admin`), maps to public tiers (`probationary`, `builder`, `max`) |

### 10.6 Admin Surveillance & Emergency Operations

| Method | Path | Auth | Description | Capabilities |
|:---|:---|:---:|:---|:---|
| `GET` | `/admin/api/tenants` | Bearer (Admin) | Platform-wide tenant surveillance | Real-time RPM, RPD, spend in microdollars, active keys, quarantine state |
| `POST` | `/admin/api/tenants/:id/action` | Bearer (Admin) | Administrative mutation | Update tier, quarantine/unquarantine, reset quota |
| `POST` | `/admin/api/circuits/override` | Bearer (Admin) | Provider circuit breaker override | Trip or reset provider circuits platform-wide |
| `GET` | `/coordinator/health` | Internal / Admin | PoolCoordinatorDO health inspection | Raw provider counts, active brakes, and quality weights |

---

## 11. Non-Functional Requirements

### NFR-01: Performance — Hot Path Latency
- Edge auth validation (DO lookup + JWT verify): < 2ms P99
- Key selection (own keys): < 1ms P99
- Community key selection (PoolCoordinatorDO): < 5ms P99
- Error normalizer overhead: < 0.5ms P99
- SSE streaming passthrough: 0ms added latency

### NFR-02: Reliability — DO Eviction Durability
All hot-path counters (`dispatched_today`, `dispatched_communal`, `community_debt_micro_cu`, `multiplier_ceiling`) MUST be synced to `this.ctx.storage` on every update per GEMINI.md invariant. Silently losing these fields causes Hero/Parasite misclassification.

### NFR-03: Data Integrity — Fixed-Point Financials & Microdollar Invariants
- **Fixed-Point Precision:** All financial amounts, token cost computations, and communal capacity units (CU) are strictly stored and computed in `int64` / `bigint` microdollars (1 USD = 1,000,000 µ$). Zero IEEE 754 floating-point math is permitted in financial calculations (`MICRODOLLAR_MULTIPLIER = 1_000_000n`).
- **Conversion Safety:** String-split parsing (`dollarsToMicrodollars`) is enforced to eliminate float truncation artifacts. Number conversions (`microdollarsToDollars`) are restricted exclusively to UI display rendering.
- **Community Debt Precision:** `community_debt_micro_cu` and `daily_contributed_cu` operate on integer BigInt math (`src/quota/tenant/debt.ts`). Ratios are computed via scaled integers (e.g. `communityDebtMicroCu * 100n / dailyContributedCu`). Multipliers are represented internally as scaled integers (100 = 1.00×, 150 = 1.50×, 450 = 4.50×, 500 = 5.00×).

### NFR-04: Security — Zero Plaintext Invariant
No plaintext provider API key, GCP project number, or billing account identifier may appear in: D1 storage, console logs, telemetry events, error responses, or any client-visible surface.

### NFR-05: Quality Gate
All TypeScript code must pass `make gate` (tsc strict + tests) in < 10s with 0 type errors. Every new module requires test coverage.

### NFR-06: Cryptographic Rotation
Annual master secret rotation with full re-encryption migration. Runbook documented in `docs/ops/secret-rotation.md` before v4.0 ships.

### NFR-07: Non-Blocking Telemetry
All telemetry events emitted via `ctx.waitUntil()` to Workers Analytics Engine. Zero blocking D1 writes on the inference hot path.

---

## 12. Information Boundary

### What Users Can Always See

| Data | Location | Visibility |
|:---|:---|:---|
| Key label | Keys tab | Full |
| Provider name | Keys tab | Full |
| Key prefix/suffix mask | Keys tab | First 6 + last 4 chars only |
| 24h usage (N / limit) | Keys tab | Own keys only |
| Pool mode (Private/Community) | Keys tab | Own keys only |
| Community routing status | Keys tab | Own keys only |
| Own multiplier | Dashboard | Own only |
| Own community_debt | Dashboard | Own only |
| Own trusted status | Dashboard | Own only |
| Today's personal requests | Dashboard | Own only |
| Today's communal requests served | Dashboard | Own only |
| Aggregate provider pool health | Pool tab | All users (aggregate only) |
| U_pool per provider | Pool tab | All users (aggregate only) |
| W_provider per provider | Pool tab | All users (aggregate only) |
| Total healthy keys count per provider | Pool tab | All users (aggregate only) |

### What Users Can Never See

| Data | Reason |
|:---|:---|
| Full plaintext API key (after submission) | AES-256-GCM encrypted, never stored plaintext |
| GCP Project Number / hash | Deanonymization vector (V04) |
| Other contributors' key labels or identities | Multi-tenant isolation |
| Which specific key served their request | Reconnaissance surface (V09) |
| Raw upstream error payloads | Provider metadata leakage (V14) |
| Other tenants' multipliers or debt | Privacy |
| Internal routing state (keyId, circuit state) | Security |
| Admin tier of other users | Hidden tier (`ultra`, `admin`) |

---

## 13. Implementation Phasing

```
======================================================================================
PHASE 1 — STORAGE & CRYPTOGRAPHIC CORE (No behavioral change, pure infra)
======================================================================================
  1.1  D1 Migration 0002 (pool_type, community_routing_status columns on api_keys)
  1.2  D1 Migration 0003 (project_hash_registry table)
  1.3  D1 Migration 0004 (contributor_standing, consent_attestations tables)
  1.4  HKDF per-tenant key derivation refactor (src/crypto/encryption.ts)
  1.5  Existing key re-encryption migration script (ops/migrate_keys_hkdf.ts)
  1.6  Consent attestation logging at /auth/callback (C1, C2, C3)
  Dependencies: None. Safe to ship independently.

======================================================================================
PHASE 2 — ANTI-SYBIL & INGRESS HARDENING (Registration & Key Submission)
======================================================================================
  2.1  Forced-error GCP ingress probe client (src/ingress/probe_client.ts)
  2.2  project_hash_registry ACTIVE/ROTATING/TOMBSTONED state machine
  2.3  Key submission flow: pool_type selection, attestation checkboxes K1/K2
  2.4  Turnstile enforcement at POST /api/keys
  2.5  24-hour observation window enforcement (community_routing_status = OBSERVATION)
  Dependencies: Phase 1 complete.

======================================================================================
PHASE 3 — POOL COORDINATOR & ROUTING ENGINE (Core commons logic)
======================================================================================
  3.1  PoolCoordinatorDO implementation (pool state, provider health, W_provider)
  3.2  Self-key priority router pre-check (CascadeRouter refactor)
  3.3  Community debt engine in TenantQuotaDO (FR-03)
  3.4  Hero/Parasite classification in TenantKeyPoolDO (FR-16)
  3.5  Emergency spiker brake (FR-20): PoolCoordinatorDO → TenantKeyPoolDO RPC
  3.6  Progressive vesting ramp (FR-17): time-based multiplier unlock
  3.7  Scale-aware share cap + cold-start 40% ceiling (FR-12, FR-26)
  3.8  PATCH /api/keys/:id/pool-mode endpoint (FR-14, with migration freeze check)
  Dependencies: Phase 1 + Phase 2 complete.

======================================================================================
PHASE 4 — GATEWAY HARDENING & RELIABILITY
======================================================================================
  4.1  Downstream error normalizer middleware (src/worker/error_normalizer.ts)
  4.2  Full upstream provider header stripping (FR-10)
  4.3  Abuse takedown endpoint POST /api/abuse/report-key (FR-11)
  4.4  Midnight reset jitter + leaky-bucket queue (FR-05, FR-23)
  4.5  Passive contributor canary alarm (FR-13)
  4.6  Anti-midnight migration freeze enforcement (FR-22)
  4.7  Trusted contributor accelerator + debt decay (FR-21)
  Dependencies: Phase 3 complete.

======================================================================================
PHASE 5 — CONSOLE SPA & TELEMETRY DASHBOARD (User-facing UI)
======================================================================================
  5.1  Dashboard tab: Standing card, multiplier, debt, credentials
  5.2  Keys tab: My Keys / Private Pool / Observation sub-tabs, pool toggle modal
  5.3  Pool tab: Community Pool / Provider Pools / My Contribution sub-tabs
  5.4  Analytics tab: Usage charts, cost ledger, multiplier history
  5.5  Real-time notification polling (30s interval, key health alerts)
  5.6  Add Key modal with legal checkboxes, Turnstile, pool mode selection
  5.7  Rotate Key / Delete Key / Pool Toggle modals
  5.8  Public /report page (abuse takedown, no auth required)
  Dependencies: Phase 1–4 complete for backend APIs.

======================================================================================
PHASE 6 — OBSERVABILITY, DOCS & HARDENING (Ship-ready)
======================================================================================
  6.1  OpenAPI spec update (all new v4.0 endpoints)
  6.2  Analytics Engine telemetry events (IR-19)
  6.3  Admin panel: pool coordinator state view, manual key quarantine
  6.4  Secret rotation runbook (docs/ops/secret-rotation.md)
  6.5  Threat model review post-implementation (docs/legal/ sync)
  6.6  make gate passes on all new code (100% coverage on critical paths)
======================================================================================
```

---

## 14. Verification & Acceptance Criteria

| ID | Criterion | Pass Condition |
|:---|:---|:---|
| AC-01 | Self-key priority routing | Trace confirms own key chosen before community key on every request where own key is healthy |
| AC-02 | Community debt accumulation | After 100 communal requests at 1 CU each, debt == 100 CU; after own key serves 100 requests, debt == 0 CU |
| AC-03 | Quota jail enforcement | When debt > 1.0× daily_contributed_CU, communal key returns HTTP 429 with error code `quota_jail` |
| AC-04 | GCP project hash Sybil block | Submitting two keys from same GCP project under different GitHub accounts returns HTTP 409 |
| AC-05 | 24h observation enforcement | Key submitted at T=0 does not appear in PoolCoordinatorDO community pool until T=24h |
| AC-06 | Tombstone block | After key deletion (no replacement), project hash re-registration returns HTTP 409 for 14 days |
| AC-07 | HKDF isolation | Decrypting tenant A's keys with tenant B's derived key fails with `InvalidKey` |
| AC-08 | Error normalizer | No upstream response contains `x-goog-*` header or GCP project number in body |
| AC-09 | Takedown timing | 100 takedown requests (50 hits, 50 misses) have identical mean response time ± 10ms |
| AC-10 | Hero/Parasite classification | Key with dispatched_communal ≥ 80% dispatched_today classified HERO; retains CU credit |
| AC-11 | DO eviction durability | Simulate DO eviction mid-session; dispatched_today counter survives cold-start |
| AC-12 | Midnight jitter | On reset, 100 exhausted keys have reactivation timestamps distributed ≈ uniformly across 300s |
| AC-13 | make gate | All new TypeScript compiles strict mode, 0 errors, all golden tests pass in < 10s |
| AC-14 | Cold-start 40% cap | With N=4 contributors, any single contributor's pool share is hard-capped at 40% |
| AC-15 | Consent attestation | Registration without all 3 checkboxes returns HTTP 422; attestations stored in D1 |
