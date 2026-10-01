-- Migration 0016: project-scoped API keys (WP-3.7, D6, D7, D11).
-- Expand only (D-26): migrations run before the new worker deploys, and the running release
-- still writes to the 0002 `keys` stub on project delete, so `DROP TABLE keys` waits for a
-- later contract migration.

ALTER TABLE auth_tokens ADD COLUMN project_id TEXT REFERENCES projects(id);

ALTER TABLE projects ADD COLUMN rpm_sub_cap INTEGER;

ALTER TABLE projects ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;

-- Epoch seconds → milliseconds. Only values that look like seconds are converted, so rows
-- written in ms and a re-run are left alone; the running release may still insert seconds
-- until the deploy, which WP-1.2's reader accepts.
UPDATE projects SET created_at = created_at * 1000 WHERE created_at < 100000000000;

UPDATE projects SET updated_at = updated_at * 1000 WHERE updated_at < 100000000000;
