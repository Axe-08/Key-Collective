-- Add HKDF migration tracking flag to api_keys
ALTER TABLE api_keys ADD COLUMN hkdf_migrated INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_api_keys_hkdf ON api_keys(hkdf_migrated);
