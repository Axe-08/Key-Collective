-- ============================================================================
-- Migration 0025: Durable would-deny stats (WP-F.10, AU-03)
-- Expand only. Hourly counters per (hour, rule, hashed tenant) so
-- GET /api/admin/commons/would-deny survives isolate restarts and redeploys.
-- ============================================================================

CREATE TABLE IF NOT EXISTS would_deny_hourly (
  hour_utc INTEGER NOT NULL,
  rule TEXT NOT NULL,
  tenant_hash TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_utc, rule, tenant_hash)
);
