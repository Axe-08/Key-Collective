-- Migration: 0003_v3_5_governance.sql
-- Description: Update users table with sybil_score, auth_phase, role and create audit_logs table

-- 1. Ensure users table exists before altering
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    tier TEXT NOT NULL DEFAULT 'probationary',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Update users table with governance and anti-sybil fields
ALTER TABLE users ADD COLUMN sybil_score INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN auth_phase INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';

-- 3. Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT,
    action TEXT NOT NULL,
    ip_address TEXT,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
