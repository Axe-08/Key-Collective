CREATE TABLE project_hash_registry (
    project_hash TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'ROTATING', 'TOMBSTONED')),
    rotating_until TIMESTAMP,
    tombstone_until TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_project_hash_tenant ON project_hash_registry(tenant_id);
