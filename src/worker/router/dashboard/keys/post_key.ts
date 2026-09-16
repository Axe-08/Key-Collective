/**
 * Key Collective v2/v4 — Dashboard Create Key Route Handler
 *
 * Invariants (GEMINI.md Constitution):
 * - No Plaintext Keys: AES-256-GCM + 12-byte CSPRNG nonces stored in D1.
 * - Per-Tenant Isolation: Keys isolated by tenantId.
 */

import { verifyTurnstileToken } from "../../../../auth/sybil";
import { deriveTenantKey, encrypt, type KeyInput } from "../../../../crypto/encryption";
import { forceErrorGcpProbe } from "../../../../ingress/probe";
import type { WorkerEnv } from "../../../auth_middleware";
import { RouterError } from "../../errors";
import type { DurableObjectNamespaceLike } from "../../types";

export async function handlePostKeys(
  request: Request,
  env: WorkerEnv,
  tenantId: string,
  headerTenant: string | null,
  masterKey?: KeyInput
): Promise<Response> {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    throw new RouterError("D1 Database binding missing", { statusCode: 500 });
  }
  if (!masterKey) {
    throw new RouterError("KC_MASTER_KEY is not configured", { statusCode: 500 });
  }

  if (!tenantId || tenantId === "anonymous" || tenantId === "guest") {
    throw new RouterError("Authentication required to add API keys", { statusCode: 401 });
  }

  const turnstileToken = request.headers.get("x-turnstile-token") || "";
  const turnstileSecret = env.TURNSTILE_SECRET as string | undefined;
  const tsResult = await verifyTurnstileToken(turnstileToken, { secretKey: turnstileSecret });
  if (!tsResult.success) {
    throw new RouterError("Turnstile validation failed", { statusCode: 403 });
  }

  const body = (await request.json()) as {
    provider: string;
    label: string;
    key: string;
    rpm_limit?: number;
    rpd_limit?: number;
    priority?: number;
    k1?: boolean;
    k2?: boolean;
    pool_type?: string;
  };

  if (!body.k1 || !body.k2) {
    throw new RouterError("K1 and K2 attestations are required", { statusCode: 400 });
  }

  if (!body.key || typeof body.key !== "string" || body.key.trim().length === 0) {
    throw new RouterError("API key token is required", { statusCode: 400 });
  }

  if (body.pool_type === 'COMMUNITY') {
    if (!(tenantId.startsWith('usr_gh_') || tenantId === 'admin')) {
      throw new RouterError("Only GitHub authenticated accounts may contribute keys to the Community Pool.", { statusCode: 403 });
    }
  }

  const rawKey = body.key.trim();
  const provider = body.provider === "gemini" ? "google" : body.provider;

  const extractedProject = await forceErrorGcpProbe(rawKey, provider);
  if (extractedProject) {
    const projectHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(extractedProject));
    const hashHex = Array.from(new Uint8Array(projectHash)).map(b => b.toString(16).padStart(2, '0')).join('');

    const existingHash = await env.DB.prepare("SELECT state FROM project_hash_registry WHERE project_hash = ?").bind(hashHex).first<{state: string}>();
    if (existingHash) {
      if (existingHash.state === "ACTIVE") {
        throw new RouterError("Project hash already active", { statusCode: 409 });
      } else if (existingHash.state === "TOMBSTONED") {
        throw new RouterError("Project hash tombstoned", { statusCode: 403 });
      }
    }
    await env.DB.prepare("INSERT INTO project_hash_registry (project_hash, state, tenant_id, created_at) VALUES (?, 'ACTIVE', ?, ?)").bind(hashHex, tenantId, Date.now()).run();
  }

  const label = body.label?.trim() || `${body.provider}-key-${Date.now().toString(36)}`;
  const rpm_limit = Number(body.rpm_limit) || (body.provider === "groq" ? 30 : 15);
  const rpd_limit = Number(body.rpd_limit) || (body.provider === "groq" ? 14400 : 1500);
  const priority = Number(body.priority) || 0;

  const keyPrefix = rawKey.slice(0, 8);
  const keySuffix = rawKey.slice(-4);
  const keyId = `key_${body.provider}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

  const targetTenantId = tenantId === "admin" ? (headerTenant || "default") : tenantId;

  const tenantKey = await deriveTenantKey(masterKey as string | Uint8Array, targetTenantId);
  const { ciphertextB64, nonceB64 } = await encrypt(rawKey, tenantKey);

  const poolType = body.pool_type?.toUpperCase() === 'COMMUNITY' ? 'COMMUNITY' : 'PRIVATE';
  const commRoutingStatus = poolType === 'COMMUNITY' ? 'OBSERVATION' : null;
  const obsUntil = poolType === 'COMMUNITY' ? Date.now() + 24 * 60 * 60 * 1000 : null;

  await env.DB.prepare(
    `INSERT INTO api_keys (
      id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
      key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
      pool_type, community_routing_status, observation_until
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Healthy', ?, ?, ?)`
  ).bind(
    keyId,
    targetTenantId,
    label,
    provider,
    ciphertextB64,
    nonceB64,
    keyPrefix,
    keySuffix,
    rpm_limit,
    rpd_limit,
    priority,
    poolType,
    commRoutingStatus,
    obsUntil
  ).run();

  await env.DB.prepare("INSERT INTO consent_attestations (key_id, tenant_id, consent_type, consent_version, created_at) VALUES (?, ?, 'K1', 'v1.0', ?)").bind(keyId, targetTenantId, Date.now()).run();
  await env.DB.prepare("INSERT INTO consent_attestations (key_id, tenant_id, consent_type, consent_version, created_at) VALUES (?, ?, 'K2', 'v1.0', ?)").bind(keyId, targetTenantId, Date.now()).run();

  try {
    const keyPoolNamespace = env.KEY_POOL as unknown as DurableObjectNamespaceLike | undefined;
    if (keyPoolNamespace && typeof keyPoolNamespace.idFromName === "function") {
      const doId = keyPoolNamespace.idFromName(targetTenantId);
      const stub = keyPoolNamespace.get(doId);
      await stub.fetch("http://key-pool/keys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tenant-id": targetTenantId },
        body: JSON.stringify({
          key: {
            id: keyId,
            tenantId: targetTenantId,
            provider,
            ciphertext: ciphertextB64,
            nonce: nonceB64,
            label,
            priority,
            rpmLimit: rpm_limit,
            rpdLimit: rpd_limit,
            status: "Healthy",
          },
        }),
      });
    }
  } catch {
    // DO sync fallback
  }

  const createdResponse = {
    id: keyId,
    key_prefix: keyPrefix,
    key_suffix: keySuffix,
    provider: body.provider,
    label,
    rpm_limit,
    rpd_limit,
    priority,
    status: "healthy",
    requests_this_min: 0,
    requests_today: 0,
    total_requests: 0,
    avg_latency_ms: 0,
    created_at: new Date().toISOString(),
  };

  return Response.json(createdResponse, { status: 201 });
}
