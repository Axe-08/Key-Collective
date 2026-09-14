CREATE TABLE contributor_standing (
    tenant_id TEXT PRIMARY KEY,
    community_debt_micro_cu INTEGER NOT NULL DEFAULT 0,
    daily_contributed_cu INTEGER NOT NULL DEFAULT 0,
    consecutive_debt_free_days INTEGER NOT NULL DEFAULT 0,
    trusted_contributor BOOLEAN NOT NULL DEFAULT FALSE,
    multiplier_ceiling INTEGER NOT NULL DEFAULT 100,
    current_multiplier INTEGER NOT NULL DEFAULT 100,
    last_decay_at TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE consent_attestations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    checkbox_id TEXT NOT NULL,
    attested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX idx_consent_tenant ON consent_attestations(tenant_id);
