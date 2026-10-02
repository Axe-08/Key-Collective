/**
 * Archived in WP-7.6 (T-7.6.1):
 * Lazy HKDF migration branch previously inside `resolveLeasedKey` (src/worker/router/core/key_resolver.ts).
 *
 * When `row.hkdf_migrated !== 1`, this branch decrypted the row via the legacy global master key,
 * re-encrypted with `deriveTenantKey(resolvedMasterKey, row.tenant_id)`, and updated `hkdf_migrated = 1` in D1.
 */
