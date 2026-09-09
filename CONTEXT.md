# CONTEXT.md: Key Collective Grounding Specification

> **Grounding Prompt:** This file serves as the canonical single-source-of-truth grounding prompt for autonomous AI coding agents (Antigravity, Cursor, HIVE) operating in this repository.

---

## 🎯 1. Mission & Problem Statement
Problem statement pending PRD definition.

---

## 🔬 2. SOTA Research & Competitive Landscape
Live research landscape pending.

---

## 🏗️ 3. Core Architecture & Execution Boundaries
High-level architecture pending system_design.md.

### Legislative Invariants:
1. **Deterministic Bounds:** Keep probabilistic model calls strictly isolated from deterministic routing and transaction paths.
2. **Strict Typing:** 100% type annotations enforced via language typecheckers (`mypy --strict`, `tsc`, `cargo check`).
3. **Trace-Based Observability:** Every multi-step workflow must emit a structured trace ID with latency, provider, and error spans.
4. **Eval-Driven Development (EDD):** Build against golden test benchmark assertions defined in `docs/golden_tests/cases.yaml`.

---

## 📦 4. Grounding Artifact Inventory
Downstream agents should refer to these files for detailed contracts:
- `docs/PRD.md`: Full functional requirements & personas
- `docs/system_design.md`: Mermaid flowcharts & component breakdowns
- `docs/data_contracts.py`: Canonical Pydantic v2 / schema data models
- `docs/state_machine.mmd`: Formal state machine & error backoff transitions
- `docs/golden_tests/cases.yaml`: Acceptance test benchmark suite
- `docs/threat_model.md`: Security, PII, and injection defense matrix
- `docs/budget_model.md`: Latency SLA (<300ms) & unit economics calculator
- `docs/telemetry_spec.md`: Trace schema, spans & error taxonomy
- `docs/fmea_and_runbook.md`: Failure modes and automated fallbacks

### Key Architectural Decisions:
- `docs/adr/001-architecture-selection.md`: 001-architecture-selection
- `docs/adr/001-cloudflare-native-architecture.md`: 001-cloudflare-native-architecture
- `docs/adr/002-key-encryption-and-logging.md`: 002-key-encryption-and-logging

---

## 🛠️ 5. Next Steps for Autonomous Implementation
Invoke **Workflow 2: Hierarchical Implementation & Verification Engine (HIVE)** to decompose this specification into Pods and build against `cases.yaml`.
