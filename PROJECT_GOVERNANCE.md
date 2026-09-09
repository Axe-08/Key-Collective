# Key Collective Governance & Constraints

## 1. Active Workflows
- **Workflow 2: HIVE:** Active for autonomous hierarchical implementation.
- **Workflow 4: PR Gatekeeper:** Mandatory for security checks, invariants verification (no plaintext keys), and pre-merge reviews.
- **Workflow 5: Codebase Scribe:** Mandatory upon merging significant logic changes to update Codeflow CFGs and documentation.
- **Workflow 6: Continuous Evals:** Active for living evaluation, benchmark assertions, and regression testing.

## 2. Scope Boundaries (v2 Multi-Tenant)
- **Scope:** Multi-tenant Cloudflare-native LLM router SaaS ("Your own globally-distributed OpenRouter, running on your keys").
- **Boundaries:** Strict tenant isolation, low latency proxying, and cost-optimal routing with per-tenant budget caps.
- **Out of Scope (v2):** Route C DO coordinator, Multi-region D1 replicas, Monetization/marketplace, Mobile clients.

## 3. Verification Rigor
- **Level:** Standard Production
- **Gates:** Strict Quality Gate — All changes must pass `make gate` (<10s) before merge.
