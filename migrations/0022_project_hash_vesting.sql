-- WP-5.11 T-5.11.1: Add vesting_started_at to project_hash_registry to preserve vesting across 30-min resubmission windows
ALTER TABLE project_hash_registry ADD COLUMN vesting_started_at INTEGER;
