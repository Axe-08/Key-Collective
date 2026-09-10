---
status: Approved
date: 2026-09-10
tags: [type/prd, status/approved, domain/ai-systems, project/key-collective]
---

# PRD: Key Collective v3 — Multi-Project, Anti-Sybil & Tiered Developer Platform

## 1. 🎯 Problem Statement
- **What:** Independent developers, hackathons, and AI engineers need high-throughput, multi-model AI API access without paying premium SaaS proxy markups or managing fragile local reverse proxies. Key Collective v2 established edge key pooling; v3 expands this into a **complete multi-project developer platform** with robust Sybil resistance, 7 authorization tiers, and an interactive documentation & export engine.
- **Who:** Indie AI hackers, hackathon participants, engineering teams building multi-tenant AI pipelines, and systems architects.
- **Why Now:** Cardless free-tier frontier models (Gemini 2.5 Flash, Groq Qwen/Llama) provide immense value, but individual keys are heavily throttled (15–30 RPM). By pooling quota across multiple keys and providing project-level isolation, Key Collective unlocks reliable enterprise-grade capacity for $0/month.

## 2. 📊 Success Metrics & Key Results
- **Primary Metric 1 (Sybil Resistance):** Zero automated botnet registrations; 100% of newly created accounts (<30d) or disposable emails quarantined to Probationary sandbox.
- **Primary Metric 2 (Proxy Overhead):** P95 edge proxy latency overhead $<2.5\text{ms}$ on cache hits.
- **Primary Metric 3 (Revocation SLA):** Project key revocation propagates globally to all Cloudflare edge PoPs in $<10\text{ms}$.
- **Guardrail Metric 1 (Zero Downtime Deployments):** 100% automated CI/CD canary health check pass rate on production merges with instant rollback on failure.
- **Guardrail Metric 2 (Zero Plaintext Keys):** 100% of upstream keys encrypted with AES-256-GCM via Web Crypto API with unique 12-byte CSPRNG nonces stored in D1.

## 3. 👥 User & System Personas
- **The Indie AI Hacker:** Needs isolated keys for multiple side projects (Cursor, Telegram bot, local RAG) drawing from a single pooled Builder quota.
- **The Power Developer (Max / Ultra Tier):** Needs extended throughput (60+ RPM) with up to 10–25 registered projects and priority upstream routing.
- **The Playground Visitor (Demo Tier):** Unauthenticated visitor testing prompts in the browser with an ephemeral 15-minute rotating token.
- **The Root Owner (Admin Tier):** Full administrative visibility into all user pools, D1 tables, upstream key health, and global rate limit overrides.

## 4. ⚙️ Functional Requirements
- `FR-01 (GitHub OAuth & Turnstile)`: One-click developer signup gated by Cloudflare Turnstile bot challenges.
- `FR-02 (Anti-Sybil Scoring Engine)`: Edge evaluation of GitHub account age ($\ge 30$d), verified non-disposable email, public repos ($\ge 1$), and contribution calendar ($\ge 5$).
- `FR-03 (7-Tier Authorization)`: Strict enforcement of Admin, Ultra, Max, Builder, Probationary, Demo, and Suspended tiers.
- `FR-04 (Multi-Project Hierarchy)`: Registered developers can create multiple isolated projects (`Project A`, `Project B`) with optional sub-RPM caps sharing the root user's pooled quota ceiling.
- `FR-05 (Project-Scoped Keys)`: Issuance of `kc_proj_<base58>` API keys with instant (<5ms) individual revocation without affecting sibling projects.
- `FR-06 (Ephemeral Demo Tier)`: Dedicated playground pool with a 15-minute rotating cryptographic token managed via Cloudflare Durable Object Alarms, with per-IP rate throttling (3 RPM / 25 RPD).
- `FR-07 (Charcoal & Silver Glassmorphism UI)`: Deep charcoal canvas (`#050608`), dual-layer backdrop blur, ambient top specular highlights, and luminescent status pings.
- `FR-08 (Interactive API Explorer)`: 3-column live endpoint workbench with multi-language code generators (cURL, TypeScript, Python) and real-time SSE chunk streaming.
- `FR-09 (1-Click Documentation Exporters)`: Zero-server Markdown download (`key-collective-api.md`) and high-fidelity vector PDF export via CSS `@media print`.
- `FR-10 (Dual-Environment CI/CD)`: Automated GitHub Actions pipeline for staging (`dev.key-col.axe08.tech`) and production (`key-col.axe08.tech`) with `make gate` verification and canary health checks.

## 5. 🛡️ Non-Functional Requirements (NFRs)
- `NFR-01 (Latency)`: P95 edge gateway overhead $<2.5\text{ms}$.
- `NFR-02 (Security & Tenant Isolation)`: Every user account is backed by an isolated Durable Object isolate (`idFromName(tenantId)`). Zero cross-tenant state leakage.
- `NFR-03 (Cost)`: $0/month idle infrastructure cost (runs entirely within Cloudflare Workers, Durable Objects, D1, and Analytics Engine).
- `NFR-04 (Financial Precision)`: All internal ledgering and spend tracking computed in 64-bit integer microdollars (`1 USD = 1,000,000 µ$`). Zero floating-point math.

## 6. 🚫 Out of Scope
- Stripe / paid credit card billing.
- Third-party OAuth providers (Google, Twitter, email/password).
- Native desktop applications (Electron/Tauri).
- Multi-user RBAC teams per project.

## 7. 🔗 Architecture & Evals
- Architecture Spec: [[system_design_v3]]
- Golden Benchmark: [[docs/golden_tests/v3_cases.yaml]]
- Threat Model: [[docs/architecture/v3_threat_model.md]]
- CI/CD Architecture: [[docs/ci_cd_architecture.md]]
