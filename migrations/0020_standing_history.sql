-- Migration 0020: Standing history table for nightly reset records (T-5.4.1)
CREATE TABLE IF NOT EXISTS standing_history (
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  multiplier_pct INTEGER NOT NULL,
  debt_cu INTEGER NOT NULL,
  contributed_cu_24h INTEGER NOT NULL,
  jail_status TEXT NOT NULL,
  PRIMARY KEY (tenant_id, day)
);
