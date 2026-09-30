/**
 * Key Collective v2/v4 — Developer Dashboard Logs & Stats Routes
 */

import type { KeyPoolContract } from "../../../contracts/key_pool";
import type { CapacitySummary } from "../../../durable_objects/key_selector";
import type { WorkerEnv } from "../../auth/index";

export async function handleGetLogs(
  env: WorkerEnv,
  tenantId: string,
  getKeyPool: (tenantId: string, env: WorkerEnv) => KeyPoolContract
): Promise<Response> {
  const isGlobal = tenantId === "admin";
  const targetTenantId = tenantId;
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
  getKeyPool: (tenantId: string, env: WorkerEnv) => KeyPoolContract
): Promise<Response> {
  const targetTenantId = tenantId;
  if (!targetTenantId || targetTenantId === "anonymous" || targetTenantId === "guest") {
    return Response.json({
      total_keys: 0,
      healthy_keys: 0,
      rate_limited_keys: 0,
      invalid_keys: 0,
      total_rpm_headroom: 0,
      total_rpm_limit: 0,
      current_rpm_used: 0,
      avg_upstream_latency_ms: 0,
      daily_quota_limit: 0,
      daily_quota_used: 0,
      proxy_status: "healthy",
      cu_used_today: 0,
      cu_allowance_today: 0,
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
  let cuUsedToday = 0;
  let cuAllowanceToday = 0;

  const isGlobal = tenantId === "admin";

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
      ? `SELECT COUNT(*) as requests_today, AVG(latency_ms) as avg_lat, COALESCE(SUM(cu), 0) as cu_sum
         FROM cost_ledger
         WHERE date(created_at) = date('now')`
      : `SELECT COUNT(*) as requests_today, AVG(latency_ms) as avg_lat, COALESCE(SUM(cu), 0) as cu_sum
         FROM cost_ledger
         WHERE tenant_id = ? AND date(created_at) = date('now')`;

    const costStats = isGlobal
      ? await env.DB.prepare(costQuery).first<{
          requests_today: number;
          avg_lat: number | null;
          cu_sum: number | null;
        }>()
      : await env.DB.prepare(costQuery).bind(targetTenantId).first<{
          requests_today: number;
          avg_lat: number | null;
          cu_sum: number | null;
        }>();

    if (costStats) {
      dailyQuotaUsed = costStats.requests_today || 0;
      if (costStats.avg_lat) {
        avgLatency = Math.round(costStats.avg_lat);
      }
      cuUsedToday = costStats.cu_sum ? Number(costStats.cu_sum) : 0;
    }

    try {
      const budgetQuery = isGlobal
        ? `SELECT COALESCE(SUM(budget_cu), 0) as total_budget_cu FROM auth_tokens`
        : `SELECT COALESCE(SUM(budget_cu), 0) as total_budget_cu FROM auth_tokens WHERE tenant_id = ?`;
      const budgetStats = isGlobal
        ? await env.DB.prepare(budgetQuery).first<{ total_budget_cu: number | null }>()
        : await env.DB.prepare(budgetQuery).bind(targetTenantId).first<{ total_budget_cu: number | null }>();
      if (budgetStats && budgetStats.total_budget_cu && budgetStats.total_budget_cu > 0) {
        cuAllowanceToday = Number(budgetStats.total_budget_cu);
      }
    } catch {
      // auth_tokens table/column fallback
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
    if ("getCuMetrics" in keyPool && typeof (keyPool as unknown as { getCuMetrics: () => Promise<{ cuUsedToday?: number; cuAllowanceToday?: number }> }).getCuMetrics === "function") {
      const cuMetrics = await (keyPool as unknown as { getCuMetrics: () => Promise<{ cuUsedToday?: number; cuAllowanceToday?: number }> }).getCuMetrics();
      if (cuMetrics) {
        if (typeof cuMetrics.cuUsedToday === "number") cuUsedToday = cuMetrics.cuUsedToday;
        if (typeof cuMetrics.cuAllowanceToday === "number") cuAllowanceToday = cuMetrics.cuAllowanceToday;
      }
    }
  } catch {
    // Fallback to D1 stats
  }

  if (env.TENANT_QUOTA && targetTenantId && targetTenantId !== "anonymous") {
    try {
      const quotaStub = env.TENANT_QUOTA.get(env.TENANT_QUOTA.idFromName(targetTenantId));
      if (typeof (quotaStub as unknown as { getCuUsed?: () => Promise<bigint | number> }).getCuUsed === "function") {
        const cu = await (quotaStub as unknown as { getCuUsed: () => Promise<bigint | number> }).getCuUsed();
        if (cu !== undefined && cu !== null) {
          cuUsedToday = Number(cu);
        }
      } else if (typeof quotaStub.fetch === "function") {
        const quotaRes = await quotaStub.fetch("http://do/status");
        if (quotaRes.ok) {
          const quotaData = await quotaRes.json<{ cuUsed24h?: string; rpdLimit?: number }>();
          if (quotaData.cuUsed24h !== undefined) {
            cuUsedToday = Number(quotaData.cuUsed24h);
          }
          if (quotaData.rpdLimit !== undefined && cuAllowanceToday === 0 && quotaData.rpdLimit !== Infinity) {
            cuAllowanceToday = quotaData.rpdLimit;
          }
        }
      }
    } catch {
      // DO fallback
    }
  }

  if (cuAllowanceToday === 0 && dailyQuotaLimit > 0) {
    cuAllowanceToday = dailyQuotaLimit;
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
    cu_used_today: cuUsedToday,
    cu_allowance_today: cuAllowanceToday,
  };

  return Response.json(statsPayload);
}
