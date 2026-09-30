-- Migration: 0011_security_hotfix.sql
-- Description: Add key_hash and revoked_at columns to api_keys, and create admin_audit_logs table.

ALTER TABLE api_keys ADD COLUMN key_hash TEXT;
CREATE UNIQUE INDEX idx_api_keys_key_hash ON api_keys(key_hash) WHERE key_hash IS NOT NULL;
ALTER TABLE api_keys ADD COLUMN revoked_at INTEGER;

CREATE TABLE admin_audit_logs (
    id TEXT PRIMARY KEY,
    admin_user_id TEXT,
    admin_email TEXT,
    action TEXT NOT NULL,
    target TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    ip_address TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_admin_audit_created ON admin_audit_logs(created_at);
