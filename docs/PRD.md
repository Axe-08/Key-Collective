# Product Requirements Document: Key Collective

## 1. Problem Statement
The user currently manages 22 API keys (17 Gemini, 5 Groq) across multiple accounts and quotas. Managing these involves hardcoding `.env` files, tracking limits manually, and wasting unused free-tier capacity on idle keys while hitting rate limits on active ones.

## 2. Target Persona
Solo developers and indie hackers (initially dogfooding for the author) who manage a distributed portfolio of AI API keys and want a single, centralized proxy to handle rotation, failover, and rate-limiting.

## 3. Product Vision
A "1Password for API keys that also uses them for you." A single, persistent proxy server exposing an OpenAI-compatible endpoint. The user issues one master token, routes all traffic through Key Collective, and the system intelligently pools, rotates, and manages the upstream keys.

## 4. In Scope for v1
- **LLM Inference Proxy:** OpenAI-compatible API endpoint for `/v1/chat/completions`.
- **Supported Providers:** Google Gemini, Groq.
- **Key Pool Management:** Automated rotation, health tracking, and circuit-breaking.
- **Web Dashboard:** UI for registering keys, viewing health, and checking usage stats.
- **Hosting Target:** Railway Free Tier ($1/mo credit) + SQLite persistent volume.

## 5. Out of Scope for v1
- Multi-user / Team workspaces (Single user only).
- Non-LLM APIs (e.g., Stripe, Twilio).
- Monetization or marketplace features.
- Cost optimization recommendations.
