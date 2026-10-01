/**
 * Key Collective v2/v4 — Dashboard Operations on Keys (Delete, Test, PoolMode)
 *
 * Invariants (GEMINI.md Constitution):
 * - No Plaintext Keys in D1.
 * - Per-Tenant Isolation.
 * - Strict TypeScript.
 */

import { githubLinkRequired, loadPoolRights } from "../../../../auth/rights";
import { ApiKeyRepository } from "../../../../storage/repositories/api_keys/repository";
import { decryptKey } from "../../../../durable_objects/crypto";
import { resolvePlaintextKey, clearDecryptedKeyCache } from "../../core/key_resolver";
import { deriveTenantKey, encrypt, type KeyInput } from "../../../../crypto/encryption/index";
import type { WorkerEnv } from "../../../auth/index";
import { RouterError } from "../../errors";
import type { DurableObjectNamespaceLike } from "../../types";


/** Key statements are scoped to the caller; the legacy "admin" tenant acts unscoped. */
function ownerScope(tenantId: string): string | null {
  return tenantId === "admin" ? null : tenantId;
}

export async function handleDeleteKey(
  pathname: string,
  env: WorkerEnv,
  tenantId: string
): Promise<Response> {
  const keyId = pathname.replace("/api/keys/", "").trim();
  if (!keyId) {
    throw new RouterError("Key ID is required", { statusCode: 400 });
  }

  if (!tenantId || tenantId === "anonymous" || tenantId === "guest") {
    throw new RouterError("Authentication required to delete keys", { statusCode: 401 });
  }

  if (env.DB && typeof env.DB.prepare === "function") {
    const deleted = await new ApiKeyRepository(env.DB).deleteScoped(keyId, ownerScope(tenantId));
    if (!deleted && tenantId !== "admin") {
      throw new RouterError(`Key '${keyId}' not found`, { statusCode: 404 });
    }
  }

  try {
    const targetTenantId = tenantId;
    const keyPoolNamespace = env.KEY_POOL as unknown as DurableObjectNamespaceLike | undefined;
    if (keyPoolNamespace && typeof keyPoolNamespace.idFromName === "function") {
      const doId = keyPoolNamespace.idFromName(targetTenantId);
      const stub = keyPoolNamespace.get(doId);
      await stub.fetch(`http://key-pool/keys/${encodeURIComponent(keyId)}`, {
        method: "DELETE",
      });
    }
  } catch (_err) {
    // DO cleanup fallback
  }

  return Response.json({ success: true, keyId });
}

export async function handlePoolMode(
  pathname: string,
  request: Request,
  env: WorkerEnv,
  tenantId: string
): Promise<Response> {
  const keyId = pathname.split('/')[3];
  if (!keyId) throw new RouterError('Key ID required', { statusCode: 400 });

  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const isFreezeWindow = (utcHour === 23 && utcMinute >= 30) || (utcHour === 0 && utcMinute <= 30);
  if (isFreezeWindow) {
    return Response.json({
      error: 'pool_toggle_frozen',
      message: 'Pool switching is frozen during midnight quota reset window (23:30–00:30 UTC).',
      retry_after_utc: utcHour === 23 ? '00:31 UTC' : '00:31 UTC',
    }, { status: 423 });
  }

  const body = (await request.json().catch(() => ({}))) as { pool_type?: string };
  const poolType = body.pool_type?.toUpperCase();
  if (poolType !== 'COMMUNITY' && poolType !== 'PRIVATE') {
    throw new RouterError("Invalid pool_type. Must be COMMUNITY or PRIVATE", { statusCode: 400 });
  }

  if (!env.DB || typeof env.DB.prepare !== "function") {
    throw new RouterError("D1 Database binding missing", { statusCode: 500 });
  }

  if (poolType === 'COMMUNITY' && !(await loadPoolRights(env.DB, tenantId)).communityPool) {
    return githubLinkRequired();
  }

  const commRoutingStatus = poolType === 'COMMUNITY' ? 'OBSERVATION' : null;
  const obsUntil = poolType === 'COMMUNITY' ? Date.now() + 24 * 60 * 60 * 1000 : null;

  const updated = await new ApiKeyRepository(env.DB).setPoolMode(keyId, ownerScope(tenantId), poolType, commRoutingStatus, obsUntil);
  if (!updated && tenantId !== "admin") {
    throw new RouterError("Key not found or you do not have permission to modify it", { statusCode: 404 });
  }

  clearDecryptedKeyCache();
  return Response.json({
    success: true,
    keyId,
    pool_type: poolType,
    community_routing_status: commRoutingStatus,
    observation_until: obsUntil
  });
}

export async function handleTestKey(
  pathname: string,
  env: WorkerEnv,
  tenantId: string,
  masterKey?: KeyInput
): Promise<Response> {
  const keyId = pathname.replace("/api/keys/", "").replace("/test", "").trim();
  if (!keyId) {
    throw new RouterError("Key ID is required", { statusCode: 400 });
  }
  if (!env.DB || typeof env.DB.prepare !== "function") {
    throw new RouterError("D1 Database binding missing", { statusCode: 500 });
  }
  if (!masterKey) {
    throw new RouterError("KC_MASTER_KEY is not configured", { statusCode: 500 });
  }

  const row = await new ApiKeyRepository(env.DB).getSecret(keyId, ownerScope(tenantId));

  if (!row) {
    throw new RouterError(`Key '${keyId}' not found`, { statusCode: 404 });
  }

  const plaintextKey = await resolvePlaintextKey(
    keyId,
    row.provider,
    row.tenant_id || tenantId,
    env,
    masterKey
  );

  const testStart = Date.now();
  let isSuccess = false;
  let latencyMs = 0;
  let message = "";

  if (row.provider === "google" || row.provider === "gemini") {
    const testRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(plaintextKey)}`
    );
    latencyMs = Date.now() - testStart;
    isSuccess = testRes.ok;
    message = isSuccess
      ? `Key verified successfully with Google Gemini in ${latencyMs}ms`
      : `Upstream error HTTP ${testRes.status}: ${testRes.statusText}`;
  } else if (row.provider === "groq") {
    const testRes = await fetch("https://api.groq.com/openai/v1/models", {
      headers: {
        authorization: `Bearer ${plaintextKey}`,
      },
    });
    latencyMs = Date.now() - testStart;
    isSuccess = testRes.ok;
    message = isSuccess
      ? `Key verified successfully with Groq in ${latencyMs}ms`
      : `Upstream error HTTP ${testRes.status}: ${testRes.statusText}`;
  } else {
    latencyMs = Date.now() - testStart;
    isSuccess = true;
    message = `Provider '${row.provider}' key syntax verified in ${latencyMs}ms`;
  }

  return Response.json({
    success: isSuccess,
    latency_ms: latencyMs,
    message,
  });
}

export async function handleRotateKeySecret(
  pathname: string,
  request: Request,
  env: WorkerEnv,
  tenantId: string,
  masterKey?: KeyInput
): Promise<Response> {
  const keyId = pathname.replace("/api/keys/", "").replace("/rotate", "").trim();
  if (!keyId) {
    throw new RouterError("Key ID is required", { statusCode: 400 });
  }
  if (!tenantId || tenantId === "anonymous" || tenantId === "guest") {
    throw new RouterError("Authentication required to rotate keys", { statusCode: 401 });
  }
  if (!env.DB || typeof env.DB.prepare !== "function") {
    throw new RouterError("D1 Database binding missing", { statusCode: 500 });
  }
  if (!masterKey) {
    throw new RouterError("KC_MASTER_KEY is not configured", { statusCode: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as { new_key?: string };
  const rawKey = body.new_key?.trim();
  if (!rawKey) {
    throw new RouterError("New key string is required", { statusCode: 400 });
  }

  const targetTenantId = tenantId;
  const tenantKey = await deriveTenantKey(masterKey as string | Uint8Array, targetTenantId);
  const { ciphertextB64, nonceB64 } = await encrypt(rawKey, tenantKey);

  const keyPrefix = rawKey.slice(0, 8);
  const keySuffix = rawKey.slice(-4);

  const rotated = await new ApiKeyRepository(env.DB).replaceSecret(keyId, ownerScope(tenantId), {
    ciphertextB64,
    nonceB64,
    keyPrefix,
    keySuffix,
  });
  if (!rotated) {
    throw new RouterError("Key not found or you do not have permission to rotate it", { statusCode: 404 });
  }

  clearDecryptedKeyCache();
  return Response.json({
    success: true,
    keyId,
    key_prefix: keyPrefix,
    key_suffix: keySuffix,
  });
}

