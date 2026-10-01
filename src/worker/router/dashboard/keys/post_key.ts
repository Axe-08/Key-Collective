/**
 * Key Collective — POST /api/keys: key submission end to end (WP-3.6, v1 1.5)
 *
 * Gates, in order, each with its own error code:
 *   1. caller + rights (privatePool; communityPool for COMMUNITY)   401 / 403 github_link_required
 *   2. 10 submissions per user per day                                 429 rate_limited
 *   3. Turnstile                                                       403 turnstile_failed
 *   4. body (provider google|groq, key format, label, K1, K2)          400 invalid_request
 *   5. duplicate plaintext (key_hash)                                  409 key_already_registered
 *   6. GCP project (Google): registry ACTIVE / tombstoned              409 project_already_registered /
 *      unverifiable project on a COMMUNITY key                         409 project_tombstoned / 422 project_unverifiable
 *   7. proof of life                                                   400 key_no_quota / key_invalid, 503 provider_unavailable
 * Then one D1 batch writes api_keys, project_hash_registry and the K1/K2 attestations, and the
 * key is pushed to its owner's KeyPoolDO. A failed push marks the row sync_pending (the pool
 * reconciles on its next load) and answers 201 with sync: "pending".
 *
 * Invariants (GEMINI.md Constitution):
 * - No Plaintext Keys: AES-256-GCM + 12-byte CSPRNG nonces stored in D1.
 * - Per-Tenant Isolation: Keys isolated by tenantId.
 */

import { z } from "zod";
import { githubLinkRequired, loadPoolRights } from "../../../../auth/rights";
import { verifyTurnstileToken } from "../../../../auth/sybil/index";
import { deriveTenantKey, encrypt, type KeyInput } from "../../../../crypto/encryption/index";
import { checkProofOfLife, forceErrorGcpProbe } from "../../../../ingress/probe";
import { ApiKeyRepository } from "../../../../storage/repositories/api_keys/repository";
import type { WorkerEnv } from "../../../auth/index";
import { RouterError } from "../../errors";
import type { DurableObjectNamespaceLike } from "../../types";

const SUBMISSIONS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const ROTATION_GRACE_MS = 30 * 60 * 1000;
const KEY_CONSENT_VERSION = "v1.0";

const KEY_FORMATS: Record<"google" | "groq", RegExp> = {
  google: /^AIza[0-9A-Za-z_-]{35}$/,
  groq: /^gsk_[A-Za-z0-9]{20,}$/,
};

const SubmitKeySchema = z
  .object({
    provider: z.preprocess((p) => (p === "gemini" ? "google" : p), z.enum(["google", "groq"])),
    key: z.string().trim(),
    label: z.string().trim().max(64).optional(),
    k1: z.literal(true),
    k2: z.literal(true),
    pool_type: z.preprocess((p) => (typeof p === "string" ? p.toUpperCase() : p), z.enum(["PRIVATE", "COMMUNITY"])).default("PRIVATE"),
    rpm_limit: z.number().int().positive().optional(),
    rpd_limit: z.number().int().positive().optional(),
    priority: z.number().int().optional(),
  })
  .refine((b) => KEY_FORMATS[b.provider].test(b.key), { message: "Key format does not match the provider", path: ["key"] });

function fail(status: number, error: string, message?: string): Response {
  return Response.json({ error, ...(message ? { message } : {}) }, { status });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function withinDailyLimit(env: WorkerEnv, tenantId: string): Promise<boolean> {
  const ns = env.RATE_LIMITER as unknown as DurableObjectNamespaceLike | undefined;
  if (!ns || typeof ns.idFromName !== "function") return true;
  const res = await ns.get(ns.idFromName(`key-submit:${tenantId}`)).fetch("http://rate-limiter/check-limit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: SUBMISSIONS_PER_DAY, windowMs: DAY_MS }),
  });
  return res.status !== 429;
}

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
  const db = env.DB;
  if (!tenantId || tenantId === "anonymous" || tenantId === "guest") {
    return fail(401, "authentication_required");
  }

  // 1. Rights (session/bearer and CSRF were checked by the dashboard router).
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const rights = await loadPoolRights(db, tenantId);
  if (!rights.privatePool) return fail(403, "forbidden", "Account may not add keys");
  if (String(raw?.pool_type ?? "").toUpperCase() === "COMMUNITY" && !rights.communityPool) return githubLinkRequired();

  // 2. Rate limit, 3. Turnstile.
  if (!(await withinDailyLimit(env, tenantId))) return fail(429, "rate_limited", "At most 10 key submissions per day");
  const turnstile = await verifyTurnstileToken(request.headers.get("x-turnstile-token") || "", {
    secretKey: env.TURNSTILE_SECRET as string | undefined,
  });
  if (!turnstile.success) return fail(403, "turnstile_failed");

  // 4. Body.
  const parsed = SubmitKeySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail(400, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  const body = parsed.data;
  const rawKey = body.key;

  // 5. Duplicate plaintext.
  const repo = new ApiKeyRepository(db);
  const keyHash = await sha256Hex(rawKey);
  if (await repo.existsByHash(keyHash)) return fail(409, "key_already_registered");

  // 6. GCP project (Google only).
  const now = Date.now();
  let projectHash: string | null = null;
  const probe = await forceErrorGcpProbe(rawKey, body.provider);
  if (probe && "unavailable" in probe && body.pool_type === "COMMUNITY") {
    return fail(422, "project_unverifiable", `GCP project could not be verified (${probe.unavailable})`);
  }
  const ANTI_CYCLING_MS = 60 * 60 * 1000;
  let antiCyclingUntil: number | null = null;
  if (probe && "projectNumber" in probe) {
    projectHash = await sha256Hex(probe.projectNumber);
    const existing = await db
      .prepare(
        "SELECT state, tenant_id, rotating_until, tombstone_until, updated_at FROM project_hash_registry WHERE project_hash = ?"
      )
      .bind(projectHash)
      .first<{
        state: string;
        tenant_id: string;
        rotating_until: number | null;
        tombstone_until: number | null;
        updated_at?: number | null;
      }>();
    if (existing?.state === "ACTIVE") return fail(409, "project_already_registered");
    if (existing?.state === "TOMBSTONED") {
      const isRecentOwnerRevocation =
        existing.tenant_id === tenantId &&
        existing.rotating_until === null &&
        now - (existing.updated_at ?? 0) <= DAY_MS;

      if (isRecentOwnerRevocation) {
        antiCyclingUntil = now + ANTI_CYCLING_MS;
      } else if ((existing.tombstone_until ?? Infinity) > now) {
        return fail(409, "project_tombstoned");
      } else if (now - (existing.tombstone_until ?? 0) <= DAY_MS) {
        antiCyclingUntil = now + ANTI_CYCLING_MS;
      }
    }
    if (existing?.state === "ROTATING" && !(existing.tenant_id === tenantId && (existing.rotating_until ?? 0) + ROTATION_GRACE_MS > now)) {
      return fail(409, "project_already_registered");
    }
  }

  // 7. Proof of life.
  const life = await checkProofOfLife(rawKey, body.provider);
  if ("error" in life) return fail(life.error === "provider_unavailable" ? 503 : 400, life.error);

  // 8. Encrypt under the tenant subkey.
  const tenantKey = await deriveTenantKey(masterKey as string | Uint8Array, tenantId);
  const { ciphertextB64, nonceB64 } = await encrypt(rawKey, tenantKey);
  const keyId = `key_${body.provider}_${now.toString(36)}_${crypto.randomUUID().slice(0, 6)}`;
  const label = body.label || `${body.provider}-key-${now.toString(36)}`;
  const rpmLimit = body.rpm_limit ?? (body.provider === "groq" ? 30 : 15);
  const rpdLimit = body.rpd_limit ?? (body.provider === "groq" ? 14400 : 1500);
  const priority = body.priority ?? 0;
  const community = body.pool_type === "COMMUNITY";
  const keyPrefix = rawKey.slice(0, 8);
  const keySuffix = rawKey.slice(-4);

  // 9. One atomic batch.
  const ip = request.headers.get("cf-connecting-ip");
  const userAgent = request.headers.get("user-agent");
  const consent = (checkbox: "K1" | "K2") =>
    db
      .prepare(
        `INSERT INTO consent_attestations (id, tenant_id, event_type, checkbox_id, consent_version, key_id, attested_at, ip_address, user_agent)
         VALUES (?, ?, 'KEY_SUBMISSION', ?, ?, ?, ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), tenantId, checkbox, KEY_CONSENT_VERSION, keyId, now, ip, userAgent);
  await db.batch([
    repo.buildInsertStatement({
      id: keyId,
      tenantId,
      label,
      provider: body.provider,
      ciphertextB64,
      nonceB64,
      keyPrefix,
      keySuffix,
      rpmLimit,
      rpdLimit,
      priority,
      poolType: body.pool_type,
      communityRoutingStatus: community ? "OBSERVATION" : null,
      observationUntil: community ? now + DAY_MS : null,
      keyHash,
      providerProjectHash: projectHash,
      createdAt: now,
      antiCyclingUntil,
    }),
    ...(projectHash
      ? [
          db
            .prepare(
              `INSERT INTO project_hash_registry (project_hash, tenant_id, provider, state, created_at, updated_at)
               VALUES (?, ?, ?, 'ACTIVE', ?, ?)
               ON CONFLICT(project_hash) DO UPDATE SET tenant_id = excluded.tenant_id, provider = excluded.provider,
                 state = 'ACTIVE', rotating_until = NULL, tombstone_until = NULL, updated_at = excluded.updated_at`
            )
            .bind(projectHash, tenantId, body.provider, now, now),
        ]
      : []),
    consent("K1"),
    consent("K2"),
  ]);

  // 10. Owner's KeyPoolDO and (for COMMUNITY) PoolCoordinatorDO; on failure the row is marked for reconcile.
  const synced = await pushToKeyPool(env, tenantId, {
    id: keyId,
    tenantId,
    provider: body.provider,
    ciphertext: ciphertextB64,
    nonce: nonceB64,
    label,
    priority,
    rpmLimit,
    rpdLimit,
    status: "Healthy",
    poolType: body.pool_type,
  });
  if (!synced) await repo.markSyncPending(keyId);

  if (community) {
    await syncCommunityKeyToCoordinator(env, {
      keyId,
      owner: tenantId,
      provider: body.provider,
      observationUntil: now + DAY_MS,
      rpmLimit,
      rpdLimit,
    });
  }

  return Response.json(
    {
      id: keyId,
      key_prefix: keyPrefix,
      key_suffix: keySuffix,
      provider: body.provider,
      label,
      rpm_limit: rpmLimit,
      rpd_limit: rpdLimit,
      priority,
      status: "healthy",
      pool_type: body.pool_type,
      requests_this_min: 0,
      requests_today: 0,
      total_requests: 0,
      created_at: new Date(now).toISOString(),
      sync: synced ? "ok" : "pending",
    },
    { status: 201 }
  );
}

async function pushToKeyPool(env: WorkerEnv, tenantId: string, key: Record<string, unknown>): Promise<boolean> {
  const ns = env.KEY_POOL as unknown as DurableObjectNamespaceLike | undefined;
  if (!ns || typeof ns.idFromName !== "function") return false;
  try {
    const stub = ns.get(ns.idFromName(tenantId)) as unknown as {
      fetch(url: string, init?: RequestInit): Promise<Response>;
      reconcile?(tenantId?: string): Promise<number>;
    };
    const res = await stub.fetch("http://key-pool/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (typeof stub.reconcile === "function") {
      await stub.reconcile(tenantId);
    }
    return res.ok;
  } catch (err: unknown) {
    console.error("KeyPoolDO sync failed; key marked sync_pending:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function syncCommunityKeyToCoordinator(
  env: WorkerEnv,
  input: {
    keyId: string;
    owner: string;
    provider: string;
    observationUntil: number;
    rpmLimit: number;
    rpdLimit: number;
  }
): Promise<void> {
  const coordNs = env.POOL_COORDINATOR as unknown as
    | {
        idFromName(name: string): DurableObjectId;
        get(id: DurableObjectId): {
          upsertKey?(req: {
            keyId: string;
            owner: string;
            provider: string;
            status: "OBSERVATION";
            observationUntil: number;
            rpmLimit: number;
            rpdLimit: number;
          }): Promise<unknown>;
        };
      }
    | undefined;
  if (!coordNs || typeof coordNs.idFromName !== "function") return;
  try {
    const stub = coordNs.get(coordNs.idFromName(input.provider));
    if (typeof stub.upsertKey === "function") {
      await stub.upsertKey({
        keyId: input.keyId,
        owner: input.owner,
        provider: input.provider,
        status: "OBSERVATION",
        observationUntil: input.observationUntil,
        rpmLimit: input.rpmLimit,
        rpdLimit: input.rpdLimit,
      });
    }
  } catch {
    // Coordinator reconcile will pick up the key
  }
}
