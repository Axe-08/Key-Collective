# Low-Level Design (LLD): `pod-packaging-tests`

## 1. Objective
Consolidate database migrations, purge legacy stubs/redundant files, and unify the vitest test suite execution for the Key Collective backend.

## 2. Scope of Changes

### 2.1 Migration Directory Consolidation
- **Context:** The project has fragmented migration paths (`migrations/` and `src/storage/migrations/`).
- **Action:** Ensure `migrations/0001_initial_schema.sql` is synchronized with `src/storage/migrations/0001_initial_schema.sql`, acting as the single source of truth for D1 setup.

### 2.2 Removal of Legacy Files
- **Context:** Leftover files from previous refactors are causing repository bloat.
- **Action:** Delete the following files:
  - `ui/ui.go`: Redundant embedded Go UI asset.
  - `docs/SCORECARD.md.md`: Duplicate markdown artifact.
  - `src/worker/auth.ts`: Superseded by modular auth design.
  - `src/worker/telemetry.ts`: Superseded by modular telemetry design.

### 2.3 Test Suite Inclusion Harmonization
- **Context:** Tests are currently spread across `src/`, `test/`, and `tests/` directories, but not all are captured by the root vitest runner.
- **Action:** Update `vitest.config.ts` to include:
  `include: ['src/**/*.{test,spec}.ts', 'test/**/*.test.ts', 'tests/**/*.test.ts']`
- **Validation:** Execute `npx vitest run` to ensure the comprehensive suite passes strictly under 10 seconds.
