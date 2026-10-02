/**
 * Key Collective v2/v4 — Dashboard Keys Query Handler
 *
 * Invariants (GEMINI.md Constitution):
 * - Per-Tenant Isolation: Scoped by tenantId.
 * - Strict TypeScript (zero `any`).
 */

import { ApiKeyRepository } from "../../../../storage/repositories/api_keys/repository";
import type { WorkerEnv } from "../../../auth/index";
import { normaliseKeyStatus, normalisePoolType } from "../../../../contracts/keys";
import { toEpochMs } from "../../../../utils/time";

export interface FormattedKeyItem {
  id: string;
  key_prefix: string;
  key_suffix: string;
  provider: string;
  label: string;
  rpm_limit: number;
  rpd_limit: number;
  priority: number;
  status: string;
  requests_this_min: number;
  requests_today: number;
  total_requests: number;
  avg_latency_ms: number;
  cooldown_until: number | null;
  created_at: number | null;
  pool_type: "PRIVATE" | "COMMUNITY";
  community_routing_status: "OBSERVATION" | "ACTIVE" | "QUARANTINED" | "REVOKED";
  observation_until: number | null;
  dispatches_today: number;
  dispatches_communal: number;
  tenant_id?: string;
  is_owner: boolean;
}

interface ApiKeyRow {
  id: string;
  tenant_id: string;
  label: string;
  provider: string;
  key_prefix: string;
  key_suffix: string;
  rpm_limit: number;
  rpd_limit: number;
  priority: number;
  status: string;
  circuit_open_until: string | null;
  created_at: string;
  pool_type: "PRIVATE" | "COMMUNITY" | null;
  community_routing_status: "OBSERVATION" | "ACTIVE" | "QUARANTINED" | "REVOKED" | null;
  observation_until: string | null;
}

interface CoordinatorCounterEntry {
  dispatchedToday: number;
  dispatchedCommunal: number;
  status?: string;
  observationUntil?: number | null;
}

export async function handleGetKeys(
  env: WorkerEnv,
  tenantId: string
): Promise<Response> {
  const isUnauthenticated = !tenantId || tenantId === "anonymous" || tenantId === "guest";
  if (isUnauthenticated) {
    return Response.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  }

  if (!env.DB || typeof env.DB.prepare !== "function") {
    return Response.json([]);
  }

  let isGlobal = tenantId === "admin";
  if (!isGlobal) {
    try {
      const u = await env.DB.prepare("SELECT tier, role FROM users WHERE id = ?").bind(tenantId).first<{ tier?: string; role?: string }>();
      if (u && (u.tier === "admin" || u.role === "admin")) {
        isGlobal = true;
      }
    } catch {}
  }

  const keyRows = await new ApiKeyRepository(env.DB).listForDashboard<ApiKeyRow>(isGlobal ? null : tenantId);

  const metricsQuery = isGlobal
    ? `SELECT key_id, COUNT(*) as total_reqs, AVG(latency_ms) as avg_lat
       FROM cost_ledger
       GROUP BY key_id`
    : `SELECT key_id, COUNT(*) as total_reqs, AVG(latency_ms) as avg_lat
       FROM cost_ledger
       WHERE tenant_id = ?
       GROUP BY key_id`;

  const metricsResult = isGlobal
    ? await env.DB.prepare(metricsQuery).all<{
        key_id: string;
        total_reqs: number;
        avg_lat: number | null;
      }>()
    : await env.DB.prepare(metricsQuery).bind(tenantId).all<{
        key_id: string;
        total_reqs: number;
        avg_lat: number | null;
      }>();

  const metricsMap = new Map<string, { total_reqs: number; avg_lat: number }>();
  if (metricsResult.results) {
    for (const m of metricsResult.results) {
      metricsMap.set(m.key_id, {
        total_reqs: m.total_reqs || 0,
        avg_lat: Math.round(m.avg_lat || 0),
      });
    }
  }

  const rows = keyRows || [];
  const keyIds = rows.map((r) => r.id);
  const coordCounterMap = new Map<string, CoordinatorCounterEntry>();

  const coordinatorNs = env.POOL_COORDINATOR as
    | {
        idFromName?: (n: string) => unknown;
        get?: (id: unknown) => {
          getKeysCounterMap?: (
            ids?: string[]
          ) => Promise<Record<string, CoordinatorCounterEntry>>;
        };
      }
    | undefined;

  if (
    keyIds.length > 0 &&
    coordinatorNs &&
    typeof coordinatorNs.idFromName === "function" &&
    typeof coordinatorNs.get === "function"
  ) {
    for (const shard of ["google", "groq"]) {
      try {
        const stub = coordinatorNs.get(coordinatorNs.idFromName(`pool:${shard}`));
        if (typeof stub.getKeysCounterMap === "function") {
          const map = await stub.getKeysCounterMap(keyIds);
          for (const [kId, entry] of Object.entries(map)) {
            coordCounterMap.set(kId, entry);
          }
        }
      } catch (err) {
        void err;
      }
    }
  }

  const formattedKeys: FormattedKeyItem[] = rows.map((row) => {
    const metric = metricsMap.get(row.id);
    const coordEntry = coordCounterMap.get(row.id);
    const normStatus = normaliseKeyStatus(row.status, row.community_routing_status);

    const isOwner = isGlobal ? true : row.tenant_id === tenantId;

    const keyPrefix = (row.key_prefix || "").slice(0, 6);
    const keySuffix = (row.key_suffix || "").slice(-4);

    const createdMs = toEpochMs(row.created_at);

    const formattedKey: FormattedKeyItem = {
      id: row.id,
      key_prefix: keyPrefix,
      key_suffix: keySuffix,
      provider: row.provider === "google" ? "gemini" : row.provider,
      label: row.label,
      rpm_limit: row.rpm_limit,
      rpd_limit: row.rpd_limit,
      priority: row.priority,
      status: normStatus,
      requests_this_min: 0,
      requests_today: metric?.total_reqs ?? 0,
      total_requests: metric?.total_reqs ?? 0,
      avg_latency_ms: metric?.avg_lat ?? 0,
      cooldown_until: toEpochMs(row.circuit_open_until),
      created_at: createdMs,
      pool_type: normalisePoolType(row.pool_type),
      community_routing_status: row.community_routing_status ?? "OBSERVATION",
      observation_until: toEpochMs(row.observation_until),
      dispatches_today: coordEntry?.dispatchedToday ?? 0,
      dispatches_communal: coordEntry?.dispatchedCommunal ?? 0,
      ...(isGlobal ? { tenant_id: row.tenant_id } : {}),
      is_owner: isOwner,
    };

    return formattedKey;
  });

  return Response.json(formattedKeys, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
