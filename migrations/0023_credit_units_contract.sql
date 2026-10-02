-- ============================================================================
-- Migration 0023: Credit Units Contract (WP-7.3)
-- Drops deprecated microdollar columns, daily_spend_rollup, and compatibility views.
-- ============================================================================

UPDATE cost_ledger SET cu = 10 + ((prompt_tokens + 999) / 1000)
                          + (((completion_tokens + COALESCE(reasoning_tokens, 0)) * 4 + 999) / 1000)
 WHERE cu IS NULL;

DROP VIEW IF EXISTS cost_ledger_events;
DROP VIEW IF EXISTS daily_spend_rollups;
DROP VIEW IF EXISTS model_defs;

ALTER TABLE cost_ledger DROP COLUMN cost_microdollars;

DROP INDEX IF EXISTS idx_daily_spend_rollup_tenant_day;
DROP TABLE IF EXISTS daily_spend_rollup;

ALTER TABLE auth_tokens DROP COLUMN budget_microdollars;
ALTER TABLE auth_tokens DROP COLUMN spent_microdollars;

ALTER TABLE contributor_standing DROP COLUMN community_debt_micro_cu;
