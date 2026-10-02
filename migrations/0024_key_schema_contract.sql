-- ============================================================================
-- Migration 0024: Key Schema Contract (WP-7.4)
-- Drops legacy api_keys columns: dispatched_today, dispatched_communal, vesting_tier.
-- ============================================================================

DROP INDEX IF EXISTS idx_api_keys_dispatched_today;
DROP INDEX IF EXISTS idx_api_keys_dispatched_communal;
ALTER TABLE api_keys DROP COLUMN dispatched_today;
ALTER TABLE api_keys DROP COLUMN dispatched_communal;
ALTER TABLE api_keys DROP COLUMN vesting_tier;
