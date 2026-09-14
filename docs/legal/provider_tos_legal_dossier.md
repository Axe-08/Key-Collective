# Master Legal Dossier: AI API Terms of Service & Multi-Key Pooling Analysis
## Comprehensive Primary-Source Review of 10 AI Inference Providers

> **Document Type:** Legal & Compliance Evidence Dossier  
> **Target System:** Key Collective (Cloudflare Edge Multi-Tenant Commons)  
> **Effective Date:** September 2026  
> **Status:** Verified Primary-Source Audit

---

## 1. Scope & Objective

This document audits the Terms of Service across 10 major AI inference providers to evaluate the contractual risks of API key pooling, multi-account creation, and proxy routing.

### Key Risk Dimensions Audited:
1. **Credential Sharing:** Whether API keys are restricted to the registered individual or entity.
2. **Quota Circumvention:** Whether aggregating multiple accounts or keys violates fair use or rate limit terms.
3. **Proxying & Reselling:** Whether operating a reverse proxy or intermediary gateway violates sublicensing clauses.
4. **Enforcement Reality:** What actions providers take in practice (automated key revocation vs. account suspension vs. passive rate limiting).

---

## 2. Summary Comparison Matrix

| Provider | Key Sharing Clause | Quota Circumvention Clause | Proxy / Resale Clause | Practical Enforcement Posture | Risk Level |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Google AI Studio** | Prohibited (§4e) | Prohibited (§4d) | Prohibited (§4b) | Automated key revocation; project-level rate limits | 🔴 **HIGH** |
| **Mistral AI** | Prohibited (§2.2h) | Prohibited (§2.2f) | Prohibited (§2.2i) | SMS verification on signup; active enforcement | 🔴 **HIGH** |
| **OpenRouter** | Prohibited (§3.2) | Prohibited (§3.2b) | Prohibited (§3.2a) | Aggressive botnet & fingerprint detection on `:free` | 🔴 **HIGH** |
| **Cloudflare Workers AI** | Restricted (§2.3) | Prohibited (§2.2.1e)| Prohibited (§2.2.1j)| Hard error 3036 at 10k Neurons; developer friendly | 🟡 **MEDIUM** |
| **GroqCloud** | Org-level bounds | Prohibited (§1) | Prohibited (§1) | Algorithmic rate limiting with `retry-after` header | 🟡 **MEDIUM** |
| **NVIDIA NIM** | Non-production only | Prohibited (§F) | Prohibited (§E) | Non-renewable 1,000 credit ceiling; self-limiting | 🟡 **MEDIUM** |
| **Cohere** | Prohibited | Prohibited | Prohibited | Hard 1,000 calls/month ceiling | 🟡 **MEDIUM** |
| **Cerebras Cloud** | Confidentiality | Prohibited | **Explicitly Permitted (§b)**| Hardware rate limiting; very developer friendly | 🟢 **LOW-MED** |
| **SambaNova Cloud** | Confidentiality | Prohibited | Partner required | Dynamic queue throttling; developer friendly | 🟢 **LOW-MED** |
| **Voyage AI** | Confidentiality | Prohibited | Application use | Permissive 200M token grant; low enforcement | 🟢 **LOW** |

---

## 3. Provider-by-Provider Legal Findings

---

### 1. Google AI Studio (Gemini Developer API)

* **Governing Documents:** [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) & [Google APIs Terms of Service](https://developers.google.com/terms)
* **Effective Date:** Active 2026

#### Credential Confidentiality
> *"Developer credentials (such as passwords, keys, and client IDs) are intended to be used by you and identify your API Client. You will keep your credentials confidential and make reasonable efforts to prevent and discourage other API Clients from using your credentials."* (§4e)

#### Quota Circumvention
> *"You agree to, and will not attempt to circumvent, such limitations documented with each API."* (§4d)  
> *"You will not misrepresent or mask either your identity or your API Client's identity when using the APIs or API accounts."* (§4a)

#### Sublicensing & Proxying
> *"When using the APIs, you may not (or allow those acting on your behalf to): Sublicense an API for use by a third party."* (§4b)

#### Enforcement Realities
* **Automated Scanners:** Google scans public GitHub repositories and revokes exposed keys within minutes.
* **Project Boundary:** Free quotas (15 RPM / 1,500 RPD) are enforced per Google Cloud Project.
* **Blast Radius:** Keys provisioned via Google AI Studio reside in auto-generated sandbox GCP projects. Revocation impacts that specific sandbox project, not the user's primary personal Google account or production GCP workloads.

---

### 2. GroqCloud (Groq LPU Inference)

* **Governing Documents:** [Groq Terms of Use](https://groq.com/terms-of-use/) & [Rate Limits Spec](https://console.groq.com/docs/rate-limits)
* **Effective Date:** October 2025 / Active 2026

#### Key Sharing & Rate Limits
* Rate limits apply strictly at the **organization level**, not to individual users.
* Credentials and accounts are non-transferable under Section 1.

#### Circumvention & Proxying
> *"If you are not permitted to access the Websites or your IP address has been blocked, you agree not to circumvent or attempt to circumvent such blocking, including by masking your IP address or using a proxy IP address."*  
> *"You agree not to copy, modify, or create a derivative work of, sell, resell, sublicense, transfer, or distribute any content on the Websites, in whole or in part."*

#### Enforcement Realities
* **Algorithmic:** Groq relies on deterministic rate limit headers (`x-ratelimit-remaining-*`) and returns standard HTTP `429 Too Many Requests` with a `retry-after` header when limits are reached.
* Groq actively welcomes third-party proxy tools (LiteLLM, OpenRouter) and does not police BYOK developer gateways.

---

### 3. Cerebras Cloud (Wafer-Scale Inference)

* **Governing Documents:** [Cerebras Terms of Use](https://cerebras.ai/terms-of-service/) & [Inference Docs](https://cloud.cerebras.ai/terms)
* **Effective Date:** August 2024 / Active 2026

#### Credential Security
> *"You shall keep your User Account password(s) and any other authentication credentials secure, and you shall not share your password(s) or any other authentication credentials with anyone else, or otherwise transfer your User Account to anyone else."*

#### The Application Integration License (Safe Harbor)
> Cerebras explicitly grants a license to:  
> *(a) use the APIs to develop, test and support your applications,*  
> *(b) **distribute or allow access to your integration of the APIs within your applications to end users of such applications**, and*  
> *(c) display the Outputs received from the APIs within your application, provided that you have a valid API key.*

#### Enforcement Realities
* Cerebras is the most legally hospitable provider in the entire ecosystem.
* Clause (b) explicitly authorizes distributing access to the API integration to downstream end users.
* Rate limits are enforced deterministically in hardware (30 RPM and dual-bucket 30k uncached / 90k cached TPM).

---

### 4. SambaNova Cloud (Reconfigurable Dataflow Units)

* **Governing Documents:** [SambaNova Legal Agreements](https://sambanova.ai/legal-agreements) & [Privacy Policy](https://sambanova.ai/privacy-policy)
* **Effective Date:** Active 2026

#### Key Terms
* Standard evaluation terms. Access credentials are non-assignable.
* Reselling raw compute without an Enterprise agreement is restricted.

#### Enforcement Realities
* SambaNova manages high load via dynamic datacenter queue throttling (increasing TTFT) rather than legal crackdowns or account suspensions.
* Highly permissive for open-weights developers (offering 240 RPM on Llama 3.3 70B).

---

### 5. Mistral AI (La Plateforme)

* **Governing Documents:** [Commercial Terms of Service](https://legal.mistral.ai/terms/commercial-terms-of-service) & [Usage Policy](https://legal.mistral.ai/terms/usage-policy)
* **Effective Date:** August 5, 2026

#### Explicit Prohibition on Key Trading & Third-Party Access
> *"Customer will not, and will not permit any other person (including any End User) to:*  
> *(h) **buy, sell, or transfer API keys or any type of Mistral AI account from, to, or with a third party;** or*  
> *(i) **grant any third party access to the Mistral AI Products without our prior written authorization**..."* (§2.2)

#### Enforcement Realities
* Mandatory SMS/phone verification on account registration prevents automated multi-accounting.
* Mistral has the strictest, most explicit anti-transfer language in the industry.
* **Recommendation:** Keep Mistral keys strictly in the private `Builder` tier; do not pool communally.

---

### 6. OpenRouter

* **Governing Documents:** [OpenRouter Terms of Service](https://openrouter.ai/terms) & [Limits Guide](https://openrouter.ai/docs/limits)
* **Effective Date:** August 31, 2026

#### Proxying & Circumvention
> *"You agree not to... use the Service in conjunction [with] any other third-party tools to access Restricted Models, including without limitation by using virtual private networks and proxies; or circumvent safeguards or measures implemented by OpenRouter or Model Providers designed to restrict access to Restricted Models."* (§3.2)

#### Enforcement Realities
* OpenRouter aggressively defends its `:free` tier (50 RPD limit) with browser fingerprinting and IP heuristics.
* Multi-account botnet farming is detected and banned automatically.
* **Recommendation:** Do not pool OpenRouter free keys.

---

### 7. NVIDIA NIM (build.nvidia.com)

* **Governing Documents:** [Product Specific Terms for AI Products](https://www.nvidia.com/en-us/agreements/enterprise-software/product-specific-terms-for-ai-products/)
* **Effective Date:** April 15, 2026

#### Evaluation-Only Scope & Multi-User Prohibition
> *"Software offered as part of the developer program is not for use, distribution or deployment in production. Customer will not include developer program Software in a Customer Product."* (§F)  
> *"...and not used in a commercial kiosk, server or other system used to service multiple users."* (§E)

#### Enforcement Realities
* Developer accounts receive a non-renewable trial grant of 1,000 credits. Once consumed, the key expires permanently.
* Communal pooling is unviable over the long term without continuously registering new accounts (which breaches terms).

---

### 8. Cohere

* **Governing Documents:** [Cohere Terms of Use](https://cohere.com/terms-of-use)
* **Effective Date:** Active 2026

#### Service Bureau Restriction
* Explicitly prohibits using the API as a service bureau, timesharing service, or unintegrated resale gateway.
* Free trial keys are limited to 1,000 requests per month. Access is automatically suspended at request 1,001 until the calendar month rolls over.

---

### 9. Voyage AI

* **Governing Documents:** [Voyage AI Terms & Pricing](https://docs.voyageai.com/docs/pricing)
* **Effective Date:** Active 2026

#### Terms & Enforcement
* Generous 200M free token grant for general embeddings.
* 2,000 RPM base organization rate limit.
* Permissive developer posture; minimal enforcement history against developer proxies.

---

### 10. Cloudflare Workers AI

* **Governing Documents:** [Cloudflare Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/)
* **Effective Date:** September 12, 2025

#### Terms & Enforcement
> Prohibits attempting to *"circumvent Service-specific usage limits, quotas, or other restrictions"* (§2.2.1c) or *"introducing automated agents or scripts to produce multiple accounts"* (§2.2.1e).
* Cloudflare mathematically enforces its free tier: 10,000 Neurons per day, returning `Error 3036: Neuron daily limit reached` when exhausted.
* Cloudflare actively supports building AI gateways and proxies on Workers.
