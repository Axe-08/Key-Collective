# Low-Level Design: Contracts and Types

## Overview
This document defines the TypeScript data contracts and types for the Key Collective v2 system. It translates the core domain models (Auth, Keys, Models, Ledger) into strict TypeScript interfaces, ensuring no `any` types and strict adherence to architectural invariants (e.g., microdollars for financials, tenant isolation).

## Core Contracts

### Auth (`src/contracts/auth.ts`)
- `AuthToken`: Interface for bearer tokens.
- Fields: `id`, `hash_sha256`, `tenant_id`, `budget_microdollars`, `spent_microdollars`, `allowed_providers`, `rpm_limit`, `created_at`.

### Key Pool (`src/contracts/key_pool.ts`)
- `KeyStatus`: Union type `"Healthy" | "RateLimited" | "Degraded" | "Disabled"`.
- `APIKey`: Interface for provider keys.
- Fields: `id`, `tenant_id`, `label`, `provider`, `encrypted_key_b64`, `nonce_b64`, `key_prefix`, `key_suffix`, `rpm_limit`, `rpd_limit`, `priority`, `status`, `circuit_open_until`, `last_used_at`.

### Router (`src/contracts/router.ts`)
- `Provider`: Union type `"gemini" | "groq" | "openai" | "anthropic"`.
- `ModelDef`: Interface for models.
- Fields: `id`, `provider`, `logical_aliases`, `context_window`, `max_output_tokens`, `input_cost_per_mtok_micro`, `output_cost_per_mtok_micro`, `cache_read_cost_per_mtok_micro`, `supports_tools`, `supports_vision`, `supports_json_schema`, `deprecated_at`, `sunset_at`, `is_active`, `last_synced_at`.
- `RouterDecision`: Interface for routing outcomes.

### Telemetry (`src/contracts/telemetry.ts`)
- `CostLedgerEvent`: Request metadata and cost.
- Fields: `id`, `request_id`, `tenant_id`, `key_id`, `provider`, `model_id`, `prompt_tokens`, `completion_tokens`, `cached_tokens`, `reasoning_tokens`, `cost_microdollars`, `latency_ms`, `status_code`, `created_at`.
- `DailySpendRollup`: Aggregated costs.

## Constants (`src/constants/index.ts`)
- `MICRODOLLAR_MULTIPLIER`: 1,000,000.
- Fallback RPM/RPD limits.

## Errors (`src/errors/index.ts`)
- Standardized custom errors: `AuthError`, `RateLimitError`, `KeyExhaustionError`, `RoutingError`.

## Invariants
- All costs must be typed as `number` but strictly enforced to hold integer values (representing microdollars).
- Strict mode TypeScript, no `any`.
