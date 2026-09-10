# 🌐 Landscape & Competitive Intelligence: Free-Tier LLM Multi-Key Aggregation

> **Inception Stage:** Round 0.5 Deliverable  
> **Target Project:** Key Collective (v2 Cloudflare Native — Free-Tier Key Multiplexer & Pooling Edition)  
> **Authors:** Competitive Intel Analyst & Systems Researcher  
> **Canonical Path:** `docs/research/landscape.md`  
> **Source Files:** [`free_tier_provider_landscape.md`](file:///home/akshit/Projects/Key%20Collective/docs/research/free_tier_provider_landscape.md) & [`oss_key_rotators_and_benchmarks.md`](file:///home/akshit/Projects/Key%20Collective/docs/research/oss_key_rotators_and_benchmarks.md)

---

## 1. Executive Summary & Market Paradox

Commercial LLM gateways (LiteLLM, Portkey, Cloudflare AI Gateway) assume users manage **paid API accounts** with credit cards. They focus on spend control, cost optimization, and virtual balance deductions.

Meanwhile, open-weights and frontier lab providers offer **generous, zero-credit-card Free Tiers** (Google Gemini, Groq, Cerebras, SambaNova, Cloudflare Workers AI, Mistral) intended for developer evaluation. However, each individual key is handicapped by severe rate limits (10–30 RPM, 1,000–14,400 RPD) that instantly blow up in multi-agent workflows or rapid coding sessions with `429 Too Many Requests`.

**The Market Gap:** There is no lightweight, zero-cold-start, serverless edge multiplexer specifically engineered to **pool collections of free-tier keys**, enforce per-key sliding-window RPM quotas, automatically isolate 429 trips into provider-aware cooldowns, and present a single, resilient OpenAI-compatible endpoint.

---

## 2. Comprehensive Free-Tier Provider Matrix (Zero Credit Card Required)

| Provider | Key Free Models | Free Quotas (Single Account) | Context / Output | Data Privacy Clause | Official Docs & Links |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Google AI Studio** | `gemini-2.5-flash`, `gemini-3.8-flash`, `gemini-2.5-pro` | **15 RPM**, **1,500 RPD**, 1,000,000 TPM (Flash)<br>**2 RPM**, **50 RPD**, 32k TPM (Pro) | 1,048,576 / 8,192 (Flash)<br>2,097,152 / 8,192 (Pro) | ⚠️ **Logged for training** & human review | [AI Studio Pricing](https://ai.google.dev/pricing) \| [Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits) |
| **GroqCloud** | `llama-3.1-8b-instant`, `qwen/qwen3.6-27b`, `openai/gpt-oss-120b`, `whisper-large-v3` | **30 RPM**, **14,400 RPD** (LLM)<br>**300 RPM**, 200,000 ASH (Audio) | 131,072 / 16,384 | 🔒 **Zero training retention** | [Groq Limits](https://console.groq.com/docs/rate-limits) \| [Models](https://console.groq.com/docs/models) |
| **Cerebras Cloud** | `llama-3.3-70b`, `llama-3.1-8b` | **30 RPM**, **1,000,000 Tokens/Day** | 8,192–128,000 / 8,192 | 🔒 Enterprise privacy | [Cerebras Docs](https://inference-docs.cerebras.ai/) |
| **SambaNova Cloud** | `llama-3.3-70b`, `deepseek-v3.1`, `deepseek-r1` | **60–240 RPM**, **12,000–48,000 RPD** | 8,192–64,000 / 4,096 | 🔒 Zero training retention | [SambaNova Cloud](https://docs.sambanova.ai/cloud) |
| **Cloudflare Workers AI** | `llama-3.3-70b-instruct`, `deepseek-r1-distill-32b` | **720–3,000 RPM**, **10,000 Neurons/Day** (~100k–500k tokens) | 8,192–128,000 / 4,096 | 🔒 Edge compute isolation | [Workers AI Limits](https://developers.cloudflare.com/workers-ai/platform/limits/) |
| **Mistral AI** | `mistral-small-latest`, `codestral-latest`, `pixtral-12b` | **60 RPM**, **1 Billion Tokens / month** | 32,000–128,000 / 8,192 | ⚠️ Logged on Experiment tier | [Mistral Pricing](https://docs.mistral.ai/deployment/laplateforme/pricing/) |
| **OpenRouter (:free)** | `llama-3.3-70b:free`, `gemini-2.0-flash:free`, `deepseek-r1:free` | **20 RPM**, **50 RPD** | 32,000–128,000 / 4,096 | ⚠️ Provider dependent | [OpenRouter Limits](https://openrouter.ai/docs/limits) |
| **Voyage AI** | `voyage-4`, `voyage-code-2` (Embeddings) | **2,000 RPM**, **200M Free Tokens** | 32,000 tokens | ⚠️ Logged on trial | [Voyage Pricing](https://docs.voyageai.com/docs/pricing) |

---

## 3. Competitive Architecture Benchmark: Key Collective vs Existing Solutions

| Dimension | Heavy Proxies (LiteLLM) | Go Gateways (One-API / New-API) | Commercial Gateways (Portkey, CF Gateway) | **Key Collective (v2 Cloudflare Native)** |
|---|---|---|---|---|
| **Runtime & Hosting** | Python/FastAPI (Docker, ECS, Railway) | Go/Gin binary (VPS, Docker) | Proprietary SaaS | **Cloudflare Workers + Durable Objects** |
| **Idle Cost & Cold Start** | $15–$50/mo idle; ~1–3s cold start | $5–$20/mo idle; ~200ms cold start | $0–$99/mo subscription | **$0.00 idle cost; <1ms cold start (V8 Isolates)** |
| **Egress Bandwidth Cost** | AWS/GCP egress tax (~$0.09/GB) | VPS bandwidth limit | Included in SaaS bill | **$0.00 egress (Cloudflare zero-egress network)** |
| **Key Pool Multiplexing** | Generic load-balancing | Channel weight triage | Single-key BYOK routing | **Deterministic multi-key sliding-window rotation** |
| **Rate Limit Precision** | Fixed 60s window (Redis Lua) | Fixed 60s window boundary | Fixed token buckets | **In-memory high-res sliding window in tenant DO** |
| **429 Circuit Handling** | Generic retry / sleep | Disabled channel toggle | Manual retry policy | **Automated 60s cooldown isolation with instant key failover** |
| **Credential Storage Security** | Plaintext in PostgreSQL/Env | Plaintext in SQLite/MySQL | SaaS vault | **AES-256-GCM Web Crypto; zero plaintext in D1** |
| **Stateful Memory Overhead** | External Redis instance required | External Redis or SQLite lock | Cloud database | **Per-tenant Durable Object transactional storage** |

---

## 4. Key Collective Pooling Multiplier Proof

For a developer pooling **17 Gemini Free Keys** and **5 Groq Free Keys**:
- **Single Gemini Key:** 15 RPM, 1,500 RPD
- **Single Groq Key:** 30 RPM, 1,000 RPD
- **Key Collective Pooled Capacity:**
  $$\text{Gemini Pool} = 17 \times 15 = \mathbf{255\text{ RPM}}, \quad 17 \times 1,500 = \mathbf{25,500\text{ RPD}}$$
  $$\text{Groq Pool} = 5 \times 30 = \mathbf{150\text{ RPM}}, \quad 5 \times 1,000 = \mathbf{5,000\text{ RPD}}$$
  $$\text{Total Aggregated Edge Throughput} = \mathbf{405\text{ RPM}}, \quad \mathbf{30,500\text{ Requests/Day}}$$
- **Monetary Value Extracted (Monthly):**
  At standard commercial rates ($0.30/MTok in, $2.50/MTok out for Gemini Flash, and $0.80/$4.00 for Groq), processing 30,500 requests/day (~15M tokens/day = 450M tokens/month) represents **~$450.00 – $900.00 / month of frontier intelligence completely free**.
