# ADR-0044: refactor(router): decouple key_routes into src/worker/router/dashboard/keys subsystem

- **Status:** Accepted (Retroactively Mined)
- **Date:** 2026-09-15
- **Author:** Axe-08
- **Git Commit:** `62af7a57`
- **Category:** Structural Decomposition

---

## Context & Problem Statement
Historical commit analysis identified an architectural milestone in the evolution of the codebase.
Commit subject: *"refactor(router): decouple key_routes into src/worker/router/dashboard/keys subsystem"*.

## Decision Rationale
The team introduced this architectural change to establish clean boundaries and advance project capabilities.

## Consequences
- **Positive:** Established the `Structural Decomposition` pattern across the codebase.
- **Negative / Trade-offs:** Required updating call sites and downstream dependencies.

## Verification
- Validated via canonical test suites and commit integrity.
