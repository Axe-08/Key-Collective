/**
 * HKDF Per-Tenant Key Re-Encryption Migration Script (Phase C.1)
 */

import { deriveTenantKey, encrypt, decrypt } from '../src/crypto/encryption';

export async function migrateKeysToHkdf(
  db: D1Database,
  masterKey: string,
  batchSize = 50
): Promise<{ migrated: number; skipped: number; errors: number }> {
  let migrated = 0, skipped = 0, errors = 0;
  let offset = 0;

  while (true) {
    const batch = await db.prepare(`
      SELECT id, tenant_id, encrypted_key_b64 as ciphertext, nonce_b64 as nonce
      FROM api_keys
      WHERE status != 'invalid' AND (hkdf_migrated IS NULL OR hkdf_migrated = 0)
      LIMIT ? OFFSET ?
    `).bind(batchSize, offset).all<{
      id: string; tenant_id: string; ciphertext: string; nonce: string;
    }>();

    if (!batch.results || batch.results.length === 0) break;

    for (const row of batch.results) {
      try {
        const plaintext = await decrypt(row.ciphertext, masterKey, row.nonce);
        const tenantKey = await deriveTenantKey(masterKey, row.tenant_id);
        const { ciphertextB64, nonceB64 } = await encrypt(plaintext, tenantKey);
        await db.prepare(`
          UPDATE api_keys SET encrypted_key_b64 = ?, nonce_b64 = ?, hkdf_migrated = 1 WHERE id = ?
        `).bind(ciphertextB64, nonceB64, row.id).run();
        migrated++;
      } catch (e) {
        console.error(`Failed to migrate key ${row.id}:`, e instanceof Error ? e.message : String(e));
        errors++;
      }
    }
    offset += batchSize;
  }

  return { migrated, skipped, errors };
}
