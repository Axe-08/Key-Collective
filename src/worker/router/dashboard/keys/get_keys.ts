/**
 * Key Collective v2/v4 — Dashboard Keys Query Handler
 *
 * Invariants (GEMINI.md Constitution):
 * - Per-Tenant Isolation: Scoped by tenantId.
 * - Strict TypeScript (zero `any`).
 */

import type { WorkerEnv } from "../../../auth_middleware";

export async function handleGetKeys(
  env: WorkerEnv,
  tenantId: string
): Promise<Response> {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    return Response.json([]);
  }

  const isGlobal = tenantId === "admin";
  const isUnauthenticated = !tenantId || tenantId === "anonymous" || tenantId === "guest";

  let keysQuery = "";
  if (isGlobal) {
    keysQuery = `SELECT id, label, provider, key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status, circuit_open_until, created_at, pool_type, community_routing_status, observation_until, dispatched_today, dispatched_communal, vesting_tier
       FROM api_keys
       ORDER BY priority ASC, created_at DESC`;
  } else if (isUnauthenticated) {
    keysQuery = `SELECT id, label, provider, key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status, circuit_open_until, created_at, pool_type, community_routing_status, observation_until, dispatched_today, dispatched_communal, vesting_tier
       FROM api_keys
       WHERE pool_type = 'COMMUNITY'
       ORDER BY priority ASC, created_at DESC`;
  } else {
    keysQuery = `SELECT id, label, provider, key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status, circuit_open_until, created_at, pool_type, community_routing_status, observation_until, dispatched_today, dispatched_communal, vesting_tier
       FROM api_keys
       WHERE pool_type = 'COMMUNITY' OR (pool_type = 'PRIVATE' AND tenant_id = ?)
       ORDER BY priority ASC, created_at DESC`;
  }

  const keysResult = (isGlobal || isUnauthenticated)
    ? await env.DB.prepare(keysQuery).all<{
        id: string;
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
        pool_type: 'PRIVATE' | 'COMMUNITY' | null;
        community_routing_status: 'OBSERVATION' | 'ACTIVE' | 'QUARANTINED' | 'REVOKED' | null;
        observation_until: string | null;
        dispatched_today: number | null;
        dispatched_communal: number | null;
        vesting_tier: 0 | 1 | 2 | null;
      }>()
    : await env.DB.prepare(keysQuery).bind(tenantId).all<{
        id: string;
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
        pool_type: 'PRIVATE' | 'COMMUNITY' | null;
        community_routing_status: 'OBSERVATION' | 'ACTIVE' | 'QUARANTINED' | 'REVOKED' | null;
        observation_until: string | null;
        dispatched_today: number | null;
        dispatched_communal: number | null;
        vesting_tier: 0 | 1 | 2 | null;
      }>();

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

  const rows = keysResult.results || [];
  const formattedKeys = rows.map((row) => {
    const metric = metricsMap.get(row.id);
    const normStatus = row.status.toLowerCase().includes("rate")
      ? "rate_limited"
      : row.status.toLowerCase().includes("exhaust")
      ? "exhausted"
      : row.status.toLowerCase().includes("invalid")
      ? "invalid"
      : row.status.toLowerCase().includes("disable")
      ? "disabled"
      : "healthy";

    return {
      id: row.id,
      key_prefix: row.key_prefix,
      key_suffix: row.key_suffix,
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
      cooldown_until: row.circuit_open_until,
      created_at: row.created_at,
      pool_type: row.pool_type ?? 'COMMUNITY',
      community_routing_status: row.community_routing_status ?? 'OBSERVATION',
      observation_until: row.observation_until ?? null,
      dispatched_today: row.dispatched_today ?? 0,
      dispatched_communal: row.dispatched_communal ?? 0,
      vesting_tier: row.vesting_tier ?? 0,
    };
  });

  return Response.json(formattedKeys, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
