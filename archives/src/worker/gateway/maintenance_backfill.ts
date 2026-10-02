/**
 * @file maintenance_backfill.ts
 * Archived one-off maintenance route: POST /api/admin/maintenance/backfill-key-hash
 * Extracted from src/worker/gateway/admin_handler.ts in WP-7.7 (T-7.7.4).
 */

import type { WorkerEnv } from "../../../src/worker/auth/index";
import type { WorkerOptions } from "../../../src/worker/gateway/types";
import { applyCors } from "../../../src/worker/gateway/subdomain";
import { deriveTenantKey, decrypt, hashApiKey, timingSafeEqualStrings } from "../../../src/crypto";

export async function handleBackfillKeyHash(
  request: Request,
  env: WorkerEnv,
  options: WorkerOptions = {}
): Promise<Response> {
  const breakGlassHeader =
    request.headers.get("x-break-glass-authorization") || request.headers.get("x-break-glass");
  const breakGlassSecret = env.BREAK_GLASS_TOKEN as string | undefined;

  if (
    !breakGlassSecret ||
    breakGlassSecret.trim().length === 0 ||
    !breakGlassHeader ||
    !timingSafeEqualStrings(breakGlassHeader.trim(), breakGlassSecret.trim())
  ) {
    const res = Response.json(
      { success: false, error: "Break-glass authorization required" },
      { status: 403 }
    );
    return options.cors !== false ? applyCors(res) : res;
  }

  const masterKey = env.KC_MASTER_KEY as string | undefined;
  const db = (env.DB || env.D1_DB) as D1Database | undefined;

  if (!db || typeof db.prepare !== "function" || !masterKey) {
    const res = Response.json(
      { success: false, error: "Database or master key not configured" },
      { status: 500 }
    );
    return options.cors !== false ? applyCors(res) : res;
  }

  let updatedCount = 0;
  try {
    const rowsRes = await db
      .prepare("SELECT id, tenant_id, encrypted_key_b64, nonce_b64 FROM api_keys WHERE key_hash IS NULL")
      .all<{ id: string; tenant_id: string; encrypted_key_b64: string; nonce_b64: string }>();

    for (const row of rowsRes.results || []) {
      try {
        const tenantKey = await deriveTenantKey(masterKey, row.tenant_id);
        const plaintextKey = await decrypt(row.encrypted_key_b64, tenantKey, row.nonce_b64);
        const keyHash = await hashApiKey(plaintextKey);
        await db.prepare("UPDATE api_keys SET key_hash = ? WHERE id = ?").bind(keyHash, row.id).run();
        updatedCount += 1;
      } catch {
        // Skip rows that fail to decrypt or hash; never surface plaintext or row detail.
      }
    }
  } catch {
    // Query failed; fall through and report whatever count was updated so far.
  }

  const res = Response.json({ success: true, updated: updatedCount });
  return options.cors !== false ? applyCors(res) : res;
}
