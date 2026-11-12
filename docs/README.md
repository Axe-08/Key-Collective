# Key Collective Documentation Index

This directory contains the technical documentation, specifications, architecture blueprints, legal dossiers, and operational runbooks for Key Collective v4.0.

---

## Directory Organization

| Directory | Purpose | Key Documents |
|---|---|---|
| [`specs/`](file:///home/akshit/Projects/Key%20Collective/docs/specs/) | Product and system specifications | [PRD.md](file:///home/akshit/Projects/Key%20Collective/docs/specs/PRD.md), [telemetry_spec.md](file:///home/akshit/Projects/Key%20Collective/docs/specs/telemetry_spec.md), [QA/](file:///home/akshit/Projects/Key%20Collective/docs/specs/QA/) |
| [`architecture/`](file:///home/akshit/Projects/Key%20Collective/docs/architecture/) | High-level and low-level system designs, state machines, and cost models | [system_design.md](file:///home/akshit/Projects/Key%20Collective/docs/architecture/system_design.md), [budget_model.md](file:///home/akshit/Projects/Key%20Collective/docs/architecture/budget_model.md), [threat_model.md](file:///home/akshit/Projects/Key%20Collective/docs/architecture/threat_model.md), [ci_cd_architecture.md](file:///home/akshit/Projects/Key%20Collective/docs/architecture/ci_cd_architecture.md) |
| [`adr/`](file:///home/akshit/Projects/Key%20Collective/docs/adr/) | Curated Architecture Decision Records (ADRs) | [ADR-001](file:///home/akshit/Projects/Key%20Collective/docs/adr/001-durable-objects-for-hot-state.md) to [ADR-006](file:///home/akshit/Projects/Key%20Collective/docs/adr/006-google-ai-studio-virtual-quota-clustering.md) |
| [`operations/`](file:///home/akshit/Projects/Key%20Collective/docs/operations/) | SRE runbooks, failure mode analyses, and disaster recovery | [fmea_and_runbook.md](file:///home/akshit/Projects/Key%20Collective/docs/operations/fmea_and_runbook.md) |
| [`legal/`](file:///home/akshit/Projects/Key%20Collective/docs/legal/) | Intermediary liability compliance (India IT Act §79), provider TOS dossiers, and data governance | [provider_tos_legal_dossier.md](file:///home/akshit/Projects/Key%20Collective/docs/legal/provider_tos_legal_dossier.md), [data_governance.md](file:///home/akshit/Projects/Key%20Collective/docs/legal/data_governance.md) |
| [`research/`](file:///home/akshit/Projects/Key%20Collective/docs/research/) | Competitive landscapes, OSS benchmarks, historical audit, and Phase 3/F progress | [INTENT_AUDIT.md](file:///home/akshit/Projects/Key%20Collective/docs/research/INTENT_AUDIT.md), [v4_competitive_landscape.md](file:///home/akshit/Projects/Key%20Collective/docs/research/v4_competitive_landscape.md), [PROGRESS_PHASE3_PHASEF.md](file:///home/akshit/Projects/Key%20Collective/docs/research/PROGRESS_PHASE3_PHASEF.md) |
| [`codeflow/`](file:///home/akshit/Projects/Key%20Collective/docs/codeflow/) | Microscopic Control Flow Graphs (CFGs) and Def-Use matrices | [Codeflow-Index.md](file:///home/akshit/Projects/Key%20Collective/docs/codeflow/Codeflow-Index.md) |
| [`study_guide/`](file:///home/akshit/Projects/Key%20Collective/docs/study_guide/) | Comprehensive mdBook textbook & pedagogy guide | [00_preface_and_syllabus.md](file:///home/akshit/Projects/Key%20Collective/docs/study_guide/00_preface_and_syllabus.md) |

---

## Canonical Invariants

All architecture and implementation within Key Collective must respect the constitutional invariants outlined in [GEMINI.md](file:///home/akshit/Projects/Key%20Collective/GEMINI.md) and [PRD.md](file:///home/akshit/Projects/Key%20Collective/docs/specs/PRD.md):
1. **Zero Plaintext Keys:** AES-256-GCM encryption with unique 12-byte nonces stored alongside ciphertext in D1.
2. **Per-Tenant Durable Object Isolation:** `env.KEY_POOL.idFromName(tenantId)` prevents any cross-tenant state leakage.
3. **Integer Capacity Units (`bigint` CU):** All capacity accounting is integer CU; zero floating-point math; zero currency.
4. **DO Transactional Storage for Hot State:** In-memory circuit breaker and RPM counters sync to `this.ctx.storage`.
5. **Non-Blocking Telemetry:** High-frequency events stream via `ctx.waitUntil()` to Workers Analytics Engine.
6. **Strict Quality Gate:** All changes must pass `make gate` (<10s) before merge.
