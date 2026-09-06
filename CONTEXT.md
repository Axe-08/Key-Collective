# Key Collective

## Overview
Key Collective is a high-performance, single-binary API proxy written in Go, designed to pool, rotate, and manage multiple LLM API keys (Gemini, Groq) seamlessly. 

## Stack
- **Backend:** Go 1.23+ (`net/http`)
- **Frontend:** Svelte 5 + TailwindCSS (compiled and served via Go `embed.FS`)
- **Database:** SQLite (WAL mode)
- **Deployment:** Docker -> Railway Free Tier ($1/mo credit)

## Core Mechanisms
- **Circuit Breaker:** 429 responses trigger a 60-second cooldown on the offending key.
- **Priority Routing:** Keys are selected based on: Provider Match -> Priority Level -> RPM Headroom -> Lowest Latency.
- **Security:** API Keys are AES-256-GCM encrypted in SQLite using a master environment variable.

See `docs/` for the complete inception specification.
