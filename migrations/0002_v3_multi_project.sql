-- Migration: 0002_v3_multi_project.sql
-- Description: Introduce projects table and update keys table

-- 1. Create projects table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    description TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant_id ON projects(tenant_id);

-- 2. Ensure keys table exists before altering
CREATE TABLE IF NOT EXISTS keys (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL
);

-- 3. Alter keys table to add project_id
ALTER TABLE keys ADD COLUMN project_id TEXT REFERENCES projects(id);

CREATE INDEX IF NOT EXISTS idx_keys_project_id ON keys(project_id);
