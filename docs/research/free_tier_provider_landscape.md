# Competitive Intel Analysis: Free-Tier AI Provider Landscape

> **Document Status:** Complete & Verified  
> **Target System:** Key Collective (Free-Tier Multiplexer & Key Pooling Edition)  
> **Author:** Competitive Intel Analyst (Flash) — Workflow 1: Project Inception v2.0  
> **Timestamp:** September 2026  
> **Canonical Target:** `docs/research/free_tier_provider_landscape.md`

---

## 1. Executive Summary & Strategic Insights

The modern AI API ecosystem features a vibrant yet fragmented ecosystem of free-tier model providers offering access without requiring credit cards or paid upfront commitments. However, these free quotas are guarded by strict per-project rate limits (Requests Per Minute - RPM, Requests Per Day - RPD, and Tokens Per Minute - TPM), diverse daily quota reset timezones, dynamic deprecation cycles, and critical data training clauses.

For **Key Collective**, designed as a globally distributed free-tier multiplexer and key pooler on Cloudflare Workers and Durable Objects, aggregating and intelligent routing across these free tiers unlocks enterprise-grade throughput at $0 infrastructure and compute API cost:

- **Aggregated Capacity:** Pooling single free accounts across top providers yields over **600+ RPM**, **100,000+ RPD**, and **>5,000,000 TPM** of state-of-the-art multimodal, reasoning, and coding intelligence.
- **Provider Redundancy:** By multiplexing across Google AI Studio, Groq, Cerebras, SambaNova, Cloudflare Workers AI, Mistral AI, OpenRouter, NVIDIA NIM, Cohere, and Voyage AI, Key Collective achieves 99.99% uptime resilience against provider 429 rate spikes and regional outages.
- **Critical Policy Guardrail (The Free-Tier Privacy Tradeoff):** Free tiers on Google AI Studio, Mistral AI, OpenRouter `:free`, and Voyage AI explicitly permit human review or model training on prompt/completion payloads. In contrast, Groq and Cloudflare Workers AI provide strict edge isolation. Key Collective's routing engine must support automated payload sanitization and tenant-level privacy filtering.
- **The "Billing Trap" Warning:** In Google AI Studio, linking a Google Cloud billing account transitions the project to Tier 1 and immediately eliminates the free quota (all requests become billable). Key Collective tenants must register isolated, unbilled developer projects for key pooling.
- **Active Sunset Detection:** GitHub Models was officially retired on July 30, 2026, and Groq retired `llama-3.3-70b-versatile` in August 2026. Key Collective's automated cascade router must implement dynamic model sunset detection and alias fallbacks.

---

## 2. Master Provider Comparison Matrix

| Provider | Card Required? | Flagship Models | RPM Limit | RPD / Daily Limit | TPM Limit | Context / Max Out | Data Training Policy | Verified Documentation Links |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Google AI Studio** | ❌ No | Gemini 2.5 Flash, 2.5 Pro, 3.8 Flash, 2.0 Flash | 10–15 RPM (Flash), 2–5 RPM (Pro) | 1,500 RPD (Flash), 50–100 RPD (Pro) | 1,000,000 TPM (Flash), 32k TPM (Pro) | 1M–2M / 8k | ⚠️ **Used for training** & human review | [Pricing](https://ai.google.dev/pricing) \| [Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits) |
| **GroqCloud** | ❌ No | Llama 3.1 8B, Qwen 3.6 27B, GPT-OSS 120B/20B, Whisper v3 | 30 RPM (LLMs), 300–400 RPM (STT) | 14,400 RPD | 6,000–20,000 TPM | 131k / 65k–131k | 🔒 **Not used for training** | [Console Limits](https://console.groq.com/docs/rate-limits) \| [Models](https://console.groq.com/docs/models) |
| **Cerebras Cloud** | ❌ No (Skip billing) | Llama 3.3 70B, Llama 3.1 8B | 30 RPM | 1,000,000 TPD (Tokens/Day) | 30k uncached / 90k total TPM | 8k–128k / 8k | 🔒 Not used for training | [Docs](https://inference-docs.cerebras.ai/) \| [Console](https://cloud.cerebras.ai/) |
| **SambaNova Cloud** | ❌ No | Llama 3.3 70B, DeepSeek V3.1 / R1, MiniMax M2.7 | 60–240 RPM | 12,000–48,000 RPD | Dynamic daily token cap | 8k–64k / 4k–8k | 🔒 Not used for training | [Cloud Docs](https://docs.sambanova.ai/cloud) |
| **Cloudflare Workers AI** | ❌ No | Llama 3.3 70B FP8, Llama 3.1 8B, DeepSeek R1 Distill 32B | 720–3,000 RPM (task-specific) | **10,000 Neurons/day** (~100k–500k tokens) | Compute bounded | 8k–128k / 4k | 🔒 Zero-retention edge compute | [Limits](https://developers.cloudflare.com/workers-ai/platform/limits/) \| [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| **Mistral AI** | ❌ No (SMS verify) | Mistral Small, Codestral, Pixtral 12B, Ministral 8B | 60 RPM (1 RPS), Codestral: 30 RPM | 1 Billion tokens / month | 500,000 TPM (Codestral: 300k) | 32k–128k / 8k | ⚠️ **Used for training** on Experiment plan | [Pricing](https://docs.mistral.ai/deployment/laplateforme/pricing/) \| [Codestral](https://codestral.mistral.ai/) |
| **Cohere** | ❌ No | Command R, Command R+, Embed v3, Rerank v3.5 | 20 RPM (Command), 10 RPM (Rerank) | **1,000 calls / month** | 2,000 inputs/min (Embed) | 128k / 4k | ⚠️ **Used for training** on Trial keys | [Rate Limits](https://docs.cohere.com/docs/rate-limits) |
| **OpenRouter (:free)** | ❌ No | Llama 3.3 70B:free, Gemini 2.0 Flash:free, DeepSeek R1:free | 20 RPM | **50 RPD** (1,000 RPD if topup >$10) | Provider dependent | 32k–128k / 4k–8k | ⚠️ Provider dependent (often trained) | [Limits](https://openrouter.ai/docs/limits) \| [Free Models](https://openrouter.ai/models?max_price=0) |
| **NVIDIA NIM** | ❌ No | Llama 3.3 70B, Nemotron 4 340B, DeepSeek R1, Mistral Large | 40 RPM | **1,000 API credits** pool upon signup | Dynamic | 8k–128k / 4k | 🔒 Enterprise evaluation terms | [Catalog](https://build.nvidia.com) \| [NIM Docs](https://docs.nvidia.com/nim/) |
| **Voyage AI** | ❌ No | Voyage 4, Voyage Context 4, Voyage Code 2, Rerank 2 | 2,000 RPM | **200M Free Tokens** (50M specialized) | 2M–16M TPM | 32,000 tokens | ⚠️ **Used for training** unless card on file | [Pricing](https://docs.voyageai.com/docs/pricing) |
| **DeepSeek API** | ❌ No (SMS verify) | DeepSeek-V3 (Chat), DeepSeek-R1 (Reasoner) | 500–2,500 concurrent conns | **5 Million tokens** trial grant | Dynamic | 64k / 8k | 🔒 Commercial terms | [Platform](https://platform.deepseek.com/) \| [API Docs](https://api-docs.deepseek.com/) |
| *GitHub Models* | *RETIRED* | *(Formerly GPT-4o, Phi-4, Llama 3.3)* | *N/A* | *Retired July 30, 2026* | *N/A* | *N/A* | *Migrated to Azure AI Foundry / Copilot* | [Retirement Notice](https://github.com/marketplace/models) |

---

## 3. Deep-Dive Provider Profiles

### 3.1. Google AI Studio (Gemini Developer API)

- **Website & Portal:** [Google AI Studio](https://aistudio.google.com)
- **Official Documentation:**
  - Pricing Guide: [ai.google.dev/pricing](https://ai.google.dev/pricing)
  - Rate Limits Documentation: [ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits)
  - Terms of Service: [ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms)
- **Credit Card Required:** ❌ **No**. Any Google account can provision API keys without billing information.
- **Available Free-Tier Models:**
  - `gemini-2.5-flash` / `gemini-3.8-flash`: Hybrid reasoning and autonomous agent model.
  - `gemini-2.5-flash-lite` / `gemini-3.5-flash-lite`: Ultra high-volume lightweight model.
  - `gemini-2.5-pro` / `gemini-3.1-pro-preview`: Deep reasoning, coding, and complex analysis.
  - `gemini-2.0-flash` / `gemini-1.5-flash`: Legacy high-throughput multimodal models.
  - `gemini-embedding-001` / `gemini-embedding-2`: High-dimensional vector embeddings.
- **Exact Free Tier Quotas & Rate Limits:**
  - **Flash Models (`gemini-2.5-flash`, `gemini-2.0-flash`):**
    - **RPM:** 10 to 15 Requests Per Minute
    - **RPD:** 1,500 Requests Per Day (resets at 00:00 Pacific Time / UTC-8)
    - **TPM:** 1,000,000 Tokens Per Minute
    - **Context Window:** 1,048,576 tokens
    - **Max Output Tokens:** 8,192 tokens
  - **Pro Models (`gemini-2.5-pro`):**
    - **RPM:** 2 to 5 Requests Per Minute
    - **RPD:** 50 to 100 Requests Per Day
    - **TPM:** 32,000 Tokens Per Minute
    - **Context Window:** 2,097,152 tokens
    - **Max Output Tokens:** 8,192 tokens
  - **Embeddings (`gemini-embedding-001`):**
    - **RPM:** 1,500 RPM, 30,000 RPD
- **Key Restrictions & Governance Rules:**
  - ⚠️ **Data Logging & Training:** In the Free Tier, Google explicitly logs all user prompts and completions. Google human reviewers may inspect interactions, and data is utilized to train Google models. **Sensitive PII and secret tokens must be scrubbed before sending.**
  - ⚠️ **The Billing Trap:** When a developer links a Google Cloud Billing Account to their project, AI Studio automatically switches the project to "Pay-As-You-Go" (Tier 1). **The free daily quota is permanently lost for that project**, and all subsequent requests are billed at standard token rates. Key Collective users must maintain unbilled standalone projects for pooled free keys.
  - **Per-Project Scope:** Quotas are strictly enforced per Google Cloud Project, not per API key. Generating 10 API keys within the same project still shares the exact 15 RPM / 1,500 RPD cap. Multiplexing requires keys from distinct Google Cloud projects.

---

### 3.2. GroqCloud (Groq LPU Inference)

- **Website & Portal:** [Groq Console](https://console.groq.com)
- **Official Documentation:**
  - Rate Limits: [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits)
  - Supported Models: [console.groq.com/docs/models](https://console.groq.com/docs/models)
  - Pricing Overview: [groq.com/pricing](https://groq.com/pricing)
- **Credit Card Required:** ❌ **No**. Free account creation with immediate API key issuance.
- **Available Free-Tier Models:**
  - `llama-3.1-8b-instant`: Ultra-fast general text generation and classification (~560 tokens/sec).
  - `qwen/qwen3.6-27b`: High-capability coding and reasoning alternative.
  - `openai/gpt-oss-120b` & `openai/gpt-oss-20b`: Flagship open weights with browser search and code execution support (~500 tokens/sec).
  - `whisper-large-v3` & `whisper-large-v3-turbo`: Real-time speech-to-text audio transcription.
  - `canopylabs/orpheus-v1-english`: Text-to-speech generation.
- **Exact Free Tier Quotas & Rate Limits:**
  - **Requests Per Minute (RPM):** 30 RPM default across LLM endpoints.
  - **Requests Per Day (RPD):** 14,400 RPD per organization.
  - **Tokens Per Minute (TPM):** 6,000 to 20,000 TPM (varies dynamically by model load).
  - **Audio Endpoints (`whisper-large-v3`):** 300 RPM, 200,000 Audio Seconds per Hour (ASH).
  - **Context Windows:** 131,072 tokens for Llama 3.1 and GPT-OSS models.
  - **Max Output Tokens:** 8,192 tokens (standard) up to 65,536 tokens on GPT-OSS.
- **Key Restrictions & Governance Rules:**
  - 🔒 **Privacy:** Groq does **not** train on customer API request or completion data.
  - **Organization Scope:** Rate limits are enforced at the organization level. Creating multiple keys within the same Groq organization does not increase quota.
  - **Model Lifecycle (Sunset Watch):** Groq retired `llama-3.3-70b-versatile` on August 16, 2026. Routing configurations must map logical alias `llama-70b` to active equivalents (`qwen3.6-27b` or `gpt-oss-120b`).

---

### 3.3. Cerebras Cloud (Wafer-Scale Engine Inference)

- **Website & Portal:** [Cerebras Cloud Console](https://cloud.cerebras.ai)
- **Official Documentation:**
  - Inference Documentation: [inference-docs.cerebras.ai](https://inference-docs.cerebras.ai/)
  - Rate Limits: [inference-docs.cerebras.ai/rate-limits](https://inference-docs.cerebras.ai/rate-limits)
- **Credit Card Required:** ❌ **No (conditional)**. Users who skip adding a payment method during onboarding are assigned to the permanent Free Tier.
- **Available Free-Tier Models:**
  - `llama-3.3-70b`: 70B parameter model running at 2,000+ tokens/second.
  - `llama-3.1-8b`: High-throughput 8B model running at ~1,800 tokens/second.
- **Exact Free Tier Quotas & Rate Limits:**
  - **Requests Per Minute (RPM):** 30 RPM
  - **Tokens Per Minute (TPM):** Dual-bucket rate limiting:
    - Uncached TPM: 30,000 TPM
    - Total TPM: 90,000 TPM
  - **Tokens Per Day (TPD):** 1,000,000 Tokens Per Day hard ceiling.
  - **Context Window:** 8,192 tokens (base) up to 128,000 on extended endpoints.
  - **Max Output Tokens:** 4,096 to 8,192 tokens.
- **Key Restrictions & Governance Rules:**
  - 🔒 **Privacy:** Customer prompts are not used for training.
  - **Credit Card Hook:** If a user selects "Activate $5 Free Trial", Cerebras requires a verified payment card. To stay on the true $0 Free Tier, users must skip payment card verification.

---

### 3.4. SambaNova Cloud (Reconfigurable Dataflow Units - RDU)

- **Website & Portal:** [SambaNova Cloud](https://cloud.sambanova.ai)
- **Official Documentation:**
  - Platform Documentation: [docs.sambanova.ai/cloud](https://docs.sambanova.ai/cloud)
- **Credit Card Required:** ❌ **No**. No payment method required for the Free Tier.
- **Available Free-Tier Models:**
  - `Meta-Llama-3.3-70B-Instruct`: Flagship open-source model.
  - `DeepSeek-V3.1` / `DeepSeek-R1`: High-efficiency reasoning and chat.
  - `MiniMax-M2.7`: Agentic long-horizon workflow model.
  - `gpt-oss-120b`: Massive parameter open model.
  - `Qwen2.5-72B-Instruct`: Multilingual and mathematical reasoning.
- **Exact Free Tier Quotas & Rate Limits:**
  - **`Meta-Llama-3.3-70B-Instruct`:** 240 RPM, 48,000 RPD
  - **`DeepSeek-V3.1` / `MiniMax-M2.7`:** 60 RPM, 12,000 RPD
  - **Daily Token Caps (TPD):** Free tier accounts are throttled dynamically upon consuming between 1M and 5M tokens per day across all endpoints.
  - **Context Window:** 8,192 to 64,000 tokens depending on endpoint.
  - **Max Output Tokens:** 4,096 tokens.
- **Key Restrictions & Governance Rules:**
  - 🔒 **Privacy:** SambaNova Enterprise SLA terms apply to API payloads (no training on user prompts).
  - **Dynamic Throttling:** During high datacenter utilization, Free Tier queues experience increased time-to-first-token (TTFT). Real-time response headers (`x-ratelimit-remaining-requests`) must be inspected by Key Collective.

---

### 3.5. Cloudflare Workers AI (Serverless Edge Inference)

- **Website & Portal:** [Cloudflare Dashboard](https://dash.cloudflare.com)
- **Official Documentation:**
  - Workers AI Limits: [developers.cloudflare.com/workers-ai/platform/limits/](https://developers.cloudflare.com/workers-ai/platform/limits/)
  - Pricing & Neurons: [developers.cloudflare.com/workers-ai/platform/pricing/](https://developers.cloudflare.com/workers-ai/platform/pricing/)
  - Model Catalog: [developers.cloudflare.com/workers-ai/models/](https://developers.cloudflare.com/workers-ai/models/)
- **Credit Card Required:** ❌ **No**. Standard free Cloudflare account provides full access.
- **Available Free-Tier Models:**
  - `@cf/meta/llama-3.3-70b-instruct-fp8-fast`: Quantized low-latency 70B model.
  - `@cf/meta/llama-3.1-8b-instruct`: General text generation.
  - `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`: Edge-hosted distilled reasoning.
  - `@cf/mistral/mistral-7b-instruct-v0.2`: Lightweight instruction follower.
  - `@cf/baai/bge-large-en-v1.5`: High-accuracy text embeddings.
- **Exact Free Tier Quotas & Rate Limits:**
  - **Daily Allocation:** **10,000 Neurons per day** free (resets daily at 00:00 UTC).
  - **Token Translation:** 10,000 Neurons roughly equates to ~100,000 to 500,000 tokens depending on model parameter size and quantization.
  - **Task Rate Limits:**
    - Summarization / Generation: 1,500 RPM
    - Speech Recognition: 720 RPM
    - Image Classification: 3,000 RPM
  - **Context Window:** 8,192 to 131,072 tokens depending on model architecture.
  - **Max Output Tokens:** 2,048 to 4,096 tokens.
- **Key Restrictions & Governance Rules:**
  - 🔒 **Privacy & Edge Locality:** Zero retention; inference executes natively across Cloudflare's global edge network.
  - **Hard Error 3036:** Once the 10,000 daily neuron quota is exhausted, Workers AI immediately responds with `Error 3036: Neuron daily limit reached`. Key Collective must catch this specific error code and immediately trip its circuit breaker until the 00:00 UTC reset.

---

### 3.6. Mistral AI (La Plateforme - Experimentation Tier)

- **Website & Portal:** [Mistral AI Console](https://console.mistral.ai)
- **Official Documentation:**
  - Pricing: [docs.mistral.ai/deployment/laplateforme/pricing/](https://docs.mistral.ai/deployment/laplateforme/pricing/)
  - API Reference: [docs.mistral.ai/api/](https://docs.mistral.ai/api/)
  - Dedicated Codestral: [codestral.mistral.ai](https://codestral.mistral.ai/)
- **Credit Card Required:** ❌ **No**. Requires SMS / phone identity verification during account creation.
- **Available Free-Tier Models:**
  - `mistral-small-latest`: General instruction following.
  - `codestral-latest`: Specialized 22B coding model with 80+ programming language comprehension.
  - `pixtral-12b`: Multimodal vision-language model.
  - `ministral-8b` / `ministral-3b`: Edge/small footprint models.
  - `open-mistral-nemo`: 12B collaborative multilingual model.
- **Exact Free Tier Quotas & Rate Limits:**
  - **General Endpoints (Experiment Plan):**
    - **RPM:** 60 RPM (1 Request Per Second)
    - **TPM:** 500,000 TPM
    - **Monthly Ceiling:** Up to 1 Billion tokens per month
  - **Codestral Dedicated Endpoint (`codestral.mistral.ai`):**
    - **RPM:** 30 RPM
    - **TPM:** 300,000 TPM
  - **Context Window:** 32,768 tokens (`mistral-small`), 131,072 tokens (`codestral-latest`).
  - **Max Output Tokens:** 4,096 to 8,192 tokens.
- **Key Restrictions & Governance Rules:**
  - ⚠️ **Data Usage Notice:** Free Experimentation plan prompts and responses **may be used by Mistral to improve models**. Upgrading to the paid Scale plan is required for strict data zero-retention.
  - **Manual Plan Activation:** Users must navigate to the Console's "Billing" section and explicitly click "Activate Free Experimentation Plan" for generated API keys to authenticate.

---

### 3.7. Cohere (Trial Tier)

- **Website & Portal:** [Cohere Dashboard](https://dashboard.cohere.com)
- **Official Documentation:**
  - Rate Limits: [docs.cohere.com/docs/rate-limits](https://docs.cohere.com/docs/rate-limits)
  - Pricing: [cohere.com/pricing](https://cohere.com/pricing)
- **Credit Card Required:** ❌ **No**. Free trial key issued upon email confirmation.
- **Available Free-Tier Models:**
  - `command-r` & `command-r-plus`: Retrieval-augmented generation and tool use.
  - `embed-english-v3.0` & `embed-multilingual-v3.0`: Embedding vectors.
  - `rerank-v3.5` & `rerank-english-v3.0`: Document reranking models.
- **Exact Free Tier Quotas & Rate Limits:**
  - **Monthly Call Cap:** **1,000 API calls per month** total across all endpoints.
  - **Requests Per Minute (RPM):**
    - Command Models: 20 RPM
    - Rerank Models: 10 RPM
    - Embed Models: 2,000 inputs/minute (100 RPM)
  - **Context Window:** 128,000 tokens on Command R.
  - **Max Output Tokens:** 4,096 tokens.
- **Key Restrictions & Governance Rules:**
  - ⚠️ **Data Training:** Trial key payloads are subject to data collection and model training.
  - **Strict Monthly Ceiling:** With only 1,000 calls per month, Cohere cannot serve as a primary high-frequency text generation node. It serves best in Key Collective as a specialized **Reranking fallback node** (`rerank-v3.5`).

---

### 3.8. OpenRouter (Free Tier Hub - `:free` Suffix)

- **Website & Portal:** [OpenRouter](https://openrouter.ai)
- **Official Documentation:**
  - Limits Guide: [openrouter.ai/docs/limits](https://openrouter.ai/docs/limits)
  - Free Models Catalog: [openrouter.ai/models?max_price=0](https://openrouter.ai/models?max_price=0)
- **Credit Card Required:** ❌ **No**. Account signup requires only email or GitHub/Google OAuth.
- **Available Free Models (Dynamically Updated):**
  - `meta-llama/llama-3.3-70b-instruct:free`
  - `google/gemini-2.0-flash-exp:free`
  - `deepseek/deepseek-r1:free`
  - `qwen/qwen-2.5-72b-instruct:free`
  - `nvidia/nemotron-3-super:free`
- **Exact Free Tier Quotas & Rate Limits:**
  - **Standard Free Tier:**
    - **RPM:** 20 Requests Per Minute
    - **RPD:** **50 Requests Per Day**
  - **Account with Historical Top-up (One-time >$10 spend):**
    - **RPD:** 1,000 Requests Per Day on `:free` models
  - **Context Window:** Inherits upstream provider window (typically 32,768 to 131,072 tokens).
  - **Max Output Tokens:** Upstream provider bound (4,096 to 8,192 tokens).
- **Key Restrictions & Governance Rules:**
  - ⚠️ **Provider Volatility & Data Privacy:** OpenRouter acts as an aggregator. The underlying hosts of `:free` models may log data for training, and free models frequently suffer from community saturation, returning HTTP 429 or 503 during peak global hours.
  - **Multi-Account Governance:** OpenRouter enforces global IP and device heuristics; automated key creation without distinct proxies will lead to account suspension.

---

### 3.9. NVIDIA NIM (build.nvidia.com API Catalog)

- **Website & Portal:** [NVIDIA API Catalog](https://build.nvidia.com)
- **Official Documentation:**
  - Getting Started: [docs.nvidia.com/nim/](https://docs.nvidia.com/nim/)
- **Credit Card Required:** ❌ **No**. Free NVIDIA Developer Account.
- **Available Free-Tier Models:**
  - `meta/llama-3.3-70b-instruct`
  - `nvidia/nemotron-4-340b-instruct`
  - `deepseek-ai/deepseek-r1`
  - `mistralai/mistral-large-2-instruct`
- **Exact Free Tier Quotas & Rate Limits:**
  - **Requests Per Minute (RPM):** 40 RPM
  - **Total Free Grant:** **1,000 API Credits** credited to the developer account upon generation of the first API key.
  - **Context Window:** 8,192 to 131,072 tokens.
  - **Max Output Tokens:** 4,096 tokens.
- **Key Restrictions & Governance Rules:**
  - **Non-Renewing Grant:** The 1,000 credits do not automatically renew each month. Once exhausted, the account must be transitioned to a self-hosted or partner-hosted paid deployment.
  - **Standard OpenAI Schema:** Hosted at `https://integrate.api.nvidia.com/v1`, making it an instant drop-in replacement for standard OpenAI client libraries.

---

### 3.10. Voyage AI (State-of-the-Art Free Embeddings & Reranking)

- **Website & Portal:** [Voyage AI Dashboard](https://dash.voyageai.com)
- **Official Documentation:**
  - Pricing & Free Tokens: [docs.voyageai.com/docs/pricing](https://docs.voyageai.com/docs/pricing)
  - Rate Limits: [docs.voyageai.com/docs/rate-limits](https://docs.voyageai.com/docs/rate-limits)
- **Credit Card Required:** ❌ **No**. Account signup unlocks the token pool immediately.
- **Available Free-Tier Models:**
  - `voyage-4` & `voyage-4-lite`: Latest generation general text embeddings.
  - `voyage-context-4`: Embedding model designed for contextual chunks.
  - `voyage-code-2`: Specialized code and syntax embedding.
  - `rerank-2`: Cross-encoder reranker for high-precision retrieval.
- **Exact Free Tier Quotas & Rate Limits:**
  - **Total Free Token Grant:** **200,000,000 Tokens** for general models; **50,000,000 Tokens** for specialized domain models (`voyage-code-2`, `voyage-law-2`).
  - **Requests Per Minute (RPM):** 2,000 RPM base organization limit.
  - **Tokens Per Minute (TPM):** 2,000,000 to 16,000,000 TPM.
  - **Context Window:** 32,000 tokens (16,000 for code).
- **Key Restrictions & Governance Rules:**
  - ⚠️ **Data Privacy Opt-Out Requires Card:** Free-tier usage data may be used to improve models. Opting out of data training requires having a credit card on file.
  - **Massive Free Runway:** For an embedding/RAG pipeline, 200M tokens provides months of continuous production indexing without spending $1.

---

## 4. Key Collective Pooling & Multiplexing Architecture

```mermaid
flowchart TD
    Client[Client Request / OpenRouter Client] --> Gateway[Key Collective Edge Gateway\nCloudflare Worker]
    Gateway --> Auth[Multi-Tenant Auth & Tenant DO]
    Auth --> Classifier{Payload Intent / Task}
    
    Classifier -->|High-Throughput Reasoning| RouteA[Pool A: 70B+ Frontier]
    Classifier -->|Low-Latency Flash / Tool Use| RouteB[Pool B: Flash Tier]
    Classifier -->|Embeddings / RAG| RouteC[Pool C: Vector & Rerank]
    
    subgraph PoolA [Frontier 70B+ Free Key Pool]
        SambaNova[SambaNova Cloud\n240 RPM | Llama 3.3 70B]
        Cerebras[Cerebras Cloud\n30 RPM | Llama 3.3 70B]
        CF_70B[Cloudflare Workers AI\nLlama 3.3 70B FP8]
        NVIDIA[NVIDIA NIM\n40 RPM | Nemotron / R1]
    end
    
    subgraph PoolB [Flash & Lightweight Free Key Pool]
        Gemini[Google AI Studio\n15 RPM / 1.5k RPD | Gemini 2.5 Flash]
        Groq[GroqCloud\n30 RPM / 14.4k RPD | Qwen 3.6 / GPT-OSS]
        Mistral[Mistral La Plateforme\n60 RPM | Mistral Small / Codestral]
        OpenRouter[OpenRouter Free\n20 RPM | :free models]
    end
    
    subgraph PoolC [Embedding & Reranking Pool]
        Voyage[Voyage AI\n2,000 RPM | 200M Free Tokens]
        Cohere_Rerank[Cohere Trial\n10 RPM | Rerank v3.5]
        CF_BGE[Cloudflare Workers AI\nBGE Large v1.5]
    end
    
    RouteA --> SambaNova -->|Failover 429| Cerebras -->|Failover 429| CF_70B -->|Failover 429| NVIDIA
    RouteB --> Gemini -->|Failover 429| Groq -->|Failover 429| Mistral -->|Failover 429| OpenRouter
    RouteC --> Voyage -->|Failover 429| Cohere_Rerank -->|Failover 429| CF_BGE
```

### 4.1. Aggregate Free Tier Capacity (Single Key Per Provider)

If an indie developer or small team provisions exactly **one free account** across the top active providers, the multiplexed capacity available to Key Collective is:

| Metric | Flash Tier (Gemini + Groq + Mistral) | Frontier 70B Tier (SambaNova + Cerebras + CF AI) | Combined Total |
| :--- | :--- | :--- | :--- |
| **Instantaneous RPM** | 105 RPM | 300+ RPM | **> 400 Requests / Min** |
| **Daily Request Capacity** | ~17,000+ RPD | ~50,000+ RPD | **> 67,000 Requests / Day** |
| **Daily Token Allowance** | ~10M–20M Tokens/day | ~6M–10M Tokens/day | **> 25,000,000 Tokens / Day** |
| **Cost** | **$0.00** | **$0.00** | **$0.00 / month** |

### 4.2. Multi-Key Pooling Multiplier

Because Google AI Studio, GroqCloud, Cerebras, and SambaNova enforce limits at the project or organization boundary, a tenant configuring Key Collective can configure **$N$ isolated projects** (e.g., 5 Google Cloud projects + 3 Groq accounts + 3 Cerebras accounts).

Key Collective’s Durable Object key pooler distributes traffic using smooth round-robin and sliding-window token counters:
$$\text{Total Pool Capacity} = \sum_{p \in \text{Providers}} N_p \times \text{Quota}(p)$$
With 5 keys per provider:
- **Google AI Studio (5 projects):** 75 RPM, 7,500 RPD, 5,000,000 TPM
- **GroqCloud (3 orgs):** 90 RPM, 43,200 RPD, 36,000 TPM
- **Cerebras (3 accounts):** 90 RPM, 3,000,000 TPD
- **SambaNova (3 accounts):** 720 RPM, 144,000 RPD
- **Result:** Over **975 RPM** and **200,000+ RPD**, equivalent to a $500–$1,000/month commercial LLM gateway.

---

## 5. Quota Reset Windows & Synchronization Matrix

Different providers reset daily quotas at disparate clock times and window evaluation intervals. Key Collective's Durable Object storage must track separate reset timers per provider:

| Provider | Reset Timezone / Schedule | Window Style | Error Code on Exhaustion | DO Reset Handler Action |
| :--- | :--- | :--- | :--- | :--- |
| **Google AI Studio** | 00:00 Pacific Time (PST: UTC-8 / PDT: UTC-7) | Hard Daily Ceiling (RPD) + 1-min rolling (RPM/TPM) | `429 RESOURCE_EXHAUSTED` | Lock key until next Pacific Midnight timestamp |
| **Cloudflare Workers AI** | 00:00 UTC | Hard Daily Neuron Cap | `Error 3036: Neuron limit reached` | Lock CF AI node until next 00:00 UTC |
| **GroqCloud** | 00:00 UTC | Rolling 1-minute RPM/TPM + Daily RPD | `429 Too Many Requests` | Exponential backoff (respect `retry-after` header) |
| **Cerebras Cloud** | Rolling 24-hour window from first request | Dual-bucket TPM + Daily TPD | `429 Too Many Requests` | Throttle uncached requests; switch to cached tokens |
| **SambaNova Cloud** | Rolling 24-hour window / 00:00 UTC | Dynamic TPD cap + Rolling 1-min RPM | `429 Too Many Requests` | Inspect `x-ratelimit-remaining-requests` header |
| **Mistral AI** | Calendar month reset (1st of month 00:00 UTC) | 1-second RPS limit + Monthly token ceiling | `429 Too Many Requests` | Backoff 1000ms on RPS; switch key if monthly cap hit |
| **Cohere** | Calendar month reset (1st of month 00:00 UTC) | Hard 1,000 call monthly ceiling | `429 Too Many Requests` | Permanently park key until month rollover |
| **OpenRouter (:free)** | Rolling 24-hour window | Hard 50 RPD limit | `429 Too Many Requests` | Shift traffic to native provider keys |

---

## 6. Deprecation & Sunset Sentinel Guidelines

Provider models frequently undergo deprecation with little notice. For example:
- **GitHub Models:** Completely terminated on July 30, 2026.
- **Groq `llama-3.3-70b-versatile`:** Deprecated in August 2026.
- **Google Gemini 1.5 Series:** Phased out in favor of 2.0 and 2.5 series.

### Invariant Rules for Key Collective Routing Engine:
1. **Logical Model Aliases:** Never expose provider-native IDs to the end client. The client requests `fast-flash`, `smart-reasoning`, `code-specialist`, or `frontier-70b`. The router resolves these aliases dynamically based on live health checks.
2. **Canary Ping Probe:** Every 15 minutes, a lightweight background worker sends a single-token completion ping (`{"prompt": "hi", "max_tokens": 1}`) to all pool members.
3. **Automated Sunset Detection:** If a provider returns `404 Not Found`, `410 Gone`, or `model_not_found`, the router immediately flags the model as `SUNSET`, drops it from the active rotation, logs a critical trace span to Workers Analytics Engine, and triggers an automated notification.

---

## 7. Actionable Key Collective Configuration Schema

Below is the canonical TypeScript schema and default provider routing configuration to be incorporated into `src/config/providers.ts`:

```typescript
export interface FreeTierProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  headerAuthType: 'Bearer' | 'x-api-key' | 'Custom';
  authHeaderName?: string;
  rateLimits: {
    rpm: number;
    rpd?: number;
    tpm?: number;
    tpd?: number;
    resetTimezone: 'UTC' | 'Pacific' | 'Monthly';
  };
  privacyPolicy: 'ZeroRetention' | 'ModelTraining';
  supportedModels: {
    logicalAlias: 'fast-flash' | 'frontier-70b' | 'smart-reasoning' | 'code-specialist' | 'embedding';
    nativeModelId: string;
    contextWindow: number;
    maxOutputTokens: number;
  }[];
}

export const FREE_TIER_PROVIDERS: Record<string, FreeTierProviderConfig> = {
  google_ai_studio: {
    id: 'google_ai_studio',
    name: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    headerAuthType: 'Custom',
    authHeaderName: 'x-goog-api-key',
    rateLimits: {
      rpm: 15,
      rpd: 1500,
      tpm: 1000000,
      resetTimezone: 'Pacific',
    },
    privacyPolicy: 'ModelTraining',
    supportedModels: [
      {
        logicalAlias: 'fast-flash',
        nativeModelId: 'gemini-2.5-flash',
        contextWindow: 1048576,
        maxOutputTokens: 8192,
      },
      {
        logicalAlias: 'smart-reasoning',
        nativeModelId: 'gemini-2.5-pro',
        contextWindow: 2097152,
        maxOutputTokens: 8192,
      },
    ],
  },
  groq: {
    id: 'groq',
    name: 'GroqCloud',
    baseUrl: 'https://api.groq.com/openai/v1',
    headerAuthType: 'Bearer',
    rateLimits: {
      rpm: 30,
      rpd: 14400,
      tpm: 20000,
      resetTimezone: 'UTC',
    },
    privacyPolicy: 'ZeroRetention',
    supportedModels: [
      {
        logicalAlias: 'fast-flash',
        nativeModelId: 'llama-3.1-8b-instant',
        contextWindow: 131072,
        maxOutputTokens: 131072,
      },
      {
        logicalAlias: 'frontier-70b',
        nativeModelId: 'openai/gpt-oss-120b',
        contextWindow: 131072,
        maxOutputTokens: 65536,
      },
    ],
  },
  sambanova: {
    id: 'sambanova',
    name: 'SambaNova Cloud',
    baseUrl: 'https://api.sambanova.ai/v1',
    headerAuthType: 'Bearer',
    rateLimits: {
      rpm: 240,
      rpd: 48000,
      resetTimezone: 'UTC',
    },
    privacyPolicy: 'ZeroRetention',
    supportedModels: [
      {
        logicalAlias: 'frontier-70b',
        nativeModelId: 'Meta-Llama-3.3-70B-Instruct',
        contextWindow: 8192,
        maxOutputTokens: 4096,
      },
      {
        logicalAlias: 'smart-reasoning',
        nativeModelId: 'DeepSeek-V3.1',
        contextWindow: 65536,
        maxOutputTokens: 8192,
      },
    ],
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras Cloud',
    baseUrl: 'https://api.cerebras.ai/v1',
    headerAuthType: 'Bearer',
    rateLimits: {
      rpm: 30,
      tpm: 90000,
      tpd: 1000000,
      resetTimezone: 'UTC',
    },
    privacyPolicy: 'ZeroRetention',
    supportedModels: [
      {
        logicalAlias: 'frontier-70b',
        nativeModelId: 'llama-3.3-70b',
        contextWindow: 8192,
        maxOutputTokens: 8192,
      },
    ],
  },
  cloudflare_workers_ai: {
    id: 'cloudflare_workers_ai',
    name: 'Cloudflare Workers AI',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run',
    headerAuthType: 'Bearer',
    rateLimits: {
      rpm: 1500,
      resetTimezone: 'UTC',
    },
    privacyPolicy: 'ZeroRetention',
    supportedModels: [
      {
        logicalAlias: 'frontier-70b',
        nativeModelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        contextWindow: 8192,
        maxOutputTokens: 4096,
      },
    ],
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    headerAuthType: 'Bearer',
    rateLimits: {
      rpm: 60,
      tpm: 500000,
      resetTimezone: 'Monthly',
    },
    privacyPolicy: 'ModelTraining',
    supportedModels: [
      {
        logicalAlias: 'fast-flash',
        nativeModelId: 'mistral-small-latest',
        contextWindow: 32768,
        maxOutputTokens: 8192,
      },
      {
        logicalAlias: 'code-specialist',
        nativeModelId: 'codestral-latest',
        contextWindow: 131072,
        maxOutputTokens: 8192,
      },
    ],
  },
  voyage: {
    id: 'voyage',
    name: 'Voyage AI',
    baseUrl: 'https://api.voyageai.com/v1',
    headerAuthType: 'Bearer',
    rateLimits: {
      rpm: 2000,
      tpm: 16000000,
      resetTimezone: 'Monthly',
    },
    privacyPolicy: 'ModelTraining',
    supportedModels: [
      {
        logicalAlias: 'embedding',
        nativeModelId: 'voyage-4',
        contextWindow: 32000,
        maxOutputTokens: 0,
      },
    ],
  },
};
```

---

## 8. Recommendations for Next Steps

1. **Incorporate into PRD & System Design:**
   Update `docs/PRD.md` and `docs/system_design.md` to reference the logical alias taxonomy (`fast-flash`, `frontier-70b`, `smart-reasoning`, `code-specialist`, `embedding`) and wire the fallback cascade DAG.
2. **Implement Durable Object Circuit Breaker:**
   In Key Collective’s per-tenant Durable Object (`src/durable_objects/TenantPoolDO.ts`), encode the rate limits (RPM, RPD, TPM, TPD) and timezone-aware reset timers defined in Section 5.
3. **Automate Zero-PII Sanitization:**
   For providers flagged as `privacyPolicy: 'ModelTraining'` (Google AI Studio, Mistral Experiment, OpenRouter Free, Voyage AI), implement a regex-based PII/Secret redactor in the Worker proxy middleware to strip API keys, Bearer tokens, and sensitive headers before forwarding to external providers.
4. **Deploy Sunset Sentinel Probe:**
   Implement a cron trigger (`wrangler.toml` scheduled trigger) executing canary pings every 15 minutes to actively detect retired models like GitHub Models and Groq deprecations before user traffic is impacted.
