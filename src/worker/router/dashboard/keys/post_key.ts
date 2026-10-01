/**
 * Key Collective v2/v4 — Dashboard Create Key Route Handler
 *
 * Invariants (GEMINI.md Constitution):
 * - No Plaintext Keys: AES-256-GCM + 12-byte CSPRNG nonces stored in D1.
 * - Per-Tenant Isolation: Keys isolated by tenantId.
 */

import { githubLinkRequired, loadPoolRights } from "../../../../auth/rights";
import { verifyTurnstileToken } from "../../../../auth/sybil/index";
import { deriveTenantKey, encrypt, type KeyInput } from "../../../../crypto/encryption/index";
import { forceErrorGcpProbe } from "../../../../ingress/probe";
import { PROVIDERS } from "../../../../providers/config";
import type { WorkerEnv } from "../../../auth/index";
import { ConsentAttestationSchema } from "../../../../contracts/v4_types";
import { RouterError } from "../../errors";
import type { DurableObjectNamespaceLike } from "../../types";

export async function handlePostKeys(
  request: Request,
  env: WorkerEnv,
  tenantId: string,
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

  const rights = await loadPoolRights(env.DB, tenantId);
  if (!rights.privatePool) {
    throw new RouterError("Account may not add keys", { statusCode: 403 });
  }
  if (body.pool_type?.toUpperCase() === "COMMUNITY" && !rights.communityPool) {
    return githubLinkRequired();
  }

  const rawKey = body.key.trim();
  const provider = body.provider === "gemini" ? "google" : body.provider;

  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) {
    throw new RouterError("Unsupported provider", { statusCode: 400 });
  }

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
    await env.DB.prepare("INSERT INTO project_hash_registry (project_hash, provider, state, tenant_id, created_at) VALUES (?, ?, 'ACTIVE', ?, ?)").bind(hashHex, provider, tenantId, Date.now()).run();
  }

  const label = body.label?.trim() || `${body.provider}-key-${Date.now().toString(36)}`;
  const rpm_limit = Number(body.rpm_limit) || (body.provider === "groq" ? 30 : 15);
  const rpd_limit = Number(body.rpd_limit) || (body.provider === "groq" ? 14400 : 1500);
  const priority = Number(body.priority) || 0;

  const keyPrefix = rawKey.slice(0, 8);
  const keySuffix = rawKey.slice(-4);
  const randBytes = crypto.getRandomValues(new Uint8Array(3));
  const randHex = Array.from(randBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const keyId = `key_${body.provider}_${Date.now().toString(36)}_${randHex}`;

  const targetTenantId = tenantId;

  const tenantKey = await deriveTenantKey(masterKey as string | Uint8Array, targetTenantId);
  const { ciphertextB64, nonceB64 } = await encrypt(rawKey, tenantKey);

  // Write-time key_hash: SHA-256 hex digest of the raw key, used for lookup/revocation
  // without ever storing or logging the plaintext key (WP-1.5 finalises consumers).
  const keyHashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const keyHash = Array.from(new Uint8Array(keyHashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const poolType = body.pool_type?.toUpperCase() === 'COMMUNITY' ? 'COMMUNITY' : 'PRIVATE';
  const commRoutingStatus = poolType === 'COMMUNITY' ? 'OBSERVATION' : null;
  const obsUntil = poolType === 'COMMUNITY' ? Date.now() + 24 * 60 * 60 * 1000 : null;
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO api_keys (
      id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
      key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
      pool_type, community_routing_status, observation_until, key_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'HEALTHY', ?, ?, ?, ?, ?)`
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
    obsUntil,
    keyHash,
    now
  ).run();

  const ipAddress = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || null;
  const userAgent = request.headers.get("user-agent") || null;

  const k1Attestation = ConsentAttestationSchema.parse({
    id: crypto.randomUUID(),
    tenant_id: targetTenantId,
    event_type: "KEY_SUBMISSION",
    checkbox_id: "K1",
    consent_version: "v1.0",
    key_id: keyId,
    attested_at: now,
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  const k2Attestation = ConsentAttestationSchema.parse({
    id: crypto.randomUUID(),
    tenant_id: targetTenantId,
    event_type: "KEY_SUBMISSION",
    checkbox_id: "K2",
    consent_version: "v1.0",
    key_id: keyId,
    attested_at: now,
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  const insertConsentStmt = env.DB.prepare(
    "INSERT INTO consent_attestations (id, tenant_id, event_type, checkbox_id, consent_version, key_id, attested_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  await insertConsentStmt.bind(
    k1Attestation.id,
    k1Attestation.tenant_id,
    k1Attestation.event_type,
    k1Attestation.checkbox_id,
    k1Attestation.consent_version,
    k1Attestation.key_id ?? null,
    k1Attestation.attested_at ?? now,
    k1Attestation.ip_address ?? null,
    k1Attestation.user_agent ?? null
  ).run();

  await insertConsentStmt.bind(
    k2Attestation.id,
    k2Attestation.tenant_id,
    k2Attestation.event_type,
    k2Attestation.checkbox_id,
    k2Attestation.consent_version,
    k2Attestation.key_id ?? null,
    k2Attestation.attested_at ?? now,
    k2Attestation.ip_address ?? null,
    k2Attestation.user_agent ?? null
  ).run();

  try {
    const keyPoolNamespace = env.KEY_POOL as unknown as DurableObjectNamespaceLike | undefined;
    if (keyPoolNamespace && typeof keyPoolNamespace.idFromName === "function") {
      const doId = keyPoolNamespace.idFromName(targetTenantId);
      const stub = keyPoolNamespace.get(doId);
      await stub.fetch("http://key-pool/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
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
    created_at: new Date().toISOString(),
  };

  return Response.json(createdResponse, { status: 201 });
}
