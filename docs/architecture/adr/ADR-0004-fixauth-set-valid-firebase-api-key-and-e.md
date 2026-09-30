# ADR-0004: fix(auth): set valid Firebase API key and enable public unauthenticated model pricing discovery

- **Status:** Accepted (Retroactively Mined)
- **Date:** 2026-09-13
- **Author:** Axe-08
- **Git Commit:** `8588e71a`
- **Category:** Security & Governance Boundary

---

## Context & Problem Statement
Historical commit analysis identified an architectural milestone in the evolution of the codebase.
Commit subject: *"fix(auth): set valid Firebase API key and enable public unauthenticated model pricing discovery"*.

## Decision Rationale
The team introduced this architectural change to establish clean boundaries and advance project capabilities.

## Consequences
- **Positive:** Established the `Security & Governance Boundary` pattern across the codebase.
- **Negative / Trade-offs:** Required updating call sites and downstream dependencies.

## Verification
- Validated via canonical test suites and commit integrity.
