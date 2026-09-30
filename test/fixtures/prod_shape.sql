-- test/fixtures/prod_shape.sql
--
-- Production-shaped seed data applied on top of migrations 0001 and 0002
-- (auth_tokens, api_keys, projects) to exercise the remaining migrations
-- against realistic, messy production data shapes:
--   - mixed-case api_keys.status values ('Healthy', 'healthy', 'invalid', 'quarantined')
--   - projects timestamps stored as epoch seconds (INTEGER)
--   - api_keys timestamps stored as ISO 8601 strings
--   - exactly one row scoped to tenant_id 'default'

INSERT INTO auth_tokens (
    id, hash_sha256, tenant_id, encrypted_token_b64, nonce_b64,
    budget_microdollars, spent_microdollars, allowed_providers, rpm_limit,
    expires_at, created_at
) VALUES
    ('tok_default', 'hash_default_0000000000000000000000000000000000000000', 'default', 'ZGVmYXVsdA==', 'bm9uY2Uw', 1000000, 0, '["gemini","openai"]', 60, NULL, '2024-01-01T00:00:00.000Z'),
    ('tok_acme', 'hash_acme_00000000000000000000000000000000000000000', 'tenant_acme', 'YWNtZQ==', 'bm9uY2Ux', 2000000, 500000, '["anthropic"]', 120, NULL, '2024-02-01T00:00:00.000Z');

INSERT INTO projects (
    id, name, tenant_id, description, created_at, updated_at
) VALUES
    ('proj_default', 'Default Project', 'default', 'Seeded default-tenant project', 1704067200, 1704067200),
    ('proj_acme_1', 'Acme Primary', 'tenant_acme', 'Seeded acme project', 1706745600, 1706745600),
    ('proj_acme_2', 'Acme Secondary', 'tenant_acme', NULL, 1709251200, 1709251200);

INSERT INTO api_keys (
    id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
    key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
    circuit_open_until, last_used_at, created_at
) VALUES
    ('key_default_healthy', 'default', 'Default Healthy Key', 'gemini', 'ZW5jcnlwdGVkMQ==', 'bm9uY2UxMQ==', 'AIza', 'abcd', 60, 1500, 0, 'Healthy', NULL, '2024-03-01T12:00:00.000Z', '2024-01-05T09:30:00.000Z'),
    ('key_acme_healthy_lower', 'tenant_acme', 'Acme Lowercase Healthy Key', 'openai', 'ZW5jcnlwdGVkMg==', 'bm9uY2UyMg==', 'sk-p', 'ef12', 60, 1500, 1, 'healthy', NULL, '2024-03-02T08:15:00.000Z', '2024-02-05T10:00:00.000Z'),
    ('key_acme_invalid', 'tenant_acme', 'Acme Invalid Key', 'anthropic', 'ZW5jcnlwdGVkMw==', 'bm9uY2UzMw==', 'sk-a', 'gh34', 60, 1500, 2, 'invalid', NULL, NULL, '2024-02-10T14:45:00.000Z'),
    ('key_acme_quarantined', 'tenant_acme', 'Acme Quarantined Key', 'groq', 'ZW5jcnlwdGVkNA==', 'bm9uY2U0NA==', 'gsk_', 'ij56', 60, 1500, 3, 'quarantined', '2024-04-01T00:00:00.000Z', '2024-03-15T18:20:00.000Z', '2024-02-15T11:10:00.000Z');
