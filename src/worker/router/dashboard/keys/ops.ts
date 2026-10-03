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
import { checkProofOfLife, forceErrorGcpProbe } from "../../../../ingress/probe";
import { resolvePlaintextKey, evict } from "../../core/key_resolver";
import { deriveTenantKey, encrypt, type KeyInput } from "../../../../crypto/encryption/index";
import type { WorkerEnv } from "../../../auth/index";
import { RouterError } from "../../errors";
import { Logger } from "../../../../utils/logger";
import type { DurableObjectNamespaceLike } from "../../types";



type KeyTestStatus = "healthy" | "no_quota" | "invalid" | "unavailable";
const PROOF_OF_LIFE_PROVIDERS = new Set(["google", "gemini", "groq"]);
const TEST_STATUS: Record<"key_no_quota" | "key_invalid" | "provider_unavailable", KeyTestStatus> = {
  key_no_quota: "no_quota",
  key_invalid: "invalid",
  provider_unavailable: "unavailable",
};
const KEY_STATUS_AFTER_TEST: Record<KeyTestStatus, string | null> = {
  healthy: "HEALTHY",
  no_quota: "COOLDOWN",
  invalid: "QUARANTINED",
  unavailable: null,
};
const TEST_MESSAGES: Record<KeyTestStatus, string> = {
  healthy: "The provider accepted the key.",
  no_quota: "The key works but has no quota left right now.",
  invalid: "The provider rejected the key; it has been quarantined.",
  unavailable: "The provider did not answer; the key was not changed.",
};

/** Key statements are scoped to the caller; the legacy "admin" tenant acts unscoped. */
function ownerScope(tenantId: string): string | null {
  return tenantId === "admin" ? null : tenantId;
}

const ROTATION_WINDOW_MS = 30 * 60 * 1000;

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

  const now = Date.now();
  let deletedMeta: {
    id: string;
    tenant_id: string;
    provider: string;
    rpm_limit: number;
    rpd_limit: number;
    provider_project_hash: string | null;
    created_at: number | string | null;
  } | null = null;

  if (env.DB && typeof env.DB.prepare === "function") {
    const repo = new ApiKeyRepository(env.DB);
    deletedMeta = await repo.softDeleteScoped(keyId, ownerScope(tenantId), now);
    if (!deletedMeta && tenantId !== "admin") {
      throw new RouterError(`Key '${keyId}' not found`, { statusCode: 404 });
    }

    if (deletedMeta?.provider_project_hash) {
      const existingReg = await env.DB.prepare(
        "SELECT vesting_started_at, created_at FROM project_hash_registry WHERE project_hash = ?"
      )
        .bind(deletedMeta.provider_project_hash)
        .first<{ vesting_started_at?: number | null; created_at?: number | null }>()
        .catch(() => null);

      const createdAtNum =
        typeof deletedMeta.created_at === "number"
          ? deletedMeta.created_at
          : typeof deletedMeta.created_at === "string"
          ? Date.parse(deletedMeta.created_at) || now
          : now;
      const vestingStartedAt =
        existingReg?.vesting_started_at ?? createdAtNum ?? existingReg?.created_at ?? now;

      await env.DB.prepare(
        `UPDATE project_hash_registry
            SET state = 'ROTATING',
                rotating_until = ?,
                vesting_started_at = ?,
                updated_at = ?
          WHERE project_hash = ?`
      )
        .bind(
          now + ROTATION_WINDOW_MS,
          vestingStartedAt,
          now,
          deletedMeta.provider_project_hash
        )
        .run()
        .catch(() => {});
    }
  }

  const targetTenantId = deletedMeta?.tenant_id ?? tenantId;
  let coordinatorSyncPending = false;

  try {
    const keyPoolNamespace = env.KEY_POOL as unknown as DurableObjectNamespaceLike | undefined;
    if (keyPoolNamespace && typeof keyPoolNamespace.idFromName === "function") {
      const doId = keyPoolNamespace.idFromName(targetTenantId);
      const stub = keyPoolNamespace.get(doId) as unknown as {
        fetch(url: string, init?: RequestInit): Promise<Response>;
        reconcile?(tenantId?: string): Promise<number>;
      };
      if (typeof stub.reconcile === "function") {
        await stub.reconcile(targetTenantId);
      } else {
        const res = await stub.fetch(`http://key-pool/keys/${encodeURIComponent(keyId)}`, {
          method: "DELETE",
        });
        await res.text().catch(() => {});
      }
    }
  } catch (_err) {
    // DO cleanup fallback
  }

  try {
    const coordNs = env.POOL_COORDINATOR as unknown as
      | {
          idFromName(name: string): DurableObjectId;
          get(id: DurableObjectId): { removeKey?(keyId: string): Promise<boolean> };
        }
      | undefined;
    if (coordNs && typeof coordNs.idFromName === "function") {
      const providers = deletedMeta?.provider ? [deletedMeta.provider] : ["google", "groq"];
      for (const provider of providers) {
        const canon = provider.toLowerCase() === "gemini" ? "google" : provider.toLowerCase();
        for (const shardName of [`pool:${canon}`, provider]) {
          try {
            const coordStub = coordNs.get(coordNs.idFromName(shardName));
            if (typeof coordStub.removeKey === "function") {
              await coordStub.removeKey(keyId);
            }
          } catch (err) {
            // Degraded: the coordinator's 5-minute D1 reconcile drops the key; report sync pending.
            coordinatorSyncPending = true;
            new Logger({ traceId: "key-delete", tenantId: targetTenantId }).warn(
              "key_delete_coordinator_sync_failed",
              { keyId, shard: shardName, error: err }
            );
          }
        }
      }
    }
  } catch (_err) {
    // Coordinator reconcile will clean up removed keys
  }

  evict(keyId);
  return Response.json({ success: true, keyId, ...(coordinatorSyncPending ? { sync: "pending" } : {}) });
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

  const repo = new ApiKeyRepository(env.DB);
  const updated = await repo.setPoolMode(keyId, ownerScope(tenantId), poolType, commRoutingStatus, obsUntil);
  if (!updated && tenantId !== "admin") {
    throw new RouterError("Key not found or you do not have permission to modify it", { statusCode: 404 });
  }

  const meta = await repo.getCoordinatorMeta(keyId, ownerScope(tenantId));
  const targetTenantId = meta?.tenant_id ?? tenantId;

  try {
    const keyPoolNamespace = env.KEY_POOL as unknown as DurableObjectNamespaceLike | undefined;
    if (keyPoolNamespace && typeof keyPoolNamespace.idFromName === "function") {
      const stub = keyPoolNamespace.get(keyPoolNamespace.idFromName(targetTenantId)) as unknown as {
        reconcile?(tenantId?: string): Promise<number>;
      };
      if (typeof stub.reconcile === "function") {
        await stub.reconcile(targetTenantId);
      }
    }
  } catch (_err) {
    // KeyPoolDO reconcile fallback
  }

  try {
    const coordNs = env.POOL_COORDINATOR as unknown as
      | {
          idFromName(name: string): DurableObjectId;
          get(id: DurableObjectId): {
            upsertKey?(req: {
              keyId: string;
              owner: string;
              provider: string;
              status: "OBSERVATION";
              observationUntil: number | null;
              rpmLimit: number;
              rpdLimit: number;
            }): Promise<unknown>;
            removeKey?(keyId: string): Promise<boolean>;
          };
        }
      | undefined;
    if (meta && coordNs && typeof coordNs.idFromName === "function") {
      const coordStub = coordNs.get(coordNs.idFromName(meta.provider));
      if (poolType === "COMMUNITY" && typeof coordStub.upsertKey === "function") {
        await coordStub.upsertKey({
          keyId,
          owner: meta.tenant_id,
          provider: meta.provider,
          status: "OBSERVATION",
          observationUntil: obsUntil,
          rpmLimit: meta.rpm_limit,
          rpdLimit: meta.rpd_limit,
        });
      } else if (poolType === "PRIVATE" && typeof coordStub.removeKey === "function") {
        await coordStub.removeKey(keyId);
      }
    }
  } catch (_err) {
    // Coordinator reconcile fallback
  }

  evict(keyId);
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

  // Proof of life (WP-3.6) is the truth for a key test; D-06 leaves no other provider.
  if (!PROOF_OF_LIFE_PROVIDERS.has(row.provider)) {
    throw new RouterError(`Key test is not configured for provider '${row.provider}'`, { statusCode: 500 });
  }
  const testStart = Date.now();
  const life = await checkProofOfLife(plaintextKey, row.provider);
  const latencyMs = Date.now() - testStart;
  const status = "ok" in life ? "healthy" : TEST_STATUS[life.error];

  // The key's status follows the result; 'unavailable' is the provider's problem, not the
  // key's, and a revoked key is never revived.
  const nextStatus = KEY_STATUS_AFTER_TEST[status];
  if (nextStatus) {
    await env.DB.prepare(
      "UPDATE api_keys SET status = ?, status_changed_at = ? WHERE id = ? AND status != 'REVOKED' AND status != ?"
    )
      .bind(nextStatus, Date.now(), keyId, nextStatus)
      .run();
    evict(keyId);
  }

  return Response.json({
    ok: status === "healthy",
    success: status === "healthy",
    status,
    latency_ms: latencyMs,
    message: TEST_MESSAGES[status],
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
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

  const body = (await request.json().catch(() => ({}))) as { new_key?: string; key?: string };
  const rawKey = (body.new_key ?? body.key)?.trim();
  if (!rawKey) {
    throw new RouterError("New key string is required", { statusCode: 400 });
  }

  const scope = ownerScope(tenantId);
  const existingRow =
    scope === null
      ? await env.DB.prepare(
          "SELECT id, tenant_id, provider, pool_type, provider_project_hash, created_at FROM api_keys WHERE id = ? AND upper(status) != 'REVOKED'"
        )
          .bind(keyId)
          .first<{
            id: string;
            tenant_id: string;
            provider: string;
            pool_type: string | null;
            provider_project_hash: string | null;
            created_at: number | string | null;
          }>()
      : await env.DB.prepare(
          "SELECT id, tenant_id, provider, pool_type, provider_project_hash, created_at FROM api_keys WHERE id = ? AND tenant_id = ? AND upper(status) != 'REVOKED'"
        )
          .bind(keyId, scope)
          .first<{
            id: string;
            tenant_id: string;
            provider: string;
            pool_type: string | null;
            provider_project_hash: string | null;
            created_at: number | string | null;
          }>();

  if (!existingRow) {
    throw new RouterError("Key not found or you do not have permission to rotate it", { statusCode: 404 });
  }

  const repo = new ApiKeyRepository(env.DB);
  const keyHash = await sha256Hex(rawKey);
  if (await repo.existsByHash(keyHash)) {
    return Response.json({ error: "key_already_registered" }, { status: 409 });
  }

  const normProv = existingRow.provider.toLowerCase() === "gemini" ? "google" : existingRow.provider.toLowerCase();
  if (normProv === "google") {
    const probe = await forceErrorGcpProbe(rawKey, "google");
    if (probe && "projectNumber" in probe) {
      const newProjectHash = await sha256Hex(probe.projectNumber);
      if (
        existingRow.provider_project_hash &&
        existingRow.provider_project_hash !== newProjectHash
      ) {
        return Response.json(
          {
            error: "project_mismatch",
            message: "Rotated key must belong to the same GCP project",
          },
          { status: 409 }
        );
      }
    } else if (probe && "unavailable" in probe && existingRow.pool_type === "COMMUNITY") {
      return Response.json(
        { error: "project_unverifiable", message: `GCP project could not be verified (${probe.unavailable})` },
        { status: 422 }
      );
    }
  }

  if (PROOF_OF_LIFE_PROVIDERS.has(existingRow.provider.toLowerCase())) {
    const life = await checkProofOfLife(rawKey, existingRow.provider);
    if ("error" in life) {
      if (life.error === "provider_unavailable") {
        return Response.json(
          { error: "provider_unavailable", message: "Upstream provider did not respond to proof of life" },
          { status: 503 }
        );
      }
      return Response.json({ error: life.error }, { status: 400 });
    }
  }

  const targetTenantId = existingRow.tenant_id || tenantId;
  const tenantKey = await deriveTenantKey(masterKey as string | Uint8Array, targetTenantId);
  const { ciphertextB64, nonceB64 } = await encrypt(rawKey, tenantKey);

  const keyPrefix = rawKey.slice(0, 8);
  const keySuffix = rawKey.slice(-4);

  if (existingRow.provider_project_hash) {
    const now = Date.now();
    const vestingStart =
      typeof existingRow.created_at === "number"
        ? existingRow.created_at
        : typeof existingRow.created_at === "string"
        ? Date.parse(existingRow.created_at) || now
        : now;
    try {
      await env.DB.prepare(
        `UPDATE project_hash_registry
            SET state = 'ACTIVE',
                rotating_until = NULL,
                vesting_started_at = COALESCE(vesting_started_at, ?),
                updated_at = ?
          WHERE project_hash = ?`
      )
        .bind(vestingStart, now, existingRow.provider_project_hash)
        .run();
    } catch (err) {
      // Nothing has changed yet (the registry is written before the secret), so the
      // caller can simply retry.
      new Logger({ traceId: "key-rotate", tenantId: targetTenantId }).error(
        "key_rotate_registry_update_failed",
        { keyId, error: err }
      );
      return Response.json(
        {
          error: "registry_update_failed",
          message: "The project registry could not be updated; the key was not rotated. Retry the rotation.",
        },
        { status: 503 }
      );
    }
  }

  const rotated = await repo.replaceSecret(keyId, scope, {
    ciphertextB64,
    nonceB64,
    keyPrefix,
    keySuffix,
    keyHash,
  });
  if (!rotated) {
    throw new RouterError("Key not found or you do not have permission to rotate it", { statusCode: 404 });
  }

  evict(keyId);
  return Response.json({
    success: true,
    keyId,
    key_prefix: keyPrefix,
    key_suffix: keySuffix,
  });
}


