"""
data_contracts.py — Key Collective v2 Domain Contracts (TypeScript Reference)

NOTE: Key Collective v2 is a TypeScript-first project (Cloudflare Workers + Durable Objects).
The authoritative data contracts live in:

  - docs/data_contracts.go    → v1 Go struct definitions (archived, for reference)
  - The canonical v2 contracts are defined as TypeScript interfaces in the Workers codebase.

This file exists to satisfy the ai-ml-system deliverable manifest (which expects data_contracts.py).
It re-exports the v2 schema as Python TypedDicts for any Python-based tooling (eval harnesses,
data pipeline scripts, golden test runners).
"""

from __future__ import annotations
from typing import TypedDict, Optional
from datetime import datetime


class AuthToken(TypedDict):
    id: str
    hash_sha256: str           # SHA-256 of the raw token, stored in D1
    tenant_id: str
    budget_microdollars: int   # 1 USD = 1_000_000 µ$ — NO floats
    spent_microdollars: int
    allowed_providers: list[str]
    rpm_limit: int
    created_at: str            # ISO-8601


class APIKey(TypedDict):
    id: str
    tenant_id: str
    label: str
    provider: str              # "gemini" | "groq" | "openai" | "anthropic"
    encrypted_key_b64: str     # AES-256-GCM ciphertext, base64-encoded
    nonce_b64: str             # 12-byte GCM nonce, base64-encoded
    key_prefix: str
    key_suffix: str
    rpm_limit: int
    rpd_limit: int
    priority: int
    status: str                # "Healthy" | "RateLimited" | "Degraded" | "Disabled"
    circuit_open_until: Optional[str]   # ISO-8601 or None
    last_used_at: Optional[str]


class ModelDef(TypedDict):
    id: str                    # e.g. "gemini-2.0-flash"
    provider: str
    logical_aliases: list[str] # e.g. ["smart-fast", "fast"]
    context_window: int
    max_output_tokens: int
    input_cost_per_mtok_micro: int    # int64 microdollars per 1M input tokens
    output_cost_per_mtok_micro: int   # int64 microdollars per 1M output tokens
    cache_read_cost_per_mtok_micro: int
    supports_tools: bool
    supports_vision: bool
    supports_json_schema: bool
    deprecated_at: Optional[str]      # ISO-8601 or None
    sunset_at: Optional[str]          # ISO-8601 or None
    is_active: bool
    last_synced_at: str


class CostLedgerEvent(TypedDict):
    id: str
    request_id: str
    tenant_id: str
    key_id: str
    provider: str
    model_id: str
    prompt_tokens: int
    completion_tokens: int
    cached_tokens: int
    reasoning_tokens: int
    cost_microdollars: int    # MUST be computed as integer: (tokens * price_micro) // 1_000_000
    latency_ms: int
    status_code: int
    created_at: str


class DailySpendRollup(TypedDict):
    tenant_id: str
    day: str                  # "YYYY-MM-DD"
    provider: str
    model_id: str
    total_requests: int
    total_tokens: int
    total_cost_microdollars: int


class RouterDecision(TypedDict):
    selected_key_id: str
    selected_model_id: str
    tenant_id: str
    capability_filter_passed: bool
    reason: str               # e.g. "cost_optimal" | "fallback_429" | "context_overflow_escalation"


# D1 Schema (canonical SQL — also present in docs/data_contracts.go as Go const)
D1_SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS auth_tokens (
    id TEXT PRIMARY KEY,
    hash_sha256 TEXT NOT NULL UNIQUE,
    tenant_id TEXT NOT NULL,
    budget_microdollars INTEGER NOT NULL DEFAULT 0,
    spent_microdollars INTEGER NOT NULL DEFAULT 0,
    allowed_providers TEXT NOT NULL DEFAULT '[]',
    rpm_limit INTEGER NOT NULL DEFAULT 60,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS cost_ledger (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    key_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    cost_microdollars INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    status_code INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_tenant_time ON cost_ledger (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_key_time ON cost_ledger (key_id, created_at);

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
"""
