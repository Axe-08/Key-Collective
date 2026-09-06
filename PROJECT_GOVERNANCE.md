# Key Collective Governance & Constraints

## 1. Active Workflows
- **Codebase Scribe:** Mandatory upon merging significant logic changes to update Codeflow CFGs and Def-Use matrices in `docs/codeflow/`.
- **PR Gatekeeper:** Mandatory for security checks (specifically verifying no plaintext key logging/storage).

## 2. Resource Footprint Goal
- **Target RAM:** < 20MB at idle.
- **Target Container Size:** < 30MB (Go statically linked binary + embedded static files).

## 3. Scope Boundaries
- **v1 Only:** Single-tenant (Akshit), SQLite, Railway Free Tier ($1/mo credit limit).
- **Not allowed:** Multi-tenant complexity, external PostgreSQL, payment processing.
