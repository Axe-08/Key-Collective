# Key Collective v4.0 — Inception Board

## 1. User Personas

### Persona 1: The Open-Source Maintainer / Research Engineer
* **Goals:** Run sustained evaluation pipelines, benchmark suites, and autonomous agent loops without mid-run crashes.
* **Pain Points:** Hard API rate limits (e.g., 15 RPM / 1,500 RPD) break automated workloads. Cannot afford Enterprise tiers.
* **Technical Sophistication:** High. Comfortable configuring proxy endpoints, understands API mechanics, and manages multiple GCP projects.
* **Contribution Behavior:** Altruistic and practical. Willing to contribute idle keys to the pool to earn a dynamic multiplier for burst capacity during testing phases.

### Persona 2: The Indie Hacker / Side-Project Developer
* **Goals:** Build and launch weekend projects or indie tools with minimal configuration.
* **Pain Points:** Hits rate limits quickly when a side project gets initial traction, but lacks the revenue to justify paid API tiers.
* **Technical Sophistication:** Medium. Wants a drop-in OpenAI-compatible proxy solution without managing infrastructure.
* **Contribution Behavior:** Likely to contribute a single free-tier key to access the community pool and earn standard multiplier benefits.

### Persona 3: The Student / Hackathon Builder
* **Goals:** Ship hackathon projects fast using state-of-the-art LLMs.
* **Pain Points:** Locked out of paid tiers entirely (no international credit card). Needs a capacity buffer during 24-48 hour crunch times.
* **Technical Sophistication:** Low to Medium. Discovers the platform via Discord or open-source repos.
* **Contribution Behavior:** Net consumer initially, but contributes whatever free keys they can generate to stay in the community pool and avoid quota jail.

---

## 2. Scope Guillotine

### IN SCOPE (v4.0 Commons)
* **Reciprocal Commons:** Dual-pool key assignment (Private vs. Community).
* **Self-Key Priority Router:** Cascade routing prioritizing a user's own keys before drawing from the commons.
* **Community Debt Ledger:** Real-time CU (Cost Unit) debt accumulation and 30% daily decay.
* **Legal Compliance Layer:** Strict clickwrap (C1-C3 at signup, K1-K2 at key submission) under India IT Act Section 79.
* **Anti-Sybil Protections:** Forced-error GCP ingress probes for project hash extraction and 14-day tombstones.
* **Observation Buffer:** 24-hour quarantine for newly submitted community keys.
* **Quota Jail:** Soft (0.5×) and hard (1.0×) rate multiplier lockout based on community debt.
* **Midnight Freeze:** Pool toggle blocked 23:30–00:30 UTC to prevent quota gaming.
* **Vesting Tiers:** Bronze / Silver / Gold based on contribution longevity.
* **PoolCoordinatorDO:** Global singleton Durable Object for pool orchestration.
* **HKDF Per-Tenant Key Derivation:** Replacing single AES master secret.
* **v4.0 SPA Frontend:** Pool & Commons tab, Community Debt widget, updated Add Key Modal with K1/K2.
* **Takedown Portal:** Public `/report` endpoint, constant 200ms timing shield.

### EXPLICITLY OUT OF SCOPE
* **Provider Billing Integration:** The system strictly disclaims paid-tier keys. Handling billing liability is OUT.
* **Content Safety Filtering:** Key Collective will not impose its own content guardrails. Transparent passthrough only.
* **Data Privacy/Confidentiality:** Eavesdropping protection is OUT (providers may log prompts, acknowledged via C2).
* **SLA / Uptime Guarantees:** Best-effort commons model; no enterprise support or uptime guarantees.
* **Commercial Usage:** Strictly a non-commercial, open-source collective.
* **Custom Model Routing Rules:** No user-configurable per-model routing logic in v4.0.
* **Billing Dashboard / Invoicing:** No payment processing in v4.0.

---

## 3. EDD Golden Criteria

1. **GC-01 Routing Latency:** Self-key priority routing overhead < 5ms P95 measured at DO entry.
2. **GC-02 Debt Accuracy:** Community Debt decay (30%/day at 00:01 UTC) correct to ±1 CU against reference implementation.
3. **GC-03 Observation Enforcement:** No `COMMUNITY_POOL` routing within 24h ±30s of key `OBSERVATION_START` event.
4. **GC-04 Duplicate Rejection:** GCP ingress probe strictly rejects duplicate project hashes with HTTP 409 within 1s.
5. **GC-05 Quota Jail Trigger:** Burst multiplier clamped to exactly 1.0× immediately when community debt > 1.0× daily contributed CU, with no grace window.

---

## 4. User Journey Map

### Stage 1: Discover
* **Action:** Lands on Key Collective via open-source repo, Discord, or word of mouth.
* **Experience:** Reads about Reciprocal Commons (1.5×–4.5× multiplier). Tests the API in "Demo Mode" (25 RPD, shared IP pool, ephemeral DemoDO).
* **Outcome:** Clicks "Join the Commons" to authenticate.

### Stage 2: Sign Up
* **Action:** GitHub OAuth 2.0 PKCE authentication (or Google OAuth).
* **Experience:** Passes 5-Layer Anti-Sybil check (Turnstile, subnet velocity, account age, GitHub age, etc.). Presented with mandatory legal consent modal: C1 (Acknowledgement of key relay), C2 (Waiver of confidentiality), C3 (Section 79 liability acknowledgement). All three mandatory checkboxes with version-stamped hashes stored in D1.
* **Outcome:** Account created. JWT issued. Enters Probationary Mode (2 RPM, 50 RPD) until first key added.

### Stage 3: First Key
* **Action:** Submits a provider API key in the Console via Add Key Modal.
* **Experience:** Selects provider, agrees to K1 (free-tier certification) and K2 (ownership certification) checkboxes. System performs Forced-Error GCP Hash Extraction Probe (unique project hash extracted, stored in D1 registry). Proof-of-life probe fires to verify key is valid.
* **Outcome:** Key AES-256-GCM encrypted with HKDF-derived tenant key. User earns Builder Tier status. Quota upgraded to Builder limits.

### Stage 4: Pool Decision
* **Action:** Chooses pool mode in Add Key Modal or from Dashboard key table.
* **Experience:**
  * **Community Pool:** Key enters 24h Observation Buffer (serves self only). After 24h, joins global communal routing. Earns burst multiplier (1.5×–4.5× based on vesting tier). Community Debt Ledger begins tracking CU consumed from pool.
  * **Private Pool:** Key dedicated strictly to personal requests at 1.0× passthrough. No debt accrual, no multiplier.
* **Outcome:** Key assigned to pool mode. Dashboard updates with multiplier KPI, debt widget, and pool status badge.

### Stage 5: Daily Usage
* **Action:** Routes API requests through `api.key-col.axe08.tech/v1` (OpenAI-compatible endpoint).
* **Experience:** Self-Key Priority router attempts own keys first. If all own keys are rate-limited/exhausted, taps into global Pool Coordinator DO (Eye-for-an-Eye: only accessible if debt < 1.0× threshold). Community debt accumulates per CU consumed. 30%/day decay rewards sustained contributors with Pristine (⭐) badge.
* **Monitoring:** Console Dashboard shows: Burst Multiplier KPI, Community Debt (CU), Key Pool status (Active/Observing/Jailed), Provider health indicators, Live telemetry stream.

---

## 5. Why Now (Market Timing)

* **Model Commoditization vs. Rate Limits:** Open-source models now match proprietary ones in many tasks, but developers remain severely bottlenecked by restrictive free-tier rate limits (15 RPM / 1,500 RPD for Gemini Flash). The performance gap has closed; the access gap has not.
* **Rise of Agentic AI:** The shift from single-shot chat to multi-step agent loops (eval pipelines, MCTS, autonomous coding agents) requires massive burst capacity. Individual free tiers cannot sustain these workloads. A collective pool is the only cost-effective solution.
* **Decentralized AI Ethos:** A critical mass of developers holds idle API quota. The infrastructure (Cloudflare Workers, D1, Durable Objects) now exists to coordinate this quota safely at zero marginal hosting cost. The Reciprocal Commons model democratizes AI infrastructure without VC funding or centralized billing.
