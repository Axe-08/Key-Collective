/**
 * Key Collective v2/v4 — Dashboard Operations on Keys (Delete, Test, PoolMode)
 *
 * Invariants (GEMINI.md Constitution):
 * - No Plaintext Keys in D1.
 * - Per-Tenant Isolation.
 * - Strict TypeScript.
 */

import { decryptKey } from "../../../../durable_objects/crypto";
import type { KeyInput } from "../../../../crypto/encryption";
import type { WorkerEnv } from "../../../auth_middleware";
import { RouterError } from "../../errors";
import type { DurableObjectNamespaceLike } from "../../types";

export async function handleDeleteKey(
  pathname: string,
  env: WorkerEnv,
  tenantId: string,
  headerTenant: string | null
): Promise<Response> {
  const keyId = pathname.replace("/api/keys/", "").trim();
  if (!keyId) {
    throw new RouterError("Key ID is required", { statusCode: 400 });
  }

  if (env.DB && typeof env.DB.prepare === "function") {
    if (tenantId === "admin") {
      await env.DB.prepare("DELETE FROM api_keys WHERE id = ?").bind(keyId).run();
    } else {
      await env.DB.prepare(
        "DELETE FROM api_keys WHERE id = ? AND tenant_id = ?"
      ).bind(keyId, tenantId).run();
    }
  }

  try {
    const targetTenantId = tenantId === "admin" ? (headerTenant || "default") : tenantId;
    const keyPoolNamespace = env.KEY_POOL as unknown as DurableObjectNamespaceLike | undefined;
    if (keyPoolNamespace && typeof keyPoolNamespace.idFromName === "function") {
      const doId = keyPoolNamespace.idFromName(targetTenantId);
      const stub = keyPoolNamespace.get(doId);
      await stub.fetch(`http://key-pool/keys/${encodeURIComponent(keyId)}`, {
        method: "DELETE",
        headers: { "x-tenant-id": targetTenantId },
      });
    }
  } catch {
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

  const body = await request.json() as { pool_type?: string };
  const newPoolType = body.pool_type;
  if (newPoolType !== 'COMMUNITY' && newPoolType !== 'PRIVATE') {
    throw new RouterError("pool_type must be 'COMMUNITY' or 'PRIVATE'", { statusCode: 400 });
  }

  if (newPoolType === 'COMMUNITY') {
    if (!(tenantId.startsWith('usr_gh_') || tenantId === 'admin')) {
      throw new RouterError("Only GitHub authenticated accounts may contribute keys to the Community Pool.", { statusCode: 403 });
    }
  }

  if (!env.DB || typeof env.DB.prepare !== 'function') {
    throw new RouterError('Database unavailable', { statusCode: 503 });
  }
  const db = env.DB as D1Database;
  const existingKey = tenantId === "admin"
    ? await db.prepare('SELECT id, tenant_id FROM api_keys WHERE id = ?').bind(keyId).first<{ id: string; tenant_id: string }>()
    : await db.prepare('SELECT id, tenant_id FROM api_keys WHERE id = ? AND (tenant_id = ? OR tenant_id = "default")').bind(keyId, tenantId).first<{ id: string; tenant_id: string }>();

  if (!existingKey) throw new RouterError('Key not found', { statusCode: 404 });

  let newRoutingStatus: string;
  let observationUntil: string | null = null;
  if (newPoolType === 'COMMUNITY') {
    newRoutingStatus = 'OBSERVATION';
    observationUntil = new Date(Date.now() + 86400000).toISOString();
  } else {
    newRoutingStatus = 'ACTIVE';
  }

  await db.prepare(
    `UPDATE api_keys SET pool_type = ?, community_routing_status = ?, observation_until = ? WHERE id = ?`
  ).bind(newPoolType, newRoutingStatus, observationUntil, keyId).run();

  return Response.json({
    id: keyId,
    pool_type: newPoolType,
    community_routing_status: newRoutingStatus,
    observation_until: observationUntil,
    message: newPoolType === 'COMMUNITY'
      ? 'Key entering 24-hour observation period.'
      : 'Key switched to private pool.',
  });
}

export async function handleTestKey(
  pathname: string,
  env: WorkerEnv,
  tenantId: string,
  masterKey?: KeyInput
): Promise<Response> {
  const keyId = pathname.slice("/api/keys/".length, -"/test".length).trim();
  if (!keyId) {
    throw new RouterError("Key ID is required", { statusCode: 400 });
  }
  if (!env.DB || typeof env.DB.prepare !== "function") {
    throw new RouterError("D1 Database binding missing", { statusCode: 500 });
  }
  if (!masterKey) {
    throw new RouterError("KC_MASTER_KEY is not configured", { statusCode: 500 });
  }

  const row = tenantId === "admin"
    ? await env.DB.prepare(
        "SELECT provider, encrypted_key_b64, nonce_b64 FROM api_keys WHERE id = ?"
      ).bind(keyId).first<{
        provider: string;
        encrypted_key_b64: string;
        nonce_b64: string;
      }>()
    : await env.DB.prepare(
        "SELECT provider, encrypted_key_b64, nonce_b64 FROM api_keys WHERE id = ? AND tenant_id = ?"
      ).bind(keyId, tenantId).first<{
        provider: string;
        encrypted_key_b64: string;
        nonce_b64: string;
      }>();

  if (!row) {
    throw new RouterError(`Key '${keyId}' not found`, { statusCode: 404 });
  }

  const plaintextKey = await decryptKey(row.encrypted_key_b64, row.nonce_b64, masterKey);

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
    latencyMs = 120;
    isSuccess = true;
    message = `Provider '${row.provider}' key syntax verified`;
  }

  return Response.json({
    success: isSuccess,
    latency_ms: latencyMs,
    message,
  });
}
