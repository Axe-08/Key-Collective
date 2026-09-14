# Key Collective: Feature & System Requirements Specification (v0.3)

> **Document Type:** Production Architecture & System Requirements Specification (SRS)  
> **Target Version:** Key Collective v0.3 (Commons Evolution)  
> **Status:** Draft Architecture Specification (Awaiting Engineering Sign-Off)  
> **Effective Date:** September 2026  
> **Foundational Standards:** `GEMINI.md` Constitution, `docs/legal/threat_vectors.md`, `docs/legal/countermeasures_and_mitigations.md`

---

## 1. Executive Summary & Codebase State Analysis

### 1.1 Current Architecture Baseline (v0.2)
Key Collective currently operates as a Cloudflare Workers + Durable Objects multi-model proxy:
* **Storage Layer (`src/storage/`):** D1 database (`auth_tokens`, `api_keys`, `model_registry`, `cost_ledger`). Keys are AES-256-GCM encrypted.
* **Execution Layer (`src/durable_objects/`, `src/quota/`):** 
  * `TenantQuotaDO` enforces per-user rate limits and tiered quotas (`admin`, `ultra`, `max`, `builder`, `probationary`, `demo`).
  * `KeyPoolDO` isolates tenant key pools with basic circuit breakers.
* **Routing Layer (`src/router/`, `src/worker/`):** Cascade router with fallback escalation across models.

### 1.2 The Architectural Gap to Commons Pooling
The existing codebase implements a **single-tenant key vault** where each user exclusively calls their own keys. It lacks:
1. **The Dual-Pool Primitive:** No conceptual or physical separation between **Private Keys** (dedicated to tenant) and **Communal Pool Keys** (shared across reciprocal contributors).
2. **The Global Coordinator:** No singleton `PoolCoordinatorDO` aggregating global pool utilization ($U_{\text{pool}}$) and cross-tenant capacity.
3. **Credit Unit (CU) & Debt Engine:** No math or state tracking for $W_{\text{provider}}$, dynamic multipliers ($1.5\times - 4.5\times$), or `community_debt`.
4. **Onboarding Safeguards:** No forced-error GCP extraction, no Turnstile device binding, no 24-hour community routing buffer.
5. **Developer UI/UX:** No web console interface for pool toggling, telemetry visibility, or structured clickwrap agreements.

---

## 2. Feature & Requirement Matrix (Mapped to Threat Vectors)

Every feature below is grounded in a specific failure mode cataloged in `docs/legal/threat_vectors.md`.

```
========================================================================================================================
Feature ID   Feature Name                             Target Vector                       Infrastructure Readiness
========================================================================================================================
FR-01        Dual-Pool Schema & Key Assignment        V17 (Migration Arbitrage)           REQUIRES NEW INFRA (D1 + DO)
FR-02        Self-Key Priority Router                 V01, V03, V06, V17                  REQUIRES ROUTER REFACTOR
FR-03        Continuous Community Debt Engine         V06, V08, V17                       REQUIRES TENANT_DO UPGRADE
FR-04        Global Pool Coordinator DO               V06, V07, V12                       REQUIRES NEW SINGLETON DO
FR-05        Midnight Reset Jitter & Leaky Queue      V12 (Thundering Herd)               REQUIRES QUEUE HARNESS
FR-06        Forced-Error GCP Ingress Probe           V04 (Sybil / Hash Spoofing)         REQUIRES WORKER PROBE LOGIC
FR-07        Silent 24h Community Routing Delay       V05, V11 (Stolen Keys / Canaries)   REQUIRES KEY STATE MACHINE
FR-08        Three-State Project Hash & Tombstone     V03, V04 (Cycling & Re-reg)         REQUIRES D1 TABLE EXTENSION
FR-09        Per-Tenant HKDF Key Isolation            V18 (Maintainer Exfiltration)       REQUIRES CRYPTO REFACTOR
FR-10        Downstream Error Normalizer              V09, V14 (Metadata / Recon Leak)    REQUIRES WORKER MIDDLEWARE
FR-11        Takedown Endpoint & Side-Channel Guard   V05, V19 (Griefing & Timing Oracle) REQUIRES NEW ENDPOINTS
FR-12        Cold-Start Contributor Share Cap         V03, V21 (Whale Monopoly)           REQUIRES ALGORITHMIC HOOK
FR-13        Passive Contributor Canary Alarm         V01 (Passive Mortality Blind Spot)  REQUIRES DO ALARM HANDLER
FR-14        Contributor UI: Pool & Debt Management   V06, V07, V17                       REQUIRES CONSOLE SPA
FR-15        Clickwrap, Onboarding & Trust UX         V05, V10, V13, V16, V20             REQUIRES ONBOARDING FLOW
========================================================================================================================
```

---

## 3. Detailed Specifications: Core Routing & Infrastructure

### FR-01: Dual-Pool Schema & Key State Machine
* **Referenced Threat:** **Vector 17 (Private Pool Migration Arbitrage)**
* **Problem Statement:** The current `api_keys` table does not distinguish between a key reserved for solo private use versus a key donated to the commons.
* **Required Infrastructure:**
  1. **D1 Migration (`0002_commons_pooling.sql`):**
     * Add `pool_type TEXT NOT NULL DEFAULT 'COMMUNITY' CHECK (pool_type IN ('PRIVATE', 'COMMUNITY'))` to `api_keys`.
     * Add `community_routing_status TEXT NOT NULL DEFAULT 'OBSERVATION' CHECK (community_routing_status IN ('OBSERVATION', 'ACTIVE', 'QUARANTINED', 'REVOKED'))`.
     * Add `observation_until TIMESTAMP NOT NULL` (enforces 24-hour buffer).
     * Add `dispatched_today INTEGER NOT NULL DEFAULT 0`.
     * Add `dispatched_communal INTEGER NOT NULL DEFAULT 0`.
     * Add `provider_project_hash TEXT NOT NULL`.
  2. **Durable Object Storage Sync:** `KeyPoolDO` must mirror `pool_type` in memory and sync all usage counters to `this.ctx.storage` on every single dispatch to survive Cloudflare DO eviction (resolving Vector 02's blind spot).

### FR-02: Self-Key Priority Cascade Router
* **Referenced Threats:** **Vector 17 (Primary), Vector 01 (Key Revocation), Vector 03 (Flash Timing), Vector 06 (Saturation)**
* **Problem Statement:** If an attacker can choose to route their own requests through community keys while hoarding their own keys, they can drain community buffers and retreat cleanly.
* **Implementation Specification:**
  * In `src/router/cascade_router.ts` and `src/worker/router_handler.ts`:
  ```
  Inbound Request (Tenant T, Provider P)
           │
           ▼
  Does Tenant T own any HEALTHY key for Provider P?
  (Checked across BOTH Private and Community keys)
           ├── YES ──► Route through Tenant T's OWN key
           │            (Dispatched internally, zero community debt incurred)
           │
           └── NO  ──► Is Tenant T eligible for communal pooling?
                        (Check: community_debt <= daily_quota AND tier >= Builder)
                             ├── YES ──► Route to Global Pool Coordinator DO
                             └── NO  ──► HTTP 429: "Own keys exhausted. Quota jail active."
  ```
* **Architectural Invariant:** Communal fallback only occurs when the contributor's own keys are either (a) at physical 15 RPM burst limit, or (b) daily RPD exhausted.

### FR-03: Continuous Community Debt Engine & Multiplier Governor
* **Referenced Threats:** **Vector 06 (Pool Saturation), Vector 08 (Commercial Disguised Dev), Vector 17 (Quota Laundering)**
* **Problem Statement:** Debt evaluation only at migration exit allows sustained in-pool abusers to freeload indefinitely without hitting quota jail.
* **Required Infrastructure:**
  1. **TenantDO Continuous State:**
     * `community_debt_micro_cu`: 64-bit integer representing net debt denominated in CU-equivalent units ($1\text{ CU} = 1,000,000\text{ micro-CU}$).
     * Increment rule: When request is served by community key:
       $$\text{debt} \leftarrow \text{debt} + \text{Request\_CU\_Weight}$$
     * Decrement rule: When contributor's key serves another user's request:
       $$\text{debt} \leftarrow \text{debt} - \text{Request\_CU\_Weight}$$
  2. **Continuous Multiplier Clamping:**
     * If $\text{debt} > 0.5 \times \text{Daily\_Contributed\_CU}$: Clamp multiplier ceiling to $1.5\times$ (Soft Warning).
     * If $\text{debt} > 1.0 \times \text{Daily\_Contributed\_CU}$: Force multiplier to $1.0\times$ (Quota Jail; zero community burst).
  3. **Midnight Decay Engine:**
     * Scheduled alarm at 00:00 UTC executes:
       $$\text{debt} \leftarrow \lfloor \text{debt} \times 0.80 \rfloor$$
  4. **Trusted Contributor Accelerator:**
     * If $\text{debt} \le 0$ for 7 consecutive days, set `trusted_contributor = 1`. Multiplier ceiling rises to $5.0\times$, debt decay accelerates to $30\%/\text{day}$.

### FR-04: Global Pool Coordinator DO
* **Referenced Threats:** **Vector 06 (Anomalous Spiker), Vector 07 (CU Valuation), Vector 12 (Thundering Herd)**
* **Problem Statement:** Tenant DOs are strictly isolated. No entity currently tracks global pool health, aggregate utilization ($U_{\text{pool}}$), or real-time provider quality weights ($W_{\text{provider}}$).
* **Required Infrastructure:**
  * Create `src/durable_objects/pool_coordinator_do.ts` bound as `POOL_COORDINATOR` singleton.
  * **Per-Tenant Telemetry Ingress:** Each `TenantDO` dispatches an asynchronous ping to `POOL_COORDINATOR` every 10 requests reporting rolling 5-minute request volume.
  * **Anomalous Spiker Detection:** If any tenant's rolling 5-minute share exceeds $35\%$ of aggregate pool volume, the coordinator sends an RPC message to that tenant's DO engaging the emergency brake.
  * **Dynamic Provider Quality Weight ($W_{\text{provider}}$):** Calculates rolling P90 TTFT and uptime every 60 seconds against a $1,500\text{ms}$ benchmark:
    $$W_{\text{provider}}(t) = \text{Uptime\_Rate} \times \min\left(1.0, \; \frac{1500\text{ms}}{\text{P90\_TTFT}}\right)$$

### FR-05: Midnight Reset Jitter & Leaky-Bucket Queue
* **Referenced Threat:** **Vector 12 (Midnight UTC Spike Cascade)**
* **Implementation Specification:**
  * When upstream daily quota reset occurs at 00:00:00 UTC, `PoolCoordinatorDO` assigns each exhausted key an independent random reactivation delay:
    $$t_{\text{reactivate}} = 00{:}00{:}00\text{ UTC} + \text{Uniform}(0, 300\text{s})$$
  * **Midnight Queue:** Requests arriving between 23:55 and 00:05 UTC that cannot be immediately served are held in an in-memory queue inside the DO for up to 5 seconds before returning 429, smoothly draining as jittered keys wake up.

---

## 4. Detailed Specifications: Credential Security & Ingress Verification

### FR-06: Forced-Error GCP Ingress Probe
* **Referenced Threat:** **Vector 04 (Sybil via Multiple GitHub Accounts & Project Hash)**
* **Problem Statement:** Healthy keys return HTTP 200 without `google.rpc.ErrorInfo`. Project numbers cannot be extracted from successful responses.
* **Implementation Specification:**
  * During key registration (`POST /api/keys`), Key Collective executes a 2-phase probe:
    1. **Phase 1 (Forced Error):** Dispatch `POST https://generativelanguage.googleapis.com/v1beta/models/kc-probe-nonexistent:generateContent` with the submitted key.
    2. Google returns HTTP 400 with:
       ```json
       {
         "error": {
           "code": 400,
           "message": "models/kc-probe-nonexistent is not found...",
           "status": "INVALID_ARGUMENT",
           "details": [
             {
               "@type": "type.googleapis.com/google.rpc.ErrorInfo",
               "reason": "API_KEY_INVALID",
               "domain": "googleapis.com",
               "metadata": { "consumer": "projects/784920183921" }
             }
           ]
         }
       }
       ```
    3. Parse `metadata.consumer` $\rightarrow$ extract `784920183921`.
    4. Compute `hash = SHA256("784920183921" + PEPPER)`.
    5. Query D1: If `hash` exists in `ACTIVE` or `TOMBSTONED` state $\rightarrow$ reject key with HTTP 409 Conflict.
    6. **Phase 2 (Proof of Life):** Dispatch standard 1-token probe (`gemini-2.5-flash`, `max_tokens: 1`) to confirm quota is healthy.

### FR-07: Silent 24-Hour Community Routing Delay
* **Referenced Threats:** **Vector 05 (Stolen / Leaked Keys), Vector 11 (Provider Canary Traps)**
* **Implementation Specification:**
  * Upon key creation, set `observation_until = CURRENT_TIMESTAMP + 24 hours`.
  * The key is marked `community_routing_status = 'OBSERVATION'`.
  * Router logic:
    * Contributor's own requests: Key is eligible immediately ($1.0\times$ to $1.5\times$).
    * Communal requests from other users: **Strictly excluded**.
  * At $T + 24\text{ hours}$, key automatically transitions to `ACTIVE` communal status.

### FR-08: Three-State Project Hash & 14-Day Tombstone
* **Referenced Threats:** **Vector 03 (Timing Arbitrage), Vector 04 (Sybil)**
* **Implementation Specification:**
  * Table `project_hash_registry (project_hash TEXT PRIMARY KEY, tenant_id TEXT, state TEXT, expires_at TIMESTAMP)`:
    * `ACTIVE`: Currently bound to an active key.
    * `ROTATING`: Contributor deleted key via dashboard. Valid for 30 minutes. If a new key with same project hash is submitted, inherits previous vesting tier.
    * `TOMBSTONED`: 30-minute grace expired, or key revoked upstream. Re-registration of this GCP project hash is **hard-blocked for 14 days**.

### FR-09: Per-Tenant HKDF Key Derivation
* **Referenced Threat:** **Vector 18 (Maintainer Account Compromise / Key Material Exfiltration)**
* **Implementation Specification:**
  * Remove global static encryption key usage.
  * Implement Web Crypto HKDF derivation in `src/crypto/encryption.ts`:
    $$K_{\text{tenant}} = \text{crypto.subtle.deriveKey}(\text{HKDF}, \; K_{\text{master}}, \; \text{tenantId}, \; \text{"aes-256-gcm"})$$
  * Each tenant's keys are encrypted with their mathematically isolated $K_{\text{tenant}}$.

### FR-10: Downstream Error Normalizer & Header Sanitizer
* **Referenced Threats:** **Vector 09 (Prompt Injection Recon), Vector 14 (Metadata Leakage)**
* **Implementation Specification:**
  * Worker edge interceptor strips all upstream provider headers: `server`, `x-goog-*`, `x-groq-*`, `alt-svc`, `x-cloud-trace-context`, `x-envoy-*`, `cf-ray`.
  * Injects standard tracing header: `X-KeyCollective-Request-Id: kc_req_<uuid>`.
  * Intercepts upstream error payloads and normalizes to standard HTTP codes:
    * 400: `invalid_request`, `model_unavailable`, `content_policy`
    * 413: `request_too_large`
    * 429: `rate_limited` (includes `retry-after`), `quota_exhausted`
    * 502: `upstream_unavailable`
    * 503: `pool_unavailable`

### FR-11: Plaintext Takedown Endpoint with Timing Shield
* **Referenced Threats:** **Vector 05 (Stolen Key Liability), Vector 19 (Timing Side-Channel)**
* **Implementation Specification:**
  * Endpoint: `POST /api/abuse/report-key`.
  * Input: `{ "plaintext_key": "AIzaSy...", "turnstile_token": "..." }`.
  * Safeguards:
    1. Turnstile verification mandatory.
    2. Rate limit: 5 requests per IP per hour.
    3. Uniform response delay: artificial sleep ensuring response always takes exactly **200ms**.
    4. Lookup: Compute SHA-256 of submitted key and compare. If match, mark key `REVOKED` immediately.
    5. Zero Strike on Submitter: Submitting an existing key revokes it without banning the contributor account (anti-griefing).

---

## 5. UI/UX, Information Architecture & Governance

### 5.1 What the User Sees vs. What is Hidden (Information Boundary)

| Data Entity | Visible to User in Dashboard | Strictly Hidden / Redacted | Rationale |
|:---|:---|:---|:---|
| **Contributed Keys** | Label, Provider, Prefix (`AIza...`), Suffix (`...3x9Z`), Created Date, Daily Usage (`842 / 1500`), Pool Toggle (`Private` vs `Community`) | Full plaintext key, ciphertext, nonce, GCP Project Number | Zero key exfiltration via UI; prevents project deanonymization |
| **Community Standing** | Current Tier (`Builder`, `Max`), Active Multiplier (`2.8x`), Community Debt (`0 CU`), Trusted Status (`Active`) | Other tenants' usage, raw communal pool key IDs, internal routing state | Strict multi-tenant isolation |
| **Pool Telemetry** | Aggregate healthy keys per provider (`Gemini: 142 keys`), Pool Utilization (`U_pool = 64%`), Provider Weight ($W_{\text{provider}}$) | Which contributor owns which key, individual key error logs, project hashes | Public transparency without reconnaissance surface |
| **Inference Errors** | Standard HTTP Status, KC Error Code (`rate_limited`), `retry-after` header, `X-KeyCollective-Request-Id` | Raw Google/Groq JSON errors, GCP project numbers, billing error details | Vector 09 & 14 metadata shielding |

---

### 5.2 Contributor Onboarding & Clickwrap Agreement Structure

The registration and key submission flows must enforce specific legal safe harbors without overwhelming the developer:

#### Screen 1: Account Creation & GitHub OAuth
* **Prerequisites:** GitHub account $\ge 90$ days old, $\ge 1$ public non-fork repository with active commits.
* **Clickwrap Checkbox (Mandatory):**
  > [ ] *"I agree to the Key Collective Terms of Service and Contributor Agreement. I acknowledge that Key Collective is a non-commercial, open-source collective under Section 79 of the Indian Information Technology Act, 2000."*
* **Export Control Safe-Harbor Clause (Vector 16):**
  > *"Users are individually responsible for ensuring their use complies with all applicable local and international export laws and regulations."*
* **Privacy & Dashboard Disclosure (Vector 13):**
  > *"Notice: Requests are processed by third-party provider infrastructure (Google, Groq) and may be logged in provider developer dashboards. Do not route proprietary, confidential, or personally identifiable data through Key Collective."*

#### Screen 2: Key Registration Modal (`POST /api/keys`)
* **Interactive Form Elements:**
  1. **Provider Select:** Dropdown (`Google Gemini`, `GroqCloud`, `SambaNova`, `Cerebras`).
  2. **Key Label:** User-friendly nickname (e.g., `Personal Gemini Flash`).
  3. **API Key Input:** Password-masked input field with paste button.
  4. **Initial Pool Mode:** Radio toggle:
     - `Community Pool (Recommended)`: Earns dynamic multipliers ($1.5\times \rightarrow 4.5\times$); 24-hour initial observation buffer.
     - `Private Pool`: Dedicated solely to your own traffic ($1.0\times$ passthrough); zero community sharing.
  5. **Billing Safeguard Checkbox (Vector 10 - Mandatory):**
     > [ ] *"I certify that this API key belongs to a standalone project with NO credit card or billing account attached. I understand that Key Collective is a free-tier-only commons and disclaims liability for any provider billing charges."*
     > *(Includes 1-click link: "How to verify your project has billing disabled in Google AI Studio")*
  6. **Security & Ownership Attestation (Vector 05 - Mandatory):**
     > [ ] *"I certify that I am the authorized creator of this API key and have the legal right to contribute its quota."*
  7. **Turnstile Widget:** Invisible Cloudflare Turnstile verification.

---

### 5.3 Developer Console SPA Design (Screens & Interactions)

```
+----------------------------------------------------------------------------------------------------+
|  KEY COLLECTIVE                                         [Trusted Contributor ⭐] [Multiplier: 3.2x] |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [ YOUR POOL STANDING ]                                                                            |
|  +---------------------------+  +---------------------------+  +--------------------------------+  |
|  | Current Multiplier: 3.2x  |  | Community Debt: 0 CU      |  | 24h Personal Usage: 1,420 req  |  |
|  | Baseline: 1.0x (Solo)     |  | Status: Pristine Standing |  | Communal Burst: +2,840 req     |  |
|  +---------------------------+  +---------------------------+  +--------------------------------+  |
|                                                                                                    |
|  [ YOUR CONTRIBUTED KEYS ]                                            [ + Add New Provider Key ]   |
|  +----------------------------------------------------------------------------------------------+  |
|  | Provider  | Label             | Prefix/Suffix | Status    | Mode        | 24h Quota   | Actions   |  |
|  +-----------+-------------------+---------------+-----------+-------------+-------------+-----------+  |
|  | Gemini    | Flash Dev Key     | AIza...3x9Z   | Active    | [Community] | 1,180/1,500 | [Rotate]  |  |
|  | Groq      | Llama-70B Fast    | gsk_...89a1   | Active    | [Community] | 4,200/14.4k | [Rotate]  |  |
|  | Gemini    | Private Test Key  | AIza...99kk   | Dedicated | [Private ▼] | 320/1,500   | [Delete]  |  |
|  +----------------------------------------------------------------------------------------------+  |
|                                                                                                    |
|  [ GLOBAL COMMONS TELEMETRY ]                                                                      |
|  +----------------------------------------------------------------------------------------------+  |
|  | Provider Pool | Active Keys | Pool Utilization (U_pool) | Quality Weight (W_p) | P90 Latency |  |
|  +---------------+-------------+---------------------------+----------------------+-------------+  |
|  | Google Gemini | 184 keys    | 62% (Healthy)             | 1.00x                | 420 ms      |  |
|  | GroqCloud     | 96 keys     | 71% (Healthy)             | 1.00x                | 280 ms      |  |
|  | SambaNova     | 42 keys     | 48% (Optimal)             | 0.92x (Congested)    | 1,620 ms    |  |
|  +----------------------------------------------------------------------------------------------+  |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

---

## 6. Implementation Phasing & Dependency Graph

```
Milestone Execution Order:
========================================================================================================
[ Phase 1: Storage & Cryptographic Core ]
  ├── 1.1 D1 Migration 0002 (pool_type, project_hash_registry, community_debt columns)
  ├── 1.2 HKDF Per-Tenant Key Derivation (src/crypto/encryption.ts)
  └── 1.3 Three-State Project Hash Table & 14-Day Tombstone Logic

[ Phase 2: Ingress Verification & Anti-Sybil ]
  ├── 2.1 Forced Error Probe for GCP Project Number Extraction
  ├── 2.2 Cloudflare Turnstile Integration on Key Submission
  └── 2.3 Silent 24-Hour Community Routing Quarantine State Machine

[ Phase 3: Global Pool Coordinator & Router Engine ]
  ├── 3.1 POOL_COORDINATOR Durable Object Implementation
  ├── 3.2 Self-Key Priority Cascade Routing Refactor
  ├── 3.3 Continuous Community Debt Tracking & Auto-Jail Clamping
  └── 3.4 Jittered Midnight Reactivation & Leaky-Bucket Queue

[ Phase 4: Edge Gateway Hardening & Telemetry ]
  ├── 4.1 Downstream Error Normalizer & Header Sanitizer
  ├── 4.2 Plaintext Takedown Endpoint (200ms Constant Delay + Turnstile)
  └── 4.3 Passive Contributor 24-Hour Canary Alarm Handler

[ Phase 5: Developer UI & Consent Governance ]
  ├── 5.1 Onboarding Flow & Clickwrap Legal Checkboxes
  ├── 5.2 Private vs. Community Pool Management Toggle
  └── 5.3 Public Pool Telemetry Dashboard Views
========================================================================================================
```

---

## 7. Verification & Acceptance Criteria

1. **Deterministic Gate Compliance:** All changes must compile and pass `make gate` in $<10\text{s}$ with zero type errors.
2. **Zero Plaintext Invariant:** No plaintext API keys appear in D1, console logs, or analytics streams.
3. **Sybil Resistance Test:** Submitting two different keys from the same Google Cloud Project under two different GitHub accounts must result in HTTP 409 Conflict via the forced-error probe hash.
4. **Self-Key Verification:** When a user issues a request, the router must verify that the user's own key is chosen before any communal key is dispatched.
5. **DO Eviction Durability:** `dispatched_today` counters must survive simulated DO restarts without losing communal vs. private classification.
