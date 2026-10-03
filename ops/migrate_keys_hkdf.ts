/**
 * HKDF Per-Tenant Key Re-Encryption Migration Script (WP-4.4 T-4.4.2)
 *
 * Scans api_keys for rows with hkdf_migrated IS NULL OR hkdf_migrated = 0.
 * Re-encrypts each row using deriveTenantKey(masterKey, row.tenant_id).
 * Updates D1 with new ciphertext, new nonce, and hkdf_migrated = 1.
 * If decryption or re-encryption fails, the key is quarantined in D1.
 */

import { deriveTenantKey, encrypt, decrypt } from "../src/crypto/encryption";

export async function migrateKeysToHkdf(
  db: D1Database,
  masterKey: string,
  batchSize = 50
): Promise<{ migrated: number; skipped: number; errors: number }> {
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  let lastId = "";

  while (true) {
    const batch = await db
      .prepare(`
        SELECT id, tenant_id, encrypted_key_b64 as ciphertext, nonce_b64 as nonce, status
        FROM api_keys
        WHERE id > ? AND (hkdf_migrated IS NULL OR hkdf_migrated = 0)
        ORDER BY id ASC
        LIMIT ?
      `)
      .bind(lastId, batchSize)
      .all<{
        id: string;
        tenant_id: string;
        ciphertext: string;
        nonce: string;
        status: string;
      }>();

    if (!batch.results || batch.results.length === 0) {
      break;
    }

    for (const row of batch.results) {
      lastId = row.id;

      if (row.status === "REVOKED" || row.status === "QUARANTINED") {
        skipped++;
        continue;
      }

      try {
        let plaintext: string | undefined;

        try {
          plaintext = await decrypt(
            { ciphertext: row.ciphertext, nonce: row.nonce },
            masterKey
          );
        } catch {
          // Check if it was already encrypted with tenant subkey
          try {
            const tenantKey = await deriveTenantKey(masterKey, row.tenant_id);
            plaintext = await decrypt(
              { ciphertext: row.ciphertext, nonce: row.nonce },
              tenantKey
            );
            if (plaintext && plaintext.trim().length > 0) {
              await db
                .prepare("UPDATE api_keys SET hkdf_migrated = 1 WHERE id = ?")
                .bind(row.id)
                .run();
              migrated++;
              continue;
            }
          } catch {
            // Decryption failed
          }
        }

        if (!plaintext || plaintext.trim().length === 0) {
          throw new Error("Decrypted key is empty or invalid");
        }

        const clean = plaintext.trim();
        const tenantKey = await deriveTenantKey(masterKey, row.tenant_id);
        const { ciphertextB64, nonceB64 } = await encrypt(clean, tenantKey);

        await db
          .prepare(`
            UPDATE api_keys
            SET encrypted_key_b64 = ?, nonce_b64 = ?, hkdf_migrated = 1
            WHERE id = ?
          `)
          .bind(ciphertextB64, nonceB64, row.id)
          .run();

        migrated++;
      } catch (e) {
        console.error(
          `Failed to migrate key ${row.id}:`,
          e instanceof Error ? e.message : String(e)
        );
        // Quarantine corrupted/un-decryptable key in D1
        await db
          .prepare(
            "UPDATE api_keys SET status = 'QUARANTINED', status_changed_at = ? WHERE id = ? AND status != 'REVOKED'"
          )
          .bind(Date.now(), row.id)
          .run()
          .catch((err: unknown) => {
            console.error(`Failed to quarantine key ${row.id}:`, err);
          });
        errors++;
      }
    }
  }

  return { migrated, skipped, errors };
}
