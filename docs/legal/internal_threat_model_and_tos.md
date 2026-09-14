# Key Collective: Internal Threat Model, Anti-Abuse Defense & Terms of Service

> **Document Type:** Security Architecture, Abuse Prevention & Legal Agreement  
> **Target System:** Key Collective (Cloudflare Edge Multi-Tenant Commons)  
> **Effective Date:** September 2026  
> **Status:** Production Architecture Baseline

---

## 1. Algorithmic Adaptations

### 1.1 The 80% Soft-Demotion Headroom Algorithm

Rather than shutting down a Google Gemini key when it reaches its daily quota, Key Collective implements a continuous soft-demotion curve.

```
Key Daily Quota Utilization (RPD)
[ 0% to 80% ]    ---> Normal Headroom Rotation (Primary Pool)
[ 80% to 99% ]   ---> Soft-Demoted Priority (Emergency Overflow Only)
[ 99% to 100% ]  ---> 15-Request Protective Cushion (Hard 429 Guard)
```

#### Selection Weighting Function

Each key $k$ in the pool is evaluated dynamically during key selection:

* **Tier 1 (Normal Rotation: 0 to 1,200 requests):**  
  `Weight = 1.0 - (RPD_used / 1500)`  
  Keys participate in standard round-robin and headroom-weighted balancing.

* **Tier 2 (Soft-Demoted: 1,200 to 1,485 requests):**  
  `Weight = 0.01 * (1.0 - (RPD_used / 1500))`  
  The key's selection probability drops by 100x. It is placed at the absolute bottom of candidate priority. It is never selected if any other healthy Gemini key has under 80% utilization. It acts solely as an emergency shock-absorber during cluster bursts.

* **Tier 3 (Emergency Buffer: 1,485+ requests):**  
  `Weight = 0.0`  
  A 15-request cushion ensures the key never receives an upstream HTTP 429 quota exhaustion error.

---

### 1.2 Reciprocal "Eye-for-an-Eye" Provider Gating

Key Collective enforces strict provider-symmetric reciprocity:

> **Core Rule:** You cannot consume from a communal provider pool to which you do not actively contribute.

| User Contribution State | Communal Entitlement | Private Fallback |
| :--- | :--- | :--- |
| **Contributes Active Gemini Key** | Unlocks Communal Gemini Pool ($X\times$ capacity) | Own keys always available at $1.0\times$ floor |
| **Withdraws / Revokes Gemini Key** | Immediate lockout from Communal Gemini Pool | Reverts to private single-user mode for Gemini |
| **Contributes Groq / Cerebras Only** | Unlocks Communal Groq & Cerebras Pools | Zero access to Communal Gemini Pool |

#### Durable Object State Verification

Inside `TenantPoolDO.ts`, user entitlements are verified per request:

```typescript
// Provider pool access check
function canAccessProviderPool(tenant: TenantState, provider: string): boolean {
  // If user does not maintain at least one healthy, verified key 
  // for this specific provider, communal routing is denied.
  return tenant.verifiedActiveProviders.has(provider);
}
```

---

## 2. Internal Threat Model & Abuse Vectors

While corporate terms of service govern external relationships, an open commons must defend against malicious, selfish, or reckless internal actors.

---

### Threat 1: The "Phantom / Revoked Key" Attack

* **Attack Vector:** An attacker registers, submits a valid Gemini key, receives an immediate $X\times$ collective multiplier, and immediately deletes or revokes the key in Google AI Studio.
* **System Impact:** The attacker consumes quota from honest contributors, while their own key returns `401 Unauthorized` to the pool.
* **Defenses:**
  1. **Synchronous Ingress Verification:** A key is never activated until a live 1-token probe (`{"max_tokens": 1}`) succeeds against the upstream provider.
  2. **1-Strike Quarantine:** The first `401` or `403` returned by an upstream key immediately marks it `REVOKED` in Durable Object memory in under 1ms.
  3. **Instant Demotion:** The contributing account is instantly dropped to the `Probationary` tier, severing all communal pool access.
  4. **7-Day EWMA Smoothing:** Multipliers are anchored to a 7-day exponentially weighted moving average of verified uptime. Flash additions cannot harvest instant high quotas.

---

### Threat 2: Dead / Exhausted Key Dumping

* **Attack Vector:** An attacker consumes 1,490 of their 1,500 daily requests on private scripts, then submits the exhausted key at 23:30 to extract fresh communal capacity.
* **System Impact:** The collective inherits a key that immediately errors out, while the attacker drains fresh communal tokens.
* **Defenses:**
  1. **Header Quota Audit on Import:** Provider rate limit headers (`x-ratelimit-remaining-*`) are inspected on submission.
  2. **Immediate 80% Demotion:** Keys submitted with under 20% remaining quota are immediately placed into the Soft-Demoted tier and award zero dynamic bonus until the daily reset window clears.

---

### Threat 3: Sybil Account Multi-Registration

* **Attack Vector:** Headless bot swarms automate registration of dozens of accounts using disposable burner profiles to harvest base allowances.
* **System Impact:** Collective capacity is fragmented and exhausted by automated leeches.
* **Defenses:**
  1. **GitHub Account Maturity Gate:** Access to communal pooling requires a GitHub account that is at least 30 days old, with at least 1 public non-fork repository and at least 5 lifetime public contributions.
  2. **Cloudflare Turnstile:** Headless browser automation is challenged and blocked at the edge.
  3. **IP Subnet Velocity Rate Limiting:** Maximum of 1 account registration per `/24` IPv4 subnet (or `/48` IPv6) per 30 days. Datacenter and VPN IP ranges are rejected.

---

### Threat 4: Toxic Prompt Injection & Account Poisoning

* **Attack Vector:** An attacker transmits abusive payloads (malware generation, cyberattack scripts, CSAM) through the pool. The request is dispatched using another innocent contributor's key, causing Google or Groq to ban the innocent user's account.
* **System Impact:** Innocent developers suffer account termination due to another user's malicious traffic.
* **Defenses:**
  1. **Edge Pre-Flight Moderation Filter:** The Edge Worker executes zero-latency safety heuristics via Cloudflare Workers AI (`@cf/meta/llama-guard-3-8b`) before dispatching upstream.
  2. **Edge Rejection:** High-risk violations are dropped at the edge with `HTTP 400 Bad Request` before touching any upstream key.
  3. **Cryptographic Audit Trail:** A one-way hash of `(request_hash, caller_user_id, key_id, timestamp)` is recorded in Cloudflare Analytics Engine. Malicious callers can be permanently banned upon provider incident reports.

---

### Threat 5: Asymmetric Token Leeching

* **Attack Vector:** An attacker contributes a small 8k-context Groq key, but exclusively sends massive 1,000,000-token prompts to Gemini Pro, consuming massive upstream bandwidth.
* **System Impact:** Token exhaustion and compute imbalance.
* **Defenses:**
  1. **TPM-Weighted Credit Units (CU):** Keys are rewarded based on tokens per minute (TPM), not just raw request counts.
  2. **Token Bucket Enforcement:** Durable Objects enforce hourly token consumption ceilings proportional to contributed token capacity.
  3. **Context Tier Gating:** Access to long-context models ($>128\text{k}$ tokens) requires contributing at least one long-context key.

---

### Threat 6: Upstream Error Reflection & Secret Key Leakage

* **Attack Vector:** An attacker crafts malformed requests attempting to force the gateway to reflect raw upstream error headers containing another contributor's decrypted Bearer key.
* **System Impact:** Credential theft across tenant boundaries.
* **Defenses:**
  1. **Response Redaction Stream:** A Web TransformStream inspects all error bodies and replaces key patterns (`AIzaSy...`, `gsk_...`) with `[REDACTED]`.
  2. **Normalized Error Schemas:** Upstream responses are converted to standard OpenAI error objects without forwarding raw upstream HTTP headers.

---

## 3. Summary of Anti-Abuse Defenses

| Threat Vector | Attack Description | Primary Algorithmic Mitigation | Implementation File |
| :--- | :--- | :--- | :--- |
| **Phantom Keys** | Revoking key immediately after joining | Synchronous 1-token check + 1-strike instant DO quarantine | `KeyValidator.ts` |
| **Exhausted Keys** | Dumping nearly-dead keys at end of day | Rate limit header inspection + automatic 80% demotion | `KeySelector.ts` |
| **Sybil Swarms** | Creating multiple accounts for free quota | GitHub maturity gate ($\ge 30$ days, $\ge 5$ commits) + Turnstile | `auth_gate.ts` |
| **Toxic Prompts** | Banning others' keys via malicious prompts | Edge Llama-Guard pre-flight filter + cryptographic audit log | `proxy_handler.ts` |
| **Token Bombs** | Asymmetric 1M token context draining | TPM-weighted Credit Unit pricing + token bucket metering | `valuation.ts` |
| **Key Leakage** | Extracting keys via error reflections | Automatic regex redactor stream on all error responses | `sse_transformer.ts` |

---

## 4. Key Collective Terms of Use & Contributor Agreement

> [!IMPORTANT]
> The following terms are presented to every user during onboarding and must be accepted via an explicit clickwrap checkbox before communal pool features can be unlocked.

### 1. Nature of Service & Zero Commercial Consideration
Key Collective is an open-source, non-monetized developer utility and mutual key-management commons deployed across edge serverless infrastructure. Key Collective is provided **entirely free of charge ($0.00)**. There are no paid tiers, no subscriptions, no token sales, and no financial transactions. Access to the communal pool is governed solely by reciprocal resource contribution, not monetary payment.

### 2. Tier Boundaries & Reciprocal Gating
* **2.1 Builder Tier (Private Mode):** Users on the Builder Tier utilize Key Collective strictly as a personal client-side key manager and local multiplexer. Builder Tier keys are never shared, pooled, or accessed by any other user.
* **2.2 Verified Collector Tier (Communal Mode):** Users who voluntarily link a verified GitHub account and contribute active, valid API keys participate in the Reciprocal Commons.
* **2.3 "Eye-for-an-Eye" Reciprocity:** You may only access communal pool capacity for specific AI providers to which you actively contribute verified, working API keys. If you withdraw, disable, or invalidate your keys for a given provider, your access to that provider's communal pool terminates immediately.

### 3. Contributor Representations & Dedicated Project Requirement
By contributing any API key or credential to Key Collective, you explicitly represent and warrant:
1. You are the lawful registrant and authorized holder of the API credential.
2. You have generated the credential on an **isolated, dedicated sandbox project** (e.g. a dedicated Google AI Studio project) and not on a project hosting active production, enterprise, or personal infrastructure.
3. Your contribution does not violate any employment agreement, contract, or third-party right.
4. You acknowledge that third-party AI providers (including Google, Groq, Cerebras, and others) maintain Terms of Service that may restrict, limit, or prohibit credential sharing, proxying, or rate limit aggregation.
5. You independently assume all risks associated with third-party Terms of Service compliance.

### 4. Technical Agency & Limited Power of Attorney
By submitting an API key to the communal pool, you hereby grant Key Collective and its automated edge actors a limited, revocable, non-exclusive license and technical power of attorney to:
1. Encrypt and store your key in ephemeral secure storage.
2. Dispatch programmatic inference queries through your API key on your behalf and on behalf of verified members of the reciprocal commons.
3. Monitor key health, rate limits, and latency via automated canary probes.
4. Quarantine or remove your key from rotation immediately upon detecting authentication failure or provider rate limits.

### 5. Prohibited Conduct & Instant Termination
You agree not to:
1. Submit expired, revoked, invalid, or intentionally exhausted API credentials.
2. Transmit prompts containing Child Sexual Abuse Material (CSAM), cyberweapons, automated malware, unauthorized surveillance scripts, or payloads violating applicable criminal law.
3. Attempt to reverse engineer, inspect, or extract API credentials belonging to other participants.
4. Automate registration of multiple accounts via headless scripts, VPNs, or burner identities.

> [!WARNING]
> Violation of this section results in immediate, permanent termination of your account, blocking of your GitHub identity and IP range, and immediate purging of your keys.

### 6. Provider Enforcement & Cooperation
Key Collective operates in complete good-faith cooperation with AI providers. Key Collective reserves the absolute right, in its sole discretion and without prior notice or liability:
1. To immediately remove any or all keys belonging to any provider upon receipt of a provider communication, cease-and-desist, or inquiry.
2. To deploy a runtime kill-switch reverting any provider to private-only mode.
3. To cooperate with provider abuse inquiries regarding criminal or toxic prompt injections.

### 7. Absolute Disclaimer of Warranties
The service and pooled infrastructure are provided strictly **"AS IS" and "AS AVAILABLE"**. Key Collective, its maintainers, contributors, and hosting operators expressly disclaim all warranties of any kind, whether express, implied, or statutory, including warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not guarantee that upstream API keys will remain valid, that service will be uninterrupted, or that upstream providers will not revoke keys or suspend accounts.

### 8. Complete Limitation of Liability
To the maximum extent permitted by law, in no event shall Key Collective, its creators, maintainers, or operators be liable for any direct, indirect, incidental, special, consequential, or punitive damages, including loss of API access, termination of third-party developer accounts, loss of data, or service interruptions.

Because Key Collective is entirely non-commercial and operated at zero cost, Key Collective's total aggregate liability to you for any and all claims shall not exceed **zero dollars ($0.00)**.

### 9. Indemnification by Participants
You agree to defend, indemnify, and hold harmless Key Collective, its maintainers, developers, and operators from and against any claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising out of or in any way connected with:
1. Your breach of this Agreement.
2. Your violation of any third-party API provider's Terms of Service.
3. Any prompts or content you transmit through the service.
4. Any dispute between you and an upstream AI provider.

### 10. Severability & Builder Tier Isolation
If any provision of this Agreement or any portion of the communal pooling feature is deemed unlawful, void, or unenforceable, that specific provision or feature shall be severed without affecting the validity and enforceability of the remaining provisions. Specifically, the Builder Tier (private self-hosted key multiplexer) shall remain fully operative regardless of any legal or operational determination regarding the communal pool.
