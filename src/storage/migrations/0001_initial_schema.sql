-- Key Collective v2 — D1 Database Migration
-- Migration: 0001_initial_schema.sql
-- Description: Initial schema for auth tokens, API keys, model registry, cost ledger, and daily spend rollups.
--
-- Invariants Enforced (GEMINI.md Constitution):
-- 1. No Plaintext Keys:
--    All API keys are encrypted at rest using AES-256-GCM (Web Crypto API).
--    The unique 12-byte initialization vector (nonce) is stored alongside ciphertext
--    as `nonce_b64` and `encrypted_key_b64`. Plaintext keys are never stored in D1.
-- 2. Fixed-Point Microdollars:
--    All financial amounts (budgets, spent totals, model token pricing, cost ledger events,
--    and daily rollups) are stored as 64-bit integers (INTEGER in SQLite) in microdollars
--    (1 USD = 1,000,000 µ$). Zero floating-point math for financials.
-- 3. Per-Tenant Isolation:
--    All tenant-scoped tables feature explicit `tenant_id` columns with indexing for strict tenant compute & storage boundaries.

PRAGMA journal_mode = WAL;

-- ============================================================================
-- 1. Authentication Tokens (auth_tokens)
-- ============================================================================
-- Stores tenant Bearer tokens hashed via SHA-256 (hash_sha256).
-- Token hashes are unique and compared in constant time at runtime.
-- Budgets and expenditure are tracked in fixed-point int64 microdollars.
CREATE TABLE IF NOT EXISTS auth_tokens (
    id TEXT PRIMARY KEY,
    hash_sha256 TEXT NOT NULL UNIQUE,
    tenant_id TEXT NOT NULL,
    budget_microdollars INTEGER NOT NULL DEFAULT 0,
    spent_microdollars INTEGER NOT NULL DEFAULT 0,
    allowed_providers TEXT NOT NULL DEFAULT '[]',
    rpm_limit INTEGER NOT NULL DEFAULT 60,
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_tenant ON auth_tokens (tenant_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens (hash_sha256);

-- ============================================================================
-- 2. Upstream Provider API Keys (api_keys)
-- ============================================================================
-- Stores encrypted credentials for upstream model providers (Gemini, OpenAI, Anthropic, Groq).
-- Keys are encrypted via AES-256-GCM. Plaintext is never stored in persistent storage.
-- Only UI-safe prefix/suffix strings are exposed unencrypted for dashboard display.
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    label TEXT NOT NULL,
    provider TEXT NOT NULL,
    encrypted_key_b64 TEXT NOT NULL,
    nonce_b64 TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_suffix TEXT NOT NULL,
    rpm_limit INTEGER NOT NULL DEFAULT 60,
    rpd_limit INTEGER NOT NULL DEFAULT 1500,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Healthy',
    circuit_open_until TIMESTAMP,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_provider ON api_keys (tenant_id, provider, status);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys (tenant_id);

-- ============================================================================
-- 3. Model Registry (model_registry)
-- ============================================================================
-- Global catalog of supported models, capability flags, context boundaries, and pricing.
-- Token costs are stored in int64 microdollars per 1,000,000 tokens.
CREATE TABLE IF NOT EXISTS model_registry (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    logical_aliases TEXT NOT NULL DEFAULT '[]',
    context_window INTEGER NOT NULL,
    max_output_tokens INTEGER NOT NULL,
    input_cost_per_mtok_micro INTEGER NOT NULL,
    output_cost_per_mtok_micro INTEGER NOT NULL,
    cache_read_cost_per_mtok_micro INTEGER NOT NULL DEFAULT 0,
    supports_tools INTEGER NOT NULL DEFAULT 0,
    supports_vision INTEGER NOT NULL DEFAULT 0,
    supports_json_schema INTEGER NOT NULL DEFAULT 0,
    deprecated_at TIMESTAMP,
    sunset_at TIMESTAMP,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_model_registry_provider ON model_registry (provider, is_active);

-- ============================================================================
-- 4. Cost Ledger (cost_ledger)
-- ============================================================================
-- Immutable transaction ledger recording usage, latency, and financial cost per request.
-- Costs are stored in int64 microdollars calculated with zero floating-point arithmetic.
CREATE TABLE IF NOT EXISTS cost_ledger (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    key_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    cost_microdollars INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    status_code INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cost_ledger_tenant_time ON cost_ledger (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_key_time ON cost_ledger (key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_request ON cost_ledger (request_id);

-- ============================================================================
-- 5. Daily Spend Rollup (daily_spend_rollup)
-- ============================================================================
-- Pre-aggregated daily metrics per tenant, provider, and model for fast billing & reporting.
-- Aggregates request counts, token consumption, and total cost in microdollars.
CREATE TABLE IF NOT EXISTS daily_spend_rollup (
    tenant_id TEXT NOT NULL,
    day DATE NOT NULL,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    total_requests INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_microdollars INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, day, provider, model_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_spend_rollup_tenant_day ON daily_spend_rollup (tenant_id, day);

-- ============================================================================
-- Compatibility Views
-- ============================================================================
-- Support domain contract aliasing across historical and pluralized table references.
CREATE VIEW IF NOT EXISTS cost_ledger_events AS SELECT * FROM cost_ledger;
CREATE VIEW IF NOT EXISTS daily_spend_rollups AS SELECT * FROM daily_spend_rollup;
CREATE VIEW IF NOT EXISTS model_defs AS SELECT * FROM model_registry;
