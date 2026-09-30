/**
 * S-7 Forensics — Default-Tenant Takeover Detection (WP-0.7 / OP-0.11)
 *
 * Keys legitimately owned by the reserved 'default' tenant were re-encrypted
 * under WP-2.12 to 'sys_operator'. Any api_keys row whose tenant_id is NOT
 * 'default' but whose ciphertext still decrypts only under the 'default'
 * subkey is evidence that a tenant "claimed" an operator key via the
 * default-tenant takeover bug (WP-0.7). This script detects and remediates
 * those rows.
 */

import { deriveTenantKey, decrypt } from '../src/crypto/encryption';

export async function runDefaultTakeoverForensics(
  db: D1Database,
  masterKey: string | Uint8Array
): Promise<Array<{ id: string; tenant_id: string }>> {
  const claimed: Array<{ id: string; tenant_id: string }> = [];

  const defaultKey = await deriveTenantKey(masterKey, 'default');

  const rows = await db.prepare(
    'SELECT id, tenant_id, encrypted_key_b64, nonce_b64 FROM api_keys'
  ).all<{
    id: string;
    tenant_id: string;
    encrypted_key_b64: string | null;
    nonce_b64: string | null;
  }>();

  for (const row of rows.results || []) {
    if (!row.encrypted_key_b64 || !row.nonce_b64) continue;

    try {
      const tenantKey = await deriveTenantKey(masterKey, row.tenant_id);
      await decrypt(row.encrypted_key_b64, tenantKey, row.nonce_b64);
      // Decrypts fine under its own tenant key: not claimed.
      continue;
    } catch {
      // Fall through to check the 'default' subkey below.
    }

    try {
      await decrypt(row.encrypted_key_b64, defaultKey, row.nonce_b64);
      // Row only decrypts under the 'default' subkey: it was claimed from 'default'.
      claimed.push({ id: row.id, tenant_id: row.tenant_id });
      await db.prepare(
        "UPDATE api_keys SET tenant_id = 'sys_operator' WHERE id = ?"
      ).bind(row.id).run();
    } catch {
      // Neither key decrypts it; not a default-takeover case.
    }
  }

  return claimed;
}
