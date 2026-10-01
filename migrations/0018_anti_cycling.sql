-- Migration 0018: Add anti_cycling_until column to api_keys table (WP-5.2)
-- When a submission's project hash had an upstream-revocation tombstone in the prior 24h,
-- anti_cycling_until is set to now + 60min (FR-18).
ALTER TABLE api_keys ADD COLUMN anti_cycling_until INTEGER;
