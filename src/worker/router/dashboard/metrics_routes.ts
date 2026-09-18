/**
 * Key Collective v2/v4 — Developer Dashboard Logs & Stats Routes
 */

import type { KeyPoolContract } from "../../../contracts/key_pool";
import type { CapacitySummary } from "../../../durable_objects/key_selector";
import type { WorkerEnv } from "../../auth/index";

export async function handleGetLogs(
  env: WorkerEnv,
  tenantId: string,
  headerTenant: string | null,
  getKeyPool: (tenantId: string, env: WorkerEnv) => KeyPoolContract
): Promise<Response> {
  const isGlobal = tenantId === "admin";
  const targetTenantId = isGlobal ? (headerTenant || "default") : tenantId;
  if (!targetTenantId || targetTenantId === "anonymous" || targetTenantId === "guest") {
    return Response.json([]);
  }
  getKeyPool(targetTenantId, env);
  if (!env.DB || typeof env.DB.prepare !== "function") {
    return Response.json([]);
  }

  const logsQuery = isGlobal
    ? `SELECT id, key_id, provider, status_code, latency_ms,
              (prompt_tokens * 4) as bytes_in,
              (completion_tokens * 4) as bytes_out,
              created_at, model_id as model
       FROM cost_ledger
       ORDER BY created_at DESC
       LIMIT 50`
    : `SELECT id, key_id, provider, status_code, latency_ms,
              (prompt_tokens * 4) as bytes_in,
              (completion_tokens * 4) as bytes_out,
              created_at, model_id as model
       FROM cost_ledger
       WHERE tenant_id = ?
       ORDER BY created_at DESC
       LIMIT 50`;

  const logsResult = isGlobal
    ? await env.DB.prepare(logsQuery).all<{
        id: string;
        key_id: string;
        provider: string;
        status_code: number;
        latency_ms: number;
        bytes_in: number;
        bytes_out: number;
        created_at: string;
        model: string;
      }>()
    : await env.DB.prepare(logsQuery).bind(targetTenantId).all<{
        id: string;
        key_id: string;
        provider: string;
        status_code: number;
        latency_ms: number;
        bytes_in: number;
        bytes_out: number;
        created_at: string;
        model: string;
      }>();

  const formattedLogs = (logsResult.results || []).map((l) => ({
    id: l.id,
    key_id: l.key_id,
    provider: l.provider === "google" ? "gemini" : l.provider,
    status_code: l.status_code,
    latency_ms: l.latency_ms,
    bytes_in: l.bytes_in || 250,
    bytes_out: l.bytes_out || 800,
    created_at: l.created_at,
    model: l.model,
  }));

  return Response.json(formattedLogs);
}

export async function handleGetStats(
  env: WorkerEnv,
  tenantId: string,
  headerTenant: string | null,
  getKeyPool: (tenantId: string, env: WorkerEnv) => KeyPoolContract
): Promise<Response> {
  const targetTenantId = tenantId === "admin" ? (headerTenant || "default") : tenantId;
  if (!targetTenantId || targetTenantId === "anonymous" || targetTenantId === "guest") {
    return Response.json({
      total_keys: 0,
      healthy_keys: 0,
      rate_limited_keys: 0,
      invalid_keys: 0,
      total_rpm_limit: 0,
      current_rpm_used: 0,
      daily_quota_limit: 0,
      daily_quota_used: 0,
      avg_latency_ms: 0,
      total_spend_today_microdollars: 0,
    });
  }
  getKeyPool(targetTenantId, env);
  let totalKeys = 0;
  let healthyKeys = 0;
  let rateLimitedKeys = 0;
  let invalidKeys = 0;
  let totalRpmLimit = 0;
  let dailyQuotaLimit = 0;
  let dailyQuotaUsed = 0;
  let avgLatency = 0;
  let totalSpendToday = 0;

  const isGlobal = tenantId === "admin" && !headerTenant;

  if (env.DB && typeof env.DB.prepare === "function") {
    const statsQuery = isGlobal
      ? `SELECT 
           COUNT(*) as total_count,
           SUM(CASE WHEN status = 'Healthy' THEN 1 ELSE 0 END) as healthy_count,
           SUM(CASE WHEN status = 'RateLimited' THEN 1 ELSE 0 END) as rate_limited_count,
           SUM(CASE WHEN status NOT IN ('Healthy', 'RateLimited') THEN 1 ELSE 0 END) as invalid_count,
           SUM(rpm_limit) as rpm_sum,
           SUM(rpd_limit) as rpd_sum
         FROM api_keys`
      : `SELECT 
           COUNT(*) as total_count,
           SUM(CASE WHEN status = 'Healthy' THEN 1 ELSE 0 END) as healthy_count,
           SUM(CASE WHEN status = 'RateLimited' THEN 1 ELSE 0 END) as rate_limited_count,
           SUM(CASE WHEN status NOT IN ('Healthy', 'RateLimited') THEN 1 ELSE 0 END) as invalid_count,
           SUM(rpm_limit) as rpm_sum,
           SUM(rpd_limit) as rpd_sum
         FROM api_keys
         WHERE tenant_id = ?`;

    const keyStats = isGlobal
      ? await env.DB.prepare(statsQuery).first<{
          total_count: number;
          healthy_count: number;
          rate_limited_count: number;
          invalid_count: number;
          rpm_sum: number | null;
          rpd_sum: number | null;
        }>()
      : await env.DB.prepare(statsQuery).bind(targetTenantId).first<{
          total_count: number;
          healthy_count: number;
          rate_limited_count: number;
          invalid_count: number;
          rpm_sum: number | null;
          rpd_sum: number | null;
        }>();

    if (keyStats) {
      totalKeys = keyStats.total_count || 0;
      healthyKeys = keyStats.healthy_count || 0;
      rateLimitedKeys = keyStats.rate_limited_count || 0;
      invalidKeys = keyStats.invalid_count || 0;
      totalRpmLimit = keyStats.rpm_sum || 0;
      dailyQuotaLimit = keyStats.rpd_sum || 0;
    }

    const costQuery = isGlobal
      ? `SELECT COUNT(*) as requests_today, AVG(latency_ms) as avg_lat, COALESCE(SUM(cost_microdollars), 0) as total_spend_microdollars
         FROM cost_ledger
         WHERE date(created_at) = date('now')`
      : `SELECT COUNT(*) as requests_today, AVG(latency_ms) as avg_lat, COALESCE(SUM(cost_microdollars), 0) as total_spend_microdollars
         FROM cost_ledger
         WHERE tenant_id = ? AND date(created_at) = date('now')`;

    const costStats = isGlobal
      ? await env.DB.prepare(costQuery).first<{
          requests_today: number;
          avg_lat: number | null;
          total_spend_microdollars: number | null;
        }>()
      : await env.DB.prepare(costQuery).bind(targetTenantId).first<{
          requests_today: number;
          avg_lat: number | null;
          total_spend_microdollars: number | null;
        }>();

    if (costStats) {
      dailyQuotaUsed = costStats.requests_today || 0;
      if (costStats.avg_lat) {
        avgLatency = Math.round(costStats.avg_lat);
      }
      totalSpendToday = costStats.total_spend_microdollars ? Number(costStats.total_spend_microdollars) : 0;
    }
  }

  let currentRpmUsed = 0;
  try {
    const keyPool = getKeyPool(tenantId, env);
    if ("getCapacitySummary" in keyPool && typeof (keyPool as unknown as { getCapacitySummary: () => Promise<CapacitySummary> }).getCapacitySummary === "function") {
      const cap = await (keyPool as unknown as { getCapacitySummary: () => Promise<CapacitySummary> }).getCapacitySummary();
      if (cap) {
        totalRpmLimit = cap.totalRpmLimit || totalRpmLimit;
        healthyKeys = cap.healthyKeys || healthyKeys;
        totalKeys = cap.totalKeys || totalKeys;
        currentRpmUsed = cap.currentRpm || 0;
      }
    }
  } catch {
    // Fallback to D1 stats
  }

  const totalRpmHeadroom = Math.max(0, totalRpmLimit - currentRpmUsed);

  const statsPayload = {
    total_keys: totalKeys,
    healthy_keys: healthyKeys,
    rate_limited_keys: rateLimitedKeys,
    invalid_keys: invalidKeys,
    total_rpm_headroom: totalRpmHeadroom,
    total_rpm_limit: totalRpmLimit,
    current_rpm_used: currentRpmUsed,
    avg_upstream_latency_ms: avgLatency,
    daily_quota_used: dailyQuotaUsed,
    daily_quota_limit: dailyQuotaLimit,
    proxy_status: rateLimitedKeys === totalKeys && totalKeys > 0 ? "degraded" : "healthy",
    total_spend_today_microdollars: totalSpendToday,
  };

  return Response.json(statsPayload);
}
