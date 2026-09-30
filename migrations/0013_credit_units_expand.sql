ALTER TABLE cost_ledger ADD COLUMN cu INTEGER;
ALTER TABLE cost_ledger ADD COLUMN usage_estimated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cost_ledger ADD COLUMN borrowed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cost_ledger ADD COLUMN lender_tenant_id TEXT;
UPDATE cost_ledger SET cu = 10 + ((prompt_tokens + 999) / 1000)
                          + (((completion_tokens + reasoning_tokens) * 4 + 999) / 1000)
 WHERE cu IS NULL;
CREATE TABLE daily_cu_rollup (
  tenant_id TEXT NOT NULL, day TEXT NOT NULL, provider TEXT NOT NULL, model_id TEXT NOT NULL,
  total_requests INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
  total_cu INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day, provider, model_id));
CREATE INDEX idx_daily_cu_rollup_tenant_day ON daily_cu_rollup (tenant_id, day);
INSERT INTO daily_cu_rollup (tenant_id, day, provider, model_id, total_requests, total_tokens, total_cu)
  SELECT tenant_id, day, provider, model_id, total_requests, total_tokens, 0 FROM daily_spend_rollup;
ALTER TABLE auth_tokens ADD COLUMN budget_cu INTEGER;
ALTER TABLE auth_tokens ADD COLUMN spent_cu INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contributor_standing ADD COLUMN community_debt_cu INTEGER NOT NULL DEFAULT 0;
