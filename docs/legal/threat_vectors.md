# Key Collective: Master Threat Vectors Taxonomy

> **Document Type:** Adversarial Threat Catalog & Attack Surface Map  
> **Target System:** Key Collective (Cloudflare Edge Multi-Tenant Commons)  
> **Status:** Working Baseline (Awaiting Countermeasure Alignment)  
> **Effective Date:** September 2026  

---

## 1. Executive Taxonomy Overview

This document establishes the comprehensive threat taxonomy for Key Collective's reciprocal key pooling commons. It catalogs **21 distinct threat vectors** across 7 operational and strategic domains. 

In keeping with strict security engineering standards, this document organizes the **attack mechanics, entry points, system blind spots, and blast radii**. Specific technical countermeasures and mitigation policies are maintained in a separate companion document developed in direct alignment with the system architect.

```
Key Collective Threat Landscape
 ├── 1. Identity & Sybil Vectors
 │    ├── Threat 01: Sybil Attack via Farmed GitHub Identities
 │    └── Threat 02: Commercial SaaS Operator Disguised as Individual Developer
 ├── 2. Credential Authenticity & Ownership
 │    ├── Threat 03: Stolen / Leaked Key Injection (Pastebin/Public Repo Scraping)
 │    ├── Threat 04: Post-Contribution Key Revocation & Canary Exploitation
 │    └── Threat 05: Dead / Quota-Exhausted Key Injection (429 Ambiguity)
 ├── 3. Financial, Billing & Legal Liability
 │    ├── Threat 06: The "Paid-Tier Trap" (Inadvertent Billing Account Drain)
 │    └── Threat 07: Geopolitical & Export Sanctions Liability (OFAC / EAR99)
 ├── 4. Game-Theoretic & Economic Exploitation
 │    ├── Threat 08: Flash Contribution & EWMA Timing Arbitrage
 │    ├── Threat 09: Credit Unit (CU) Inflation via High-Latency / Low-Quality Providers
 │    ├── Threat 10: Pool Saturation & Intentional Multiplier Degradation
 │    ├── Threat 17: Private Pool Migration Arbitrage (Quota Laundering via Pool Switching)
 │    └── Threat 21: Cold-Start Contributor Whale Monopoly
 ├── 5. Provider Forensics & Egress Correlation
 │    ├── Threat 11: Provider Canary Traps & Multi-Key Egress Fingerprinting
 │    └── Threat 12: Quota Reset "Thundering Herd" (Midnight UTC Spike Cascade)
 ├── 6. Data Privacy & Side-Channel Leakage
 │    ├── Threat 13: Prompt Eavesdropping via Upstream Provider Dashboards
 │    ├── Threat 14: Upstream Diagnostic Metadata Leakage via Error Payloads
 │    ├── Threat 15: Prompt Injection for Infrastructure & Routing Intelligence
 │    ├── Threat 19: Takedown Endpoint Timing Side-Channel
 │    └── Threat 20: Phishing / UI Cloning Attack on Contributors
 └── 7. Infrastructure & Maintainer Resilience
      ├── Threat 16: Denial-of-Wallet (DoW) on the Cloudflare Maintainer
      └── Threat 18: Encryption Key Material Custody & Single-Point Exfiltration
```

---

## 2. Threat Catalog by Domain

---

### Domain 1: Identity & Sybil Vectors

#### Threat 01: Sybil Attack via Farmed GitHub Identities
* **Domain:** Identity / Access Control
* **Target:** GitHub OAuth Verification Gate & Tier Entitlements
* **Severity:** **HIGH**
* **Attack Mechanism:** An attacker provisions 5–10 aged GitHub accounts (either artificially matured or purchased from credential brokers). Each account contributes free-tier API keys to the communal pool, harvesting amplified multiplier capacity ($2\times - 4.5\times$) across all identities. The attacker aggregates these accounts through automated tooling to power a high-throughput personal workload, multiplying effective quota by $30\times - 60\times$.
* **System Blind Spot:** OAuth verification verifies the *existence* and historical metadata of a GitHub account, but cannot natively guarantee uniqueness of the human operator behind multiple accounts.
* **Blast Radius:** Rapid exhaustion of communal buffer capacity; starvation of honest individual contributors.

#### Threat 02: Commercial Operator Disguised as Developer
* **Domain:** Identity / Platform Governance
* **Target:** Non-Commercial Barter Commons Boundary
* **Severity:** **MEDIUM-HIGH**
* **Attack Mechanism:** A commercial SaaS startup or profit-generating product routes production customer LLM traffic through Key Collective under the guise of an individual developer account. They contribute minimal free-tier keys, harvest the communal multiplier, and subsidize their commercial API costs at the expense of the collective.
* **System Blind Spot:** Traffic arrives via standard OpenAI-compatible API requests (`/v1/chat/completions`). Without deep behavioral profiling or application telemetry, commercial traffic streams are indistinguishable from active developer prototyping.
* **Blast Radius:** Changes the project's legal status from a non-commercial developer utility into an unauthorized commercial API proxy/resale pipeline; drastically increases risk of provider legal action.

---

### Domain 2: Credential Authenticity & Ownership

#### Threat 03: Stolen / Leaked Key Injection
* **Domain:** Credential Integrity / Legal Liability
* **Target:** Ingress Key Submission (`/api/keys`)
* **Severity:** **CRITICAL**
* **Attack Mechanism:** An attacker scrapes leaked API keys from public GitHub repositories, pastebins, or compromised developer environments and registers them with Key Collective. The keys pass initial 1-token health checks. The attacker gains high CU credit and pool access using credentials they do not own.
* **System Blind Spot:** Ingress testing verifies that a key is *cryptographically valid* and returns `200 OK`, but does not verify whether the submitter is the authentic account owner or authorized licensee.
* **Blast Radius:** Shifts legal exposure from breach of contract (civil ToS violation) to criminal unauthorized computer access under the CFAA (18 U.S.C. § 1030) or EU Computer Misuse directives, as Key Collective would be routing unauthorized third-party traffic through compromised credentials.

#### Threat 04: Post-Contribution Key Revocation & Canary Exploitation
* **Domain:** Credential Health & Lifecycle
* **Target:** KeyPoolDO In-Memory Routing & Quota Calculations
* **Severity:** **HIGH**
* **Attack Mechanism:** An attacker submits valid API keys, receives immediate Credit Unit (CU) attribution and an expanded multiplier, and immediately revokes the keys in the upstream provider console. The attacker continues consuming communal quota during the latency window before automated health probes flag the keys as invalid. More advanced variants time the revocation just prior to quota reset windows to harvest continuous capacity while contributing dead keys.
* **System Blind Spot:** Periodic canary checks (e.g. every 10–15 minutes) leave an unmonitored exploitation window where revoked keys remain credited in memory.
* **Blast Radius:** Pool capacity is consumed by an actor offering zero reciprocal throughput, causing elevated 401 failovers for honest traffic.

#### Threat 05: Dead / Quota-Exhausted Key Injection
* **Domain:** Quota Accounting
* **Target:** Key State Classification & Circuit Breakers
* **Severity:** **MEDIUM**
* **Attack Mechanism:** A contributor consumes $99\%$ of their daily free-tier quota on private tasks, then submits the exhausted key to Key Collective late in the day. The key is valid but immediately returns HTTP `429 Too Many Requests`.
* **System Blind Spot:** Circuit breakers that conflate temporary rate limiting (short-term RPM spikes) with daily quota exhaustion (24-hour RPD depletion) may keep exhausted keys in a retryable state rather than suspending CU credit.
* **Blast Radius:** Injection of zero-capacity keys inflates the contributor's dynamic multiplier while adding no usable bandwidth to the collective pool.

---

### Domain 3: Financial, Billing & Legal Liability

#### Threat 06: The "Paid-Tier Trap" (Inadvertent Billing Account Drain)
* **Domain:** Financial & Economic Liability
* **Target:** Upstream Provider Billing Engines
* **Severity:** **CRITICAL**
* **Attack Mechanism:** A well-intentioned contributor submits an API key generated from a Google Cloud or Groq account that has a credit card or pay-as-you-go billing account attached. Key Collective multiplexes communal traffic through this key. When free requests are exhausted, the provider transitions seamlessly into paid overage, charging hundreds or thousands of dollars to the contributor's personal credit card.
* **System Blind Spot:** The gateway verifies key validity, but does not inspect whether the underlying cloud project is strictly cardless or attached to an active billing account.
* **Blast Radius:** Contributor suffers direct financial damage; may file fraud, negligence, or unauthorized conversion complaints against the maintainers.

#### Threat 07: Geopolitical & Export Sanctions Liability (OFAC / EAR99)
* **Domain:** Regulatory Compliance
* **Target:** Edge Ingress & Anycast Routing Layer
* **Severity:** **HIGH**
* **Attack Mechanism:** Users connecting from sanctioned jurisdictions (Cuba, Iran, North Korea, Syria, Crimea/Donetsk/Luhansk) access US-origin frontier models (Gemini, Groq, NVIDIA) through Key Collective's edge proxy using keys contributed by US persons.
* **System Blind Spot:** Ingress validation focuses on Sybil bots and rate limits, but does not enforce geographic IP fencing against sanctioned state territories.
* **Blast Radius:** Regulatory enforcement actions under US Export Administration Regulations (EAR99) and OFAC economic sanctions.

---

### Domain 4: Game-Theoretic & Economic Exploitation

#### Threat 08: Flash Contribution & EWMA Timing Arbitrage
* **Domain:** Tokenomics & Incentive Curves
* **Target:** Exponentially Weighted Moving Average (EWMA) Balances
* **Severity:** **MEDIUM**
* **Attack Mechanism:** An attacker contributes high-CU keys, extracts peak multiplier capacity across a short duration (24–48 hours), and then deletes or revokes the keys. Because standard EWMA algorithms decay gradually over several days, the attacker continues to draw above-baseline ($>1.0\times$) quota from the pool while contributing zero active bandwidth.
* **System Blind Spot:** Asymmetric decay curves that fail to penalize sudden key withdrawals or lack a minimum maturation tenure before unlocking multipliers.
* **Blast Radius:** Unfair extraction of communal capacity; degradation of pool stability.

#### Threat 09: Credit Unit (CU) Inflation via High-Latency / Low-Quality Providers
* **Domain:** Quota Valuation & Pricing Models
* **Target:** Credit Unit Calculation Formula
* **Severity:** **MEDIUM**
* **Attack Mechanism:** An attacker contributes keys from providers with high nominal request limits but severe real-world queuing delays (e.g. 240 RPM nominal with 15-second TTFT). The raw formula awards massive CU based purely on nominal limits, allowing the attacker to drain fast, low-latency Gemini/Groq keys while contributing low-utility capacity.
* **System Blind Spot:** Static valuation formulas that measure theoretical capacity ($RPM + RPD/100 + TPM/10,000$) rather than observed throughput and latency.
* **Blast Radius:** Imbalance in pool quality; fast provider keys are drained in exchange for unusable high-latency headroom.

#### Threat 10: Pool Saturation & Intentional Multiplier Degradation
* **Domain:** Algorithmic Game Theory
* **Target:** Dynamic Multiplier Curve ($X_{\text{eff}}$)
* **Severity:** **MEDIUM**
* **Attack Mechanism:** A participant uses strict affinity routing to ensure their own requests execute against their own healthy contributed keys. Simultaneously, they flood the communal pool with low-priority or synthetic traffic, driving cluster utilization ($U_{\text{pool}}$) toward $1.0$. This collapses everyone else's multiplier down to baseline ($1.0\times$), starving competitors while their own workload remains unaffected.
* **System Blind Spot:** Symmetric multiplier formulas where high global utilization degrades all participants uniformly, without per-tenant consumption caps.
* **Blast Radius:** Denial of dynamic multiplier benefits for all legitimate participants.

---

### Domain 5: Provider Forensics & Egress Correlation

#### Threat 11: Provider Canary Traps & Multi-Key Egress Fingerprinting
* **Domain:** Anti-Detection & Network Forensics
* **Target:** Cloudflare Worker Egress Networking
* **Severity:** **CRITICAL**
* **Attack Mechanism:** An upstream AI provider injects an internally tracked "Canary Key" into Key Collective. By observing the inbound requests to that key, the provider records the exact Cloudflare Anycast egress IP, TLS fingerprint, header casing, and timestamps. The provider queries its central logs for identical egress footprints across all other registered keys, identifying and simultaneously banning the entire collective pool.
* **System Blind Spot:** Operating a monolithic key pool where all keys share identical outbound network characteristics and egress points.
* **Blast Radius:** Instantaneous catastrophic loss of all contributed keys across the entire platform.

#### Threat 12: Quota Reset "Thundering Herd" (Midnight UTC Spike Cascade)
* **Domain:** Runtime SRE & Concurrency
* **Target:** Edge Circuit Breakers & Ingress Queues
* **Severity:** **HIGH**
* **Attack Mechanism:** Providers reset daily free quotas (RPD) at 00:00:00 UTC. Automated developer scripts paused during the day resume simultaneously at midnight. Hundreds of concurrent requests hit the pool in the first few seconds. While daily quota is refreshed, per-minute limits (15 RPM for Gemini) are instantly overwhelmed, triggering cascading 429s and tripping circuit breakers across all keys.
* **System Blind Spot:** Lack of demand smoothing or synthetic staggering across daily quota boundaries.
* **Blast Radius:** Total pool downtime and oscillating circuit breaker trips every night at 00:00 UTC.

---

### Domain 6: Data Privacy & Side-Channel Leakage

#### Threat 13: Prompt Eavesdropping via Upstream Provider Dashboards
* **Domain:** Data Privacy & Confidentiality
* **Target:** Upstream Developer Consoles
* **Severity:** **HIGH**
* **Attack Mechanism:** A user dispatches sensitive prompts (containing proprietary code, internal business logic, or personal identifiers) through the communal pool. The proxy routes the request through another contributor's key. If that provider’s web console logs request histories (e.g. OpenRouter or GCP projects with active Cloud Logging), the key owner can log into their console and read the caller's complete prompt and completion.
* **System Blind Spot:** Assuming transport-layer encryption (TLS) protects data confidentiality, while overlooking data at rest within third-party provider dashboards.
* **Blast Radius:** Data leakage, exposure of intellectual property, and privacy violations.

#### Threat 14: Upstream Diagnostic Metadata Leakage via Error Payloads
* **Domain:** Information Disclosure
* **Target:** Client Error Handling & Redaction
* **Severity:** **MEDIUM**
* **Attack Mechanism:** An attacker sends deliberately malformed or boundary-pushing prompts designed to cause upstream HTTP $4\times\times$ errors. Upstream providers often include project numbers, GCP project IDs, or account identifiers in their JSON error responses. If these responses are reflected back to the client, the attacker maps the identities of key contributors.
* **System Blind Spot:** Error redaction that searches only for API key patterns (`AIzaSy...`, `gsk_...`) while passing through other diagnostic fields.
* **Blast Radius:** Loss of contributor anonymity; targeted harassment or direct reporting of contributor accounts to providers.

#### Threat 15: Prompt Injection for Infrastructure & Routing Intelligence
* **Domain:** Model Security
* **Target:** Prompt Pipelines & System Contexts
* **Severity:** **LOW-MEDIUM**
* **Attack Mechanism:** An attacker crafts adversarial prompt injections designed to make the underlying model reveal system context, proxy instructions, or metadata regarding the environment in which it is running.
* **System Blind Spot:** Any injection of internal routing metadata or system instructions into upstream payload bodies.
* **Blast Radius:** Intelligence gathering on internal proxy operations; reconnaissance for downstream attacks.

---

### Domain 7: Infrastructure & Maintainer Resilience

#### Threat 16: Denial-of-Wallet (DoW) on the Cloudflare Maintainer
* **Domain:** Infrastructure Economics / Availability
* **Target:** Cloudflare Worker Invocations, D1 SQLite & Durable Object Storage
* **Severity:** **HIGH**
* **Attack Mechanism:** An attacker floods the edge endpoint with millions of rapid, unauthenticated or invalid requests. Even though requests are rejected with HTTP 401 or 400, each request consumes Worker execution time, queries D1 SQLite for auth tokens, and wakes Durable Objects.
* **System Blind Spot:** Executing database lookups and compute-heavy auth logic before edge rate limiting or in-memory caching can drop invalid packets.
* **Blast Radius:** The maintainer incurs unsustainable Cloudflare infrastructure bills, forcing the project offline.

---

## 3. Threat Severity & Priority Summary

| Priority | Threat Vector | Category | Impact Level |
| :---: | :--- | :--- | :--- |
| **P0** | **Threat 03: Stolen / Leaked Key Injection** | Credential Integrity | Criminal liability (CFAA / Unauthorized Access) |
| **P0** | **Threat 06: The "Paid-Tier Trap"** | Financial Liability | Economic harm to contributors; conversion claims |
| **P0** | **Threat 11: Provider Canary Traps & Fingerprinting** | Network Forensics | Mass termination of all community keys |
| **P1** | **Threat 01: Sybil Attack via Farmed GitHub Identities** | Access Control | Systemic pool exhaustion & economic collapse |
| **P1** | **Threat 04: Post-Contribution Key Revocation** | Credential Health | Capacity leeching & elevated failover rates |
| **P1** | **Threat 12: Quota Reset "Thundering Herd"** | SRE / Reliability | Nightly pool outages & circuit breaker flapping |
| **P1** | **Threat 13: Upstream Dashboard Prompt Eavesdropping** | Data Privacy | Intellectual property and privacy breaches |
| **P1** | **Threat 16: Denial-of-Wallet on Maintainer** | Infrastructure | Financial exhaustion of open-source project |
| **P2** | **Threat 02: Commercial Operator Disguised as Developer** | Governance | Sublicensing / resale ToS exposure |
| **P2** | **Threat 05: Dead / Quota-Exhausted Key Injection** | Quota Accounting | Inflation of non-contributory multipliers |
| **P2** | **Threat 07: Geopolitical & Export Sanctions** | Compliance | Regulatory violations (OFAC / EAR99) |
| **P2** | **Threat 08: Flash Contribution & EWMA Arbitrage** | Tokenomics | Game-theoretic draining of capacity |
| **P2** | **Threat 09: CU Inflation via High-Latency Providers** | Valuation | Asymmetric compute quality exchange |
| **P2** | **Threat 10: Pool Saturation Multiplier Degradation** | Game Theory | Intentional denial of dynamic multipliers |
| **P2** | **Threat 14: Upstream Metadata Leakage in Errors** | Privacy | Deanonymization of key contributors |
| **P3** | **Threat 15: Prompt Injection for Routing Intelligence** | Security | Architectural reconnaissance |
| **P2** | **Threat 17: Private Pool Migration Arbitrage** | Game Theory / Tokenomics | Quota laundering via pool-switching & phantom CU credit |
| **P1** | **Threat 18: Encryption Key Material Custody** | Infrastructure Security | Single Cloudflare account compromise → full key pool exfiltration |
| **P2** | **Threat 19: Takedown Endpoint Timing Side-Channel** | Privacy / Security | Probing registered key space via response latency differential |
| **P3** | **Threat 20: Phishing / UI Cloning Attack on Contributors** | Social Engineering | Contributor key harvesting via spoofed domain |
| **P2** | **Threat 21: Cold-Start Contributor Whale Monopoly** | Game Theory | Power imbalance in early community enabling pool manipulation |
