ALTER TABLE api_keys ADD COLUMN pool_type TEXT DEFAULT 'COMMUNITY' CHECK (pool_type IN ('PRIVATE', 'COMMUNITY'));
ALTER TABLE api_keys ADD COLUMN community_routing_status TEXT DEFAULT 'OBSERVATION' CHECK (community_routing_status IN ('OBSERVATION', 'ACTIVE', 'QUARANTINED', 'REVOKED'));
ALTER TABLE api_keys ADD COLUMN observation_until TIMESTAMP;
ALTER TABLE api_keys ADD COLUMN dispatched_today INTEGER DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN dispatched_communal INTEGER DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN vesting_tier INTEGER DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN provider_project_hash TEXT;

CREATE INDEX idx_api_keys_pool_status ON api_keys(pool_type, community_routing_status);
CREATE INDEX idx_api_keys_observation ON api_keys(observation_until);
