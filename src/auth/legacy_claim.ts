/**
 * Key Collective — legacy GitHub-only account claim (WP-3.5, D-10, D-27)
 *
 * A signed-in user whose linked GitHub id is <id> may claim the legacy accounts gh_<id> and
 * usr_gh_<id>: their api_keys move to the caller, re-encrypted under the caller's tenant
 * subkey (same key_hash), in one D1 batch with a legacy_claim audit row and the legacy user
 * marked SUSPENDED. Matching is by numeric GitHub id only: usernames can be re-registered.
 */

import type { WorkerEnv } from "../worker/auth/index";
import { decrypt, deriveTenantKey, encrypt } from "../crypto/encryption/index";

interface LegacyKeyRow {
  id: string;
  encrypted_key_b64: string;
  nonce_b64: string;
}

async function linkedGithubId(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT subject FROM user_identities WHERE user_id = ? AND provider = 'github'")
    .bind(userId)
    .first<{ subject: string }>();
  return row?.subject ?? null;
}

async function legacyAccounts(db: D1Database, githubId: string): Promise<Array<{ id: string; claimed: boolean }>> {
  const rows = await db
    .prepare(
      `SELECT u.id,
              EXISTS (SELECT 1 FROM admin_audit_logs a WHERE a.action = 'legacy_claim' AND a.target = u.id) AS claimed
         FROM users u WHERE u.id IN (?, ?) ORDER BY u.id`
    )
    .bind(`gh_${githubId}`, `usr_gh_${githubId}`)
    .all<{ id: string; claimed: number }>();
  return rows.results.map((r) => ({ id: r.id, claimed: r.claimed === 1 }));
}

/** Legacy account ids the caller may still claim (for GET /api/session). */
export async function getClaimableLegacyAccounts(db: D1Database, callerId: string): Promise<string[]> {
  const githubId = await linkedGithubId(db, callerId);
  if (!githubId) return [];
  return (await legacyAccounts(db, githubId)).filter((a) => !a.claimed).map((a) => a.id);
}

export async function handleClaimLegacy(
  env: WorkerEnv,
  callerId: string,
  masterKey: string | Uint8Array | undefined
): Promise<Response> {
  const db = env.DB;
  if (!db || !masterKey) return Response.json({ error: "unavailable" }, { status: 503 });

  const githubId = await linkedGithubId(db, callerId);
  const accounts = githubId ? await legacyAccounts(db, githubId) : [];
  if (accounts.length === 0) return Response.json({ error: "not_found" }, { status: 404 });

  const newKey = await deriveTenantKey(masterKey, callerId);
  const statements: D1PreparedStatement[] = [];
  const claimed: Array<{ legacyId: string; keys: number }> = [];
  for (const account of accounts.filter((a) => !a.claimed)) {
    const oldKey = await deriveTenantKey(masterKey, account.id);
    const keys = await db
      .prepare("SELECT id, encrypted_key_b64, nonce_b64 FROM api_keys WHERE tenant_id = ?")
      .bind(account.id)
      .all<LegacyKeyRow>();
    for (const key of keys.results) {
      const plaintext = await decrypt(key.encrypted_key_b64, oldKey, key.nonce_b64);
      const { ciphertextB64, nonceB64 } = await encrypt(plaintext, newKey);
      statements.push(
        db
          .prepare("UPDATE api_keys SET tenant_id = ?, encrypted_key_b64 = ?, nonce_b64 = ? WHERE id = ? AND tenant_id = ?")
          .bind(callerId, ciphertextB64, nonceB64, key.id, account.id)
      );
    }
    statements.push(
      db
        .prepare(
          "INSERT INTO admin_audit_logs (id, admin_user_id, action, target, details_json) VALUES (?, ?, 'legacy_claim', ?, ?)"
        )
        .bind(crypto.randomUUID(), callerId, account.id, JSON.stringify({ github_id: githubId, keys: keys.results.length })),
      db.prepare("UPDATE users SET registration_status = 'SUSPENDED' WHERE id = ?").bind(account.id)
    );
    claimed.push({ legacyId: account.id, keys: keys.results.length });
  }
  if (statements.length > 0) await db.batch(statements);

  return Response.json({
    success: true,
    claimed_accounts: claimed.map((c) => c.legacyId),
    claimed_keys: claimed.reduce((n, c) => n + c.keys, 0),
  });
}
