-- Migration 0021: key_daily_stats table and api_keys.drain_state column (T-5.5.1)
CREATE TABLE IF NOT EXISTS key_daily_stats (
  key_id TEXT NOT NULL,
  day TEXT NOT NULL,
  model TEXT NOT NULL,
  dispatched INTEGER NOT NULL DEFAULT 0,
  communal INTEGER NOT NULL DEFAULT 0,
  cu_served INTEGER NOT NULL DEFAULT 0,
  classification TEXT,
  PRIMARY KEY (key_id, day, model)
);

ALTER TABLE api_keys ADD COLUMN drain_state TEXT NOT NULL DEFAULT 'OK';
