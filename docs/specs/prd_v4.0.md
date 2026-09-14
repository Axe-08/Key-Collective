# Key Collective v4.0 — Complete Product Requirements Document

> **Version Transition:** v3.5 (Private Key Vault & Proxy) → v4.0 (Reciprocal Commons)  
> **Document Type:** Full Product Requirements & System Requirements Specification (PRD/SRS)  
> **Status:** Architecture Draft — Awaiting Engineering Sign-Off  
> **Effective Date:** September 2026  
> **Governing Standards:** `GEMINI.md` Constitution · `docs/legal/threat_vectors.md` · `docs/legal/countermeasures_and_mitigations.md`

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
- ✅ GitHub OAuth 2.0 PKCE (`src/auth/oauth.ts`)
- ✅ 5-Layer Anti-Sybil engine (account age, subnet velocity, email, Turnstile, contributions) (`src/auth/sybil.ts`)
- ✅ Per-tenant `KeyPoolDO` with circuit breaker and RPM rate limiter (`src/durable_objects/key_pool_do.ts`)
- ✅ Per-tenant `TenantQuotaDO` with sliding-window RPM/RPD enforcement (`src/quota/tenant_do.ts`)
- ✅ `CascadeRouter` with `CapabilityFilter` and `ModelRegistry` (`src/router/`)
- ✅ AES-256-GCM key encryption with global master secret (`src/crypto/encryption.ts`)
- ✅ OpenAI-compatible proxy with SSE streaming (`src/proxy/`)
- ✅ Admin surveillance panel (`src/admin/admin_router.ts`)
- ✅ D1 schema: `auth_tokens`, `api_keys`, `model_registry`, `cost_ledger`, `daily_spend_rollup`
- ✅ Subdomain routing: `api.*`, `console.*`, `admin.*`, `apex.*`

### 1.2 What v3.5 Cannot Do (The Entire Commons Gap)

| Capability | v3.5 Status | Required for v4.0 |
|:---|:---:|:---|
| Contribute your key to a shared pool | ❌ | FR-01, FR-07, IR-01 |
| Draw from other contributors' idle quota | ❌ | FR-02, FR-04, IR-04 |
| Track community debt / dynamic multiplier | ❌ | FR-03, IR-05 |
| Global pool health telemetry | ❌ | FR-04, IR-06 |
| Switch keys between Private and Community pools | ❌ | FR-01, FR-14 |
| Anti-Sybil GCP project hash extraction | ❌ | FR-06, IR-09 |
| Enforce 24h community routing quarantine | ❌ | FR-07 |
| 14-day project hash tombstone | ❌ | FR-08 |
| Per-tenant HKDF encryption isolation | ❌ (global key) | FR-09, IR-11 |
| Downstream error normalizer (provider leak shield) | Partial | FR-10, IR-12 |
| Abuse takedown endpoint with timing shield | ❌ | FR-11, IR-13 |
| Midnight jitter + leaky-bucket queue | ❌ | FR-05, IR-07 |
| Passive contributor canary alarm | ❌ | FR-13, IR-14 |
| Hero/Parasite classification engine | ❌ | FR-16, IR-05 |
| Progressive vesting ramp (1.5× → 4.5×) | ❌ | FR-17 |
| Console dashboard with pool/standing/telemetry tabs | ❌ | FR-14, IR-15 |
| Legal clickwrap at key submission | ❌ | FR-15 |
| Pool Coordinator singleton DO | ❌ | IR-06 |
| Forced-error GCP ingress probe | ❌ | IR-09 |

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

### IR-01: D1 Migration `0002_commons_pooling.sql`
Extends `api_keys` and creates new tables for pool tracking. No existing data destroyed. See Section 8.

### IR-02: D1 Migration `0003_project_hash_registry.sql`
Creates `project_hash_registry` table for three-state GCP project lifecycle enforcement. See Section 8.

### IR-03: D1 Migration `0004_contributor_standing.sql`
Creates `contributor_standing` table for persistent community_debt, vesting tier, trusted_contributor flag, and consent attestation timestamps.

### IR-04: New Durable Object: `PoolCoordinatorDO`
Singleton global DO (`POOL_COORDINATOR`) binding. File: `src/durable_objects/pool_coordinator_do.ts`. Maintains: per-provider key counts, U_pool, W_provider, per-tenant rolling 5-min request volumes, reactivation timers, leaky-bucket queue.

### IR-05: `TenantKeyPoolDO` — Major Refactor
Extend `KeyPoolDO` (`src/durable_objects/key_pool_do.ts`) with: pool_type per key, community_routing_status, dispatched_today/dispatched_communal counters (synced to `this.ctx.storage`), vesting_tier, hero/parasite classification logic, 24h passive canary `setAlarm()`.

### IR-06: `TenantDO` — Community Debt Engine
Extend `TenantQuotaDO` (`src/quota/tenant_do.ts`) with: community_debt_micro_cu (int64), daily_contributed_cu, multiplier_ceiling, trusted_contributor flag, midnight decay alarm.

### IR-07: Midnight Reactivation Timer (`PoolCoordinatorDO`)
Scheduled alarm in PoolCoordinatorDO at 00:00 UTC assigns Uniform(0, 300s) jitter offsets to all exhausted keys and wakes them with individual `setAlarm()` calls.

### IR-08: Leaky-Bucket Midnight Queue (`PoolCoordinatorDO`)
In-memory FIFO queue inside PoolCoordinatorDO for requests arriving 23:55–00:05 UTC. Hold requests ≤ 5 seconds, drain as jittered keys activate. If 5s elapsed with no key, return 429.

### IR-09: Forced-Error GCP Ingress Probe Client
New function in `src/storage/repositories/apiKeys.ts` or new `src/ingress/probe_client.ts`. Two-phase: (1) invalid model request → extract consumer project number from ErrorInfo, (2) 1-token health check. Must handle non-Google providers gracefully (skip phase 1, proceed to health check only).

### IR-10: Cloudflare Turnstile Integration at Key Submission
Turnstile already integrated at account registration (`src/auth/sybil.ts` Layer 1). Must be additionally enforced at key submission endpoint (`POST /api/keys`) and abuse takedown (`POST /api/abuse/report-key`). Reuse existing Turnstile verification client.

### IR-11: HKDF Per-Tenant Encryption Migration
Refactor `src/crypto/encryption.ts` to accept `tenantId` and derive per-tenant subkey via Web Crypto HKDF. Existing encrypted keys in D1 must be migrated: decrypt with old global key, re-encrypt with new HKDF-derived key, per-tenant. Runbook: `docs/ops/secret-rotation.md`.

### IR-12: Downstream Error Normalizer Middleware
New worker middleware layer: `src/worker/error_normalizer.ts`. Intercepts all upstream error responses before returning to client. Extracts `status_code`, maps to standard KC error codes, strips `google.rpc.ErrorInfo`, `x-goog-*` headers, billing metadata.

### IR-13: Abuse Takedown Endpoint
New route handler: `POST /api/abuse/report-key`. Lives in `src/worker/index.ts` route table. Requires Turnstile, per-IP rate limiter (5/hr), constant 200ms response padding, SHA-256 hash lookup, D1 key revocation, project hash tombstone.

### IR-14: DO Alarm Handler for Passive Canary
Add `alarm()` method to `TenantKeyPoolDO`. Method fires at 00:00 UTC, checks if personal requests yesterday < 50, probes all community-mode keys. Uses Cloudflare Workers Cron Trigger or DO `setAlarm()` API.

### IR-15: Console SPA Frontend
Full browser application at `console.*` subdomain. Technology: React + TypeScript (strict) or equivalent. Components required:
- `StandingCard` — multiplier, debt, trusted badge
- `KeyTable` — key rows with pool toggle control
- `PoolTelemetryPanel` — community pool + provider pool views
- `UsageChart` — 7d / 30d request graphs
- `AddKeyModal` — key submission flow with attestation checkboxes
- `RotateKeyModal` — 30-minute rotation grace window UI
- `PoolToggleModal` — migration freeze check, debt settlement display
- `RealtimeNotifications` — key health alerts, quota jail warnings

### IR-16: Real-Time Notification System (Worker Push / Polling)
Dashboard needs real-time key health alerts. Options:
1. **Server-Sent Events (SSE)** from `GET /api/notifications/stream` — long-poll connection
2. **Short-poll** `GET /api/notifications?since=timestamp` — simpler, acceptable latency
Recommendation: Short-poll at 30-second intervals for MVP.

### IR-17: Provider-Level Pool Telemetry Aggregation
`PoolCoordinatorDO` must calculate and expose:
- Per-provider: active_keys, quarantined_keys, observation_keys, U_pool_percent
- Per-provider: P90 TTFT (rolling 5-minute), uptime rate, W_provider score
Available via `GET /api/pool/telemetry` (authenticated, all tenants) and `GET /admin/api/pool/health` (admin only with raw data).

### IR-18: Consent Attestation Logging
D1 table `consent_attestations` stores per-tenant, per-event consent records: tenant_id, event_type (REGISTRATION | KEY_SUBMISSION), checkbox_id, timestamp, IP address. Immutable append-only table (no UPDATE/DELETE).

### IR-19: Analytics Engine Non-Blocking Telemetry Extension
Extend `src/worker/telemetry_emitter.ts` to emit new events (no blocking):
- `pool_key_routed` (tenantId, keyOwnerId, provider, cu_weight)
- `community_debt_change` (tenantId, delta_cu, new_debt_cu)
- `key_health_event` (keyId, tenantId, status, provider)
- `pool_spiker_brake` (tenantId, share_percent, brake_applied)
- `vesting_tier_change` (tenantId, old_tier, new_tier)

### IR-20: OpenAPI Spec Update (`src/worker/openapi_spec.ts`)
Add all new v4.0 endpoints and data models to the OpenAPI 3.1 spec. Required for client SDK generation and API documentation.

---

## 8. D1 Database Schema

### Migration 0002: Commons Pooling Extensions

```sql
-- Extend api_keys table with pool mode and community tracking fields
ALTER TABLE api_keys ADD COLUMN pool_type TEXT NOT NULL DEFAULT 'COMMUNITY'
  CHECK (pool_type IN ('PRIVATE', 'COMMUNITY'));

ALTER TABLE api_keys ADD COLUMN community_routing_status TEXT NOT NULL DEFAULT 'OBSERVATION'
  CHECK (community_routing_status IN ('OBSERVATION', 'ACTIVE', 'QUARANTINED', 'REVOKED'));

ALTER TABLE api_keys ADD COLUMN observation_until TIMESTAMP;

-- Persisted dispatch counters (survive DO eviction via D1 sync at midnight)
ALTER TABLE api_keys ADD COLUMN dispatched_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN dispatched_communal INTEGER NOT NULL DEFAULT 0;

-- Vesting tier (persisted across key rotations)
ALTER TABLE api_keys ADD COLUMN vesting_tier INTEGER NOT NULL DEFAULT 0
  CHECK (vesting_tier IN (0, 1, 2));
  -- 0: < 2h, 1: 2-12h, 2: >= 12h

-- GCP project hash (from forced-error probe)
ALTER TABLE api_keys ADD COLUMN provider_project_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_api_keys_pool_status
  ON api_keys (pool_type, community_routing_status, provider, status);

CREATE INDEX IF NOT EXISTS idx_api_keys_observation
  ON api_keys (observation_until, community_routing_status);
```

### Migration 0003: Project Hash Registry

```sql
-- Three-state GCP project hash registry
-- Enforces uniqueness constraint and rotation lifecycle
CREATE TABLE IF NOT EXISTS project_hash_registry (
  project_hash     TEXT PRIMARY KEY,   -- SHA-256(project_number + PEPPER)
  tenant_id        TEXT NOT NULL,      -- Owning contributor
  provider         TEXT NOT NULL,      -- 'google_gemini', 'groq', etc.
  state            TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (state IN ('ACTIVE', 'ROTATING', 'TOMBSTONED')),
  rotating_until   TIMESTAMP,          -- Non-null during ROTATING state
  tombstone_until  TIMESTAMP,          -- Non-null during TOMBSTONED state (14 days)
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_hash_tenant
  ON project_hash_registry (tenant_id);

CREATE INDEX IF NOT EXISTS idx_project_hash_state
  ON project_hash_registry (state, tombstone_until);
```

### Migration 0004: Contributor Standing & Consent

```sql
-- Per-tenant community standing and multiplier state
-- Durable snapshot of TenantDO hot state (midnight rollup)
CREATE TABLE IF NOT EXISTS contributor_standing (
  tenant_id                TEXT PRIMARY KEY,
  community_debt_micro_cu  INTEGER NOT NULL DEFAULT 0,  -- int64 CU debt
  daily_contributed_cu     INTEGER NOT NULL DEFAULT 0,  -- int64 yesterday's contribution
  consecutive_debt_free_days INTEGER NOT NULL DEFAULT 0, -- for trusted badge
  trusted_contributor      INTEGER NOT NULL DEFAULT 0,  -- 0 or 1 boolean
  multiplier_ceiling       TEXT NOT NULL DEFAULT '4.5', -- current ceiling as text
  current_multiplier       TEXT NOT NULL DEFAULT '1.5', -- current effective multiplier
  last_decay_at            TIMESTAMP,
  updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Immutable legal consent attestation log
CREATE TABLE IF NOT EXISTS consent_attestations (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  event_type   TEXT NOT NULL CHECK (event_type IN ('REGISTRATION', 'KEY_SUBMISSION')),
  checkbox_id  TEXT NOT NULL,   -- 'C1', 'C2', 'C3', 'K1', 'K2'
  attested_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address   TEXT NOT NULL,
  user_agent   TEXT
  -- NO UPDATE / DELETE allowed on this table (append-only)
);

CREATE INDEX IF NOT EXISTS idx_consent_tenant
  ON consent_attestations (tenant_id, event_type);
```

---

## 9. Durable Object Architecture

### 9.1 Durable Object Roster (v4.0)

| DO Name | Binding | Scope | Exists? | v4.0 Changes |
|:---|:---|:---|:---:|:---|
| `TenantKeyPoolDO` | `KEY_POOL` | Per-tenant | ✅ | Major: pool_type, dispatched_today, canary alarm, hero/parasite |
| `TenantQuotaDO` | `TENANT_QUOTA` | Per-tenant | ✅ | Major: community_debt engine, multiplier governor |
| `PoolCoordinatorDO` | `POOL_COORDINATOR` | **Global singleton** | ❌ | **New**: all pool-wide state, W_provider, spiker brake |

### 9.2 PoolCoordinatorDO State (New)

```typescript
// src/durable_objects/pool_coordinator_do.ts

interface PoolCoordinatorState {
  // Per-provider aggregate health
  providers: Record<string, ProviderPoolState>;

  // Per-tenant rolling 5-min request volume (for spiker detection)
  tenantVolume: Record<string, TenantVolumeEntry>;

  // Reactivation jitter timers (keyId → reactivation timestamp)
  reactivationQueue: Record<string, number>;

  // Midnight leaky-bucket queue
  midnightQueue: QueuedRequest[];
}

interface ProviderPoolState {
  activeKeys: number;
  quarantinedKeys: number;
  observationKeys: number;
  uPoolPercent: number;      // 0–100
  p90LatencyMs: number;
  uptimeRate: number;        // 0.0–1.0
  wProvider: number;         // Computed quality weight
  lastUpdated: number;
}

interface TenantVolumeEntry {
  requestsLast5Min: number;
  lastReported: number;       // timestamp
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

### Existing Endpoints (Modified)

| Method | Path | Change in v4.0 |
|:---|:---|:---|
| `POST` | `/v1/chat/completions` | Add self-key priority router pre-check |
| `GET` | `/v1beta/models/:model:generateContent` | Add response normalizer middleware |
| `POST` | `/api/keys` | Add forced-error probe, HKDF encryption, pool_type field, attestation checkboxes K1/K2 |
| `DELETE` | `/api/keys/:id` | Trigger ROTATING state in project_hash_registry |
| `GET` | `/auth/callback` | Store consent attestations C1–C3 on completion |

### New Endpoints

| Method | Path | Description | Auth |
|:---|:---|:---|:---|
| `PATCH` | `/api/keys/:id/pool-mode` | Toggle key between PRIVATE and COMMUNITY | Bearer |
| `GET` | `/api/pool/telemetry` | Global pool health (all tenants visible) | Bearer |
| `GET` | `/api/pool/standing` | Personal community standing (multiplier, debt, tier) | Bearer |
| `GET` | `/api/pool/contribution` | Personal contribution metrics | Bearer |
| `GET` | `/api/notifications` | Short-poll notification stream | Bearer |
| `POST` | `/api/abuse/report-key` | Plaintext key takedown with timing shield | Turnstile |
| `GET` | `/api/keys/:id/health` | Per-key health status | Bearer |
| `GET` | `/admin/api/pool/coordinator` | Full coordinator state | Admin |
| `POST` | `/admin/api/keys/:id/quarantine` | Admin manual key quarantine override | Admin |

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

### NFR-03: Data Integrity — Fixed-Point Financials
All CU tracking, community_debt, microdollar costs: int64/bigint. Zero floating-point math. CU weights computed from token counts using integer arithmetic only.

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
