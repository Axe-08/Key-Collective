package domain

import "time"

// KeyStatus represents the health and availability of an API key
type KeyStatus string

const (
	KeyStatusHealthy     KeyStatus = "Healthy"
	KeyStatusRateLimited KeyStatus = "RateLimited"
	KeyStatusDegraded    KeyStatus = "Degraded"
	KeyStatusDisabled    KeyStatus = "Disabled"
)

// AuthToken represents a tenant's authorization token for the proxy
type AuthToken struct {
	ID                  string    `json:"id"`
	HashSHA256          string    `json:"hash_sha256"`
	TenantID            string    `json:"tenant_id"`
	BudgetMicrodollars  int64     `json:"budget_microdollars"`
	SpentMicrodollars   int64     `json:"spent_microdollars"`
	AllowedProviders    []string  `json:"allowed_providers"`
	RPMLimit            int       `json:"rpm_limit"`
	CreatedAt           time.Time `json:"created_at"`
}

// APIKey represents a provider API key and its state
type APIKey struct {
	ID               string    `json:"id"`
	TenantID         string    `json:"tenant_id"`
	Label            string    `json:"label"`
	Provider         string    `json:"provider"`
	EncryptedKey     []byte    `json:"encrypted_key"` // AES-256-GCM encrypted
	KeyPrefix        string    `json:"key_prefix"`
	KeySuffix        string    `json:"key_suffix"`
	RPMLimit         int       `json:"rpm_limit"`
	RPDLimit         int       `json:"rpd_limit"`
	Priority         int       `json:"priority"`
	Status           KeyStatus `json:"status"`
	LastUsedAt       time.Time `json:"last_used_at"`
	CircuitOpenUntil time.Time `json:"circuit_open_until"`
}

// ModelDef defines the capabilities, pricing, and status of an AI model
type ModelDef struct {
	ID                         string     `json:"id"`
	Provider                   string     `json:"provider"`
	LogicalAliases             []string   `json:"logical_aliases"`
	ContextWindow              int        `json:"context_window"`
	MaxOutputTokens            int        `json:"max_output_tokens"`
	InputCostPerMTokMicro      int64      `json:"input_cost_per_mtok_micro"`
	OutputCostPerMTokMicro     int64      `json:"output_cost_per_mtok_micro"`
	CacheReadCostPerMTokMicro  int64      `json:"cache_read_cost_per_mtok_micro"`
	SupportsTools              bool       `json:"supports_tools"`
	SupportsVision             bool       `json:"supports_vision"`
	SupportsJSONSchema         bool       `json:"supports_json_schema"`
	DeprecatedAt               *time.Time `json:"deprecated_at"`
	SunsetAt                   *time.Time `json:"sunset_at"`
	IsActive                   bool       `json:"is_active"`
	LastSyncedAt               time.Time  `json:"last_synced_at"`
}

// CostLedgerEvent records the financial impact of a single request
type CostLedgerEvent struct {
	ID                string    `json:"id"`
	RequestID         string    `json:"request_id"`
	TenantID          string    `json:"tenant_id"`
	KeyID             string    `json:"key_id"`
	Provider          string    `json:"provider"`
	ModelID           string    `json:"model_id"`
	PromptTokens      int       `json:"prompt_tokens"`
	CompletionTokens  int       `json:"completion_tokens"`
	CachedTokens      int       `json:"cached_tokens"`
	ReasoningTokens   int       `json:"reasoning_tokens"`
	CostMicrodollars  int64     `json:"cost_microdollars"`
	LatencyMs         int64     `json:"latency_ms"`
	StatusCode        int       `json:"status_code"`
	CreatedAt         time.Time `json:"created_at"`
}

// DailySpendRollup aggregates spending for a tenant over a calendar day
type DailySpendRollup struct {
	TenantID             string `json:"tenant_id"`
	Day                  string `json:"day"` // YYYY-MM-DD
	Provider             string `json:"provider"`
	ModelID              string `json:"model_id"`
	TotalRequests        int64  `json:"total_requests"`
	TotalTokens          int64  `json:"total_tokens"`
	TotalCostMicrodollars int64  `json:"total_cost_microdollars"`
}

// RequestLog captures full telemetry for a proxy request
type RequestLog struct {
	ID               string    `json:"id"`
	RequestID        string    `json:"request_id"`
	TenantID         string    `json:"tenant_id"`
	KeyID            string    `json:"key_id"`
	Provider         string    `json:"provider"`
	ModelID          string    `json:"model_id"`
	StatusCode       int       `json:"status_code"`
	LatencyMs        int64     `json:"latency_ms"`
	BytesIn          int64     `json:"bytes_in"`
	BytesOut         int64     `json:"bytes_out"`
	PromptTokens     int       `json:"prompt_tokens"`
	CompletionTokens int       `json:"completion_tokens"`
	CachedTokens     int       `json:"cached_tokens"`
	CostMicrodollars int64     `json:"cost_microdollars"`
	CreatedAt        time.Time `json:"created_at"`
}

// RouterDecision captures the reasoning behind the routing choice
type RouterDecision struct {
	SelectedKeyID          string `json:"selected_key_id"`
	SelectedModelID        string `json:"selected_model_id"`
	TenantID               string `json:"tenant_id"`
	CapabilityFilterPassed bool   `json:"capability_filter_passed"`
	Reason                 string `json:"reason"`
}

// ProxyRequest represents the fully resolved parameters for a request container
type ProxyRequest struct {
	RequestID             string `json:"request_id"`
	TenantID              string `json:"tenant_id"`
	OriginalModel         string `json:"original_model"`
	ResolvedModel         string `json:"resolved_model"`
	ResolvedKey           APIKey `json:"resolved_key"`
	PromptTokensEstimated int    `json:"prompt_tokens_estimated"`
	HasTools              bool   `json:"has_tools"`
	HasVision             bool   `json:"has_vision"`
	RequiresJSONSchema    bool   `json:"requires_json_schema"`
}

// D1Schema defines the SQLite schema for the Cloudflare D1 persistence layer
const D1Schema = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS auth_tokens (
    id TEXT PRIMARY KEY,
    hash_sha256 TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    budget_microdollars INTEGER NOT NULL DEFAULT 0,
    spent_microdollars INTEGER NOT NULL DEFAULT 0,
    allowed_providers TEXT, -- JSON array
    rpm_limit INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_tenant ON auth_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(hash_sha256);

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    label TEXT NOT NULL,
    provider TEXT NOT NULL,
    encrypted_key BLOB NOT NULL,
    key_prefix TEXT NOT NULL,
    key_suffix TEXT NOT NULL,
    rpm_limit INTEGER NOT NULL DEFAULT 0,
    rpd_limit INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Healthy',
    last_used_at DATETIME,
    circuit_open_until DATETIME
);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_provider ON api_keys(tenant_id, provider);

CREATE TABLE IF NOT EXISTS model_defs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    logical_aliases TEXT, -- JSON array
    context_window INTEGER NOT NULL,
    max_output_tokens INTEGER NOT NULL,
    input_cost_per_mtok_micro INTEGER NOT NULL,
    output_cost_per_mtok_micro INTEGER NOT NULL,
    cache_read_cost_per_mtok_micro INTEGER NOT NULL,
    supports_tools BOOLEAN NOT NULL DEFAULT 0,
    supports_vision BOOLEAN NOT NULL DEFAULT 0,
    supports_json_schema BOOLEAN NOT NULL DEFAULT 0,
    deprecated_at DATETIME,
    sunset_at DATETIME,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    last_synced_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_ledger_events (
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
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_events_tenant_time ON cost_ledger_events(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS daily_spend_rollups (
    tenant_id TEXT NOT NULL,
    day TEXT NOT NULL,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    total_requests INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_microdollars INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, day, provider, model_id)
);
`
