-- WP-5.3 T-5.3.1: Add sliding-window contribution, multiplier_pct, jail_status, and last_reset_day to contributor_standing

ALTER TABLE contributor_standing ADD COLUMN contributed_cu_24h INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contributor_standing ADD COLUMN multiplier_pct INTEGER NOT NULL DEFAULT 100;
ALTER TABLE contributor_standing ADD COLUMN jail_status TEXT NOT NULL DEFAULT 'PRISTINE';
ALTER TABLE contributor_standing ADD COLUMN last_reset_day TEXT;
