-- Migration: 0014_schema_repair.sql
-- Description: Recreate consent_attestations with CHECKs and append-only triggers,
--              rebuild project_hash_registry with INTEGER epoch ms timestamps,
--              rebuild api_keys with CHECKs, normalized statuses, DEFAULT 'PRIVATE' pool_type, and INTEGER epoch ms timestamps.

-- ============================================================================
-- 1. consent_attestations: Drop & recreate with strict schema and append-only triggers
-- ============================================================================
DROP TABLE IF EXISTS consent_attestations;

CREATE TABLE consent_attestations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('REGISTRATION', 'KEY_SUBMISSION')),
    checkbox_id TEXT NOT NULL CHECK (checkbox_id IN ('C1', 'C2', 'C3', 'K1', 'K2')),
    consent_version TEXT NOT NULL,
    key_id TEXT,
    attested_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX idx_consent_tenant ON consent_attestations(tenant_id, event_type);

CREATE TRIGGER consent_no_update
BEFORE UPDATE ON consent_attestations
BEGIN
    SELECT RAISE(ABORT, 'append-only');
END;

CREATE TRIGGER consent_no_delete
BEFORE DELETE ON consent_attestations
BEGIN
    SELECT RAISE(ABORT, 'append-only');
END;

-- ============================================================================
-- 2. project_hash_registry: Rebuild table with INTEGER epoch ms timestamps
-- ============================================================================
CREATE TABLE project_hash_registry_rebuild (
    project_hash TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'ROTATING', 'TOMBSTONED')),
    rotating_until INTEGER,
    tombstone_until INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO project_hash_registry_rebuild (
    project_hash,
    tenant_id,
    provider,
    state,
    rotating_until,
    tombstone_until,
    created_at,
    updated_at
)
SELECT
    project_hash,
    tenant_id,
    provider,
    state,
    CASE
        WHEN rotating_until IS NULL THEN NULL
        WHEN unixepoch(rotating_until) IS NOT NULL THEN CAST(unixepoch(rotating_until) * 1000 AS INTEGER)
        WHEN CAST(rotating_until AS INTEGER) >= 1000000000000 THEN CAST(rotating_until AS INTEGER)
        WHEN CAST(rotating_until AS INTEGER) > 0 THEN CAST(rotating_until AS INTEGER) * 1000
        ELSE NULL
    END,
    CASE
        WHEN tombstone_until IS NULL THEN NULL
        WHEN unixepoch(tombstone_until) IS NOT NULL THEN CAST(unixepoch(tombstone_until) * 1000 AS INTEGER)
        WHEN CAST(tombstone_until AS INTEGER) >= 1000000000000 THEN CAST(tombstone_until AS INTEGER)
        WHEN CAST(tombstone_until AS INTEGER) > 0 THEN CAST(tombstone_until AS INTEGER) * 1000
        ELSE NULL
    END,
    CASE
        WHEN created_at IS NULL THEN CAST(unixepoch() * 1000 AS INTEGER)
        WHEN unixepoch(created_at) IS NOT NULL THEN CAST(unixepoch(created_at) * 1000 AS INTEGER)
        WHEN CAST(created_at AS INTEGER) >= 1000000000000 THEN CAST(created_at AS INTEGER)
        WHEN CAST(created_at AS INTEGER) > 0 THEN CAST(created_at AS INTEGER) * 1000
        ELSE CAST(unixepoch() * 1000 AS INTEGER)
    END,
    CASE
        WHEN updated_at IS NULL THEN CAST(unixepoch() * 1000 AS INTEGER)
        WHEN unixepoch(updated_at) IS NOT NULL THEN CAST(unixepoch(updated_at) * 1000 AS INTEGER)
        WHEN CAST(updated_at AS INTEGER) >= 1000000000000 THEN CAST(updated_at AS INTEGER)
        WHEN CAST(updated_at AS INTEGER) > 0 THEN CAST(updated_at AS INTEGER) * 1000
        ELSE CAST(unixepoch() * 1000 AS INTEGER)
    END
FROM project_hash_registry;

DROP TABLE project_hash_registry;
ALTER TABLE project_hash_registry_rebuild RENAME TO project_hash_registry;
CREATE INDEX idx_project_hash_tenant ON project_hash_registry(tenant_id);

-- ============================================================================
-- 3. api_keys: Rebuild table with constraints, normalized values, and INTEGER epoch ms
-- ============================================================================
CREATE TABLE api_keys_rebuild (
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
    status TEXT COLLATE NOCASE NOT NULL CHECK (status IN ('HEALTHY','COOLDOWN','QUARANTINED','REVOKED')) DEFAULT 'HEALTHY',
    pool_type TEXT COLLATE NOCASE NOT NULL CHECK (pool_type IN ('PRIVATE','COMMUNITY')) DEFAULT 'PRIVATE',
    community_routing_status TEXT DEFAULT 'OBSERVATION' CHECK (community_routing_status IN ('OBSERVATION', 'ACTIVE', 'QUARANTINED', 'REVOKED')),
    observation_until INTEGER,
    circuit_open_until INTEGER,
    last_used_at INTEGER,
    revoked_at INTEGER,
    status_changed_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    key_hash TEXT,
    provider_project_hash TEXT,
    hkdf_migrated INTEGER NOT NULL DEFAULT 0,
    dispatched_today INTEGER DEFAULT 0,
    dispatched_communal INTEGER DEFAULT 0,
    vesting_tier INTEGER DEFAULT 0,
    sync_pending INTEGER NOT NULL DEFAULT 0,
    key_version INTEGER NOT NULL DEFAULT 1
);

INSERT INTO api_keys_rebuild (
    id,
    tenant_id,
    label,
    provider,
    encrypted_key_b64,
    nonce_b64,
    key_prefix,
    key_suffix,
    rpm_limit,
    rpd_limit,
    priority,
    status,
    pool_type,
    community_routing_status,
    observation_until,
    circuit_open_until,
    last_used_at,
    revoked_at,
    status_changed_at,
    created_at,
    key_hash,
    provider_project_hash,
    hkdf_migrated,
    dispatched_today,
    dispatched_communal,
    vesting_tier,
    sync_pending,
    key_version
)
SELECT
    id,
    tenant_id,
    label,
    provider,
    encrypted_key_b64,
    nonce_b64,
    key_prefix,
    key_suffix,
    rpm_limit,
    rpd_limit,
    priority,
    CASE LOWER(COALESCE(status, ''))
        WHEN 'healthy' THEN 'HEALTHY'
        WHEN 'invalid' THEN CASE WHEN community_routing_status = 'REVOKED' THEN 'REVOKED' ELSE 'QUARANTINED' END
        WHEN 'quarantined' THEN 'QUARANTINED'
        WHEN 'exhausted' THEN 'COOLDOWN'
        WHEN 'rate_limited' THEN 'COOLDOWN'
        WHEN 'cooldown' THEN 'COOLDOWN'
        WHEN 'revoked' THEN 'REVOKED'
        ELSE 'QUARANTINED'
    END,
    CASE
        WHEN pool_type IS NULL THEN 'PRIVATE'
        WHEN LOWER(pool_type) = 'community' THEN 'COMMUNITY'
        ELSE 'PRIVATE'
    END,
    community_routing_status,
    CASE
        WHEN observation_until IS NULL THEN NULL
        WHEN unixepoch(observation_until) IS NOT NULL THEN CAST(unixepoch(observation_until) * 1000 AS INTEGER)
        WHEN CAST(observation_until AS INTEGER) >= 1000000000000 THEN CAST(observation_until AS INTEGER)
        WHEN CAST(observation_until AS INTEGER) > 0 THEN CAST(observation_until AS INTEGER) * 1000
        ELSE NULL
    END,
    CASE
        WHEN circuit_open_until IS NULL THEN NULL
        WHEN unixepoch(circuit_open_until) IS NOT NULL THEN CAST(unixepoch(circuit_open_until) * 1000 AS INTEGER)
        WHEN CAST(circuit_open_until AS INTEGER) >= 1000000000000 THEN CAST(circuit_open_until AS INTEGER)
        WHEN CAST(circuit_open_until AS INTEGER) > 0 THEN CAST(circuit_open_until AS INTEGER) * 1000
        ELSE NULL
    END,
    CASE
        WHEN last_used_at IS NULL THEN NULL
        WHEN unixepoch(last_used_at) IS NOT NULL THEN CAST(unixepoch(last_used_at) * 1000 AS INTEGER)
        WHEN CAST(last_used_at AS INTEGER) >= 1000000000000 THEN CAST(last_used_at AS INTEGER)
        WHEN CAST(last_used_at AS INTEGER) > 0 THEN CAST(last_used_at AS INTEGER) * 1000
        ELSE NULL
    END,
    CASE
        WHEN revoked_at IS NULL THEN NULL
        WHEN unixepoch(revoked_at) IS NOT NULL THEN CAST(unixepoch(revoked_at) * 1000 AS INTEGER)
        WHEN CAST(revoked_at AS INTEGER) >= 1000000000000 THEN CAST(revoked_at AS INTEGER)
        WHEN CAST(revoked_at AS INTEGER) > 0 THEN CAST(revoked_at AS INTEGER) * 1000
        ELSE NULL
    END,
    NULL,
    CASE
        WHEN created_at IS NULL THEN CAST(unixepoch() * 1000 AS INTEGER)
        WHEN unixepoch(created_at) IS NOT NULL THEN CAST(unixepoch(created_at) * 1000 AS INTEGER)
        WHEN CAST(created_at AS INTEGER) >= 1000000000000 THEN CAST(created_at AS INTEGER)
        WHEN CAST(created_at AS INTEGER) > 0 THEN CAST(created_at AS INTEGER) * 1000
        ELSE CAST(unixepoch() * 1000 AS INTEGER)
    END,
    key_hash,
    provider_project_hash,
    COALESCE(hkdf_migrated, 0),
    COALESCE(dispatched_today, 0),
    COALESCE(dispatched_communal, 0),
    COALESCE(vesting_tier, 0),
    0,
    1
FROM api_keys;

DROP TABLE api_keys;
ALTER TABLE api_keys_rebuild RENAME TO api_keys;

CREATE INDEX idx_api_keys_tenant_provider ON api_keys (tenant_id, provider, status);
CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id);
CREATE INDEX idx_api_keys_pool_status ON api_keys(pool_type, community_routing_status);
CREATE INDEX idx_api_keys_observation ON api_keys(observation_until);
CREATE INDEX idx_api_keys_hkdf ON api_keys(hkdf_migrated);
CREATE UNIQUE INDEX idx_api_keys_key_hash ON api_keys(key_hash) WHERE key_hash IS NOT NULL;
