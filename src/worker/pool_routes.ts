/**
 * Key Collective v4.0 — Pool Routes Handler
 * Handles: GET /api/pool/telemetry, GET /api/pool/standing,
 *          GET /api/pool/contribution, GET /api/notifications
 */

import type { WorkerEnv } from './auth_middleware';

type ExecutionContextLike = { waitUntil: (p: Promise<unknown>) => void };

interface ProviderAggregate {
  provider: string;
  active_count: number;
  observation_count: number;
  quarantined_count: number;
  total_dispatched_today: number;
  total_dispatched_communal: number;
}

async function handlePoolTelemetry(env: WorkerEnv, tenantId: string): Promise<Response> {
  if (!env.DB || typeof (env.DB as { prepare?: unknown }).prepare !== 'function') {
    return Response.json({ error: 'Database unavailable' }, { status: 503 });
  }
  const db = env.DB as D1Database;
  const aggResult = await db.prepare(`
    SELECT
      provider,
      SUM(CASE WHEN status != 'invalid' AND community_routing_status = 'ACTIVE' THEN 1 ELSE 0 END) as active_count,
      SUM(CASE WHEN community_routing_status = 'OBSERVATION' THEN 1 ELSE 0 END) as observation_count,
      SUM(CASE WHEN status = 'invalid' OR community_routing_status = 'QUARANTINED' THEN 1 ELSE 0 END) as quarantined_count,
      COALESCE(SUM(dispatched_today), 0) as total_dispatched_today,
      COALESCE(SUM(dispatched_communal), 0) as total_dispatched_communal
    FROM api_keys
    WHERE pool_type = 'COMMUNITY'
    GROUP BY provider
  `).all<ProviderAggregate>();

  const providers = aggResult.results ?? [];
  const totalActive = providers.reduce((s, p) => s + (p.active_count ?? 0), 0);
  const totalObservation = providers.reduce((s, p) => s + (p.observation_count ?? 0), 0);
  const totalQuarantined = providers.reduce((s, p) => s + (p.quarantined_count ?? 0), 0);
  const totalDispatched = providers.reduce((s, p) => s + (p.total_dispatched_today ?? 0), 0);
  const totalCommunal = providers.reduce((s, p) => s + (p.total_dispatched_communal ?? 0), 0);
  const uPoolPercent = totalDispatched > 0 ? Math.round((totalCommunal / totalDispatched) * 100) : 0;

  const normalizeProvider = (p: string): string => {
    const s = p.toLowerCase().trim();
    if (s === 'google' || s === 'gemini') return 'gemini';
    return s;
  };

  let tenantProviders = new Set<string>();
  if (tenantId && tenantId !== 'anonymous' && tenantId !== 'default' && tenantId !== 'guest') {
    const tenantProviderResult = await db.prepare(
      `SELECT DISTINCT provider FROM api_keys WHERE tenant_id = ? AND status != 'invalid'`
    ).bind(tenantId).all<{ provider: string }>();
    tenantProviders = new Set((tenantProviderResult.results ?? []).map(r => normalizeProvider(r.provider)));
  }

  const canonicalProviders = ['gemini', 'groq', 'sambanova', 'cerebras'];
  const providerMap = new Map<string, {
    active_count: number;
    observation_count: number;
    quarantined_count: number;
    total_dispatched_today: number;
    total_dispatched_communal: number;
  }>();

  for (const p of providers) {
    const key = normalizeProvider(p.provider);
    const existing = providerMap.get(key) ?? {
      active_count: 0,
      observation_count: 0,
      quarantined_count: 0,
      total_dispatched_today: 0,
      total_dispatched_communal: 0,
    };
    existing.active_count += p.active_count ?? 0;
    existing.observation_count += p.observation_count ?? 0;
    existing.quarantined_count += p.quarantined_count ?? 0;
    existing.total_dispatched_today += p.total_dispatched_today ?? 0;
    existing.total_dispatched_communal += p.total_dispatched_communal ?? 0;
    providerMap.set(key, existing);
  }

  const providerPools = canonicalProviders.map(cp => {
    const p = providerMap.get(cp);
    return {
      provider: cp,
      active_keys: p?.active_count ?? 0,
      observation_keys: p?.observation_count ?? 0,
      quarantined_keys: p?.quarantined_count ?? 0,
      u_pool_percent: (p && p.total_dispatched_today > 0)
        ? Math.round(((p.total_dispatched_communal ?? 0) / p.total_dispatched_today) * 100)
        : 0,
      w_provider: 1.0,
      p90_latency_ms: 0,
      eye_for_eye_accessible: tenantProviders.has(cp),
    };
  });

  return Response.json({
    total_active_keys: totalActive,
    keys_in_observation: totalObservation,
    keys_quarantined: totalQuarantined,
    pool_utilization_percent: uPoolPercent,
    provider_pools: providerPools,
    snapshot_time: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

async function handlePoolStanding(env: WorkerEnv, tenantId: string): Promise<Response> {
  if (!tenantId || tenantId === 'anonymous' || tenantId === 'default' || tenantId === 'guest') {
    return Response.json({
      multiplier: 1.0,
      multiplier_ceiling: 1.0,
      community_debt_cu: 0,
      daily_contributed_cu: 0,
      trusted_contributor: false,
      jail_status: 'PRISTINE',
      consecutive_debt_free_days: 0,
    });
  }
  if (!env.DB || typeof (env.DB as { prepare?: unknown }).prepare !== 'function') {
    return Response.json({ error: 'Database unavailable' }, { status: 503 });
  }
  const db = env.DB as D1Database;
  const row = await db.prepare(`
    SELECT community_debt_micro_cu, daily_contributed_cu, consecutive_debt_free_days,
           trusted_contributor, multiplier_ceiling, current_multiplier
    FROM contributor_standing WHERE tenant_id = ?
  `).bind(tenantId).first<{
    community_debt_micro_cu: number;
    daily_contributed_cu: number;
    consecutive_debt_free_days: number;
    trusted_contributor: number;
    multiplier_ceiling: number;
    current_multiplier: number;
  }>();

  if (!row) {
    return Response.json({
      multiplier: 1.5,
      multiplier_ceiling: 4.5,
      community_debt_cu: 0,
      daily_contributed_cu: 0,
      trusted_contributor: false,
      jail_status: 'PRISTINE',
      consecutive_debt_free_days: 0,
    });
  }

  const multiplier = (row.current_multiplier ?? 150) / 100;
  const ceiling = (row.multiplier_ceiling ?? 450) / 100;
  const debt = row.community_debt_micro_cu ?? 0;
  const contributed = row.daily_contributed_cu ?? 0;

  let jailStatus: 'PRISTINE' | 'SOFT_WARNING' | 'HARD_JAIL' = 'PRISTINE';
  if (contributed > 0) {
    const ratio = debt / contributed;
    if (ratio > 1.0) jailStatus = 'HARD_JAIL';
    else if (ratio > 0.5) jailStatus = 'SOFT_WARNING';
  }

  return Response.json({
    multiplier,
    multiplier_ceiling: ceiling,
    community_debt_cu: debt,
    daily_contributed_cu: contributed,
    trusted_contributor: Boolean(row.trusted_contributor),
    jail_status: jailStatus,
    consecutive_debt_free_days: row.consecutive_debt_free_days ?? 0,
  });
}

async function handlePoolContribution(env: WorkerEnv, tenantId: string): Promise<Response> {
  if (!tenantId || tenantId === 'anonymous' || tenantId === 'default' || tenantId === 'guest') {
    return Response.json({
      total_keys: 0,
      community_active_keys: 0,
      requests_served_for_community_today: 0,
      personal_requests_today: 0,
      cu_contributed_today: 0,
      cu_consumed_today: 0,
      net_cu_balance: 0,
    });
  }
  if (!env.DB || typeof (env.DB as { prepare?: unknown }).prepare !== 'function') {
    return Response.json({ error: 'Database unavailable' }, { status: 503 });
  }
  const db = env.DB as D1Database;
  const result = await db.prepare(`
    SELECT
      COUNT(*) as total_keys,
      SUM(CASE WHEN pool_type = 'COMMUNITY' AND community_routing_status = 'ACTIVE' THEN 1 ELSE 0 END) as community_active_keys,
      COALESCE(SUM(dispatched_today), 0) as total_dispatched_today,
      COALESCE(SUM(dispatched_communal), 0) as total_communal_served
    FROM api_keys WHERE tenant_id = ?
  `).bind(tenantId).first<{
    total_keys: number; community_active_keys: number;
    total_dispatched_today: number; total_communal_served: number;
  }>();

  const standing = await db.prepare(
    `SELECT community_debt_micro_cu, daily_contributed_cu FROM contributor_standing WHERE tenant_id = ?`
  ).bind(tenantId).first<{ community_debt_micro_cu: number; daily_contributed_cu: number }>();

  return Response.json({
    total_keys: result?.total_keys ?? 0,
    community_active_keys: result?.community_active_keys ?? 0,
    requests_served_for_community_today: result?.total_communal_served ?? 0,
    personal_requests_today: (result?.total_dispatched_today ?? 0) - (result?.total_communal_served ?? 0),
    cu_contributed_today: standing?.daily_contributed_cu ?? 0,
    cu_consumed_today: standing?.community_debt_micro_cu ?? 0,
    net_cu_balance: (standing?.daily_contributed_cu ?? 0) - (standing?.community_debt_micro_cu ?? 0),
  });
}

async function handleNotifications(env: WorkerEnv, tenantId: string, since: number): Promise<Response> {
  if (!env.DB || typeof (env.DB as { prepare?: unknown }).prepare !== 'function') {
    return Response.json({ notifications: [] });
  }
  const db = env.DB as D1Database;
  const unhealthyResult = await db.prepare(`
    SELECT id, label, provider, status
    FROM api_keys
    WHERE tenant_id = ? AND status IN ('invalid', 'exhausted') AND created_at > datetime(?, 'unixepoch')
    LIMIT 10
  `).bind(tenantId, Math.floor(since / 1000)).all<{
    id: string; label: string; provider: string; status: string;
  }>();

  const notifications = (unhealthyResult.results ?? []).map(k => ({
    id: `notif_key_${k.id}`,
    type: 'key_health' as const,
    message: `⚠️ Key "${k.label}" (${k.provider}) went ${k.status}. Check your provider dashboard.`,
    created_at: new Date().toISOString(),
  }));

  return Response.json({ notifications }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function handlePoolRoute(
  pathname: string,
  method: string,
  request: Request,
  env: WorkerEnv,
  tenantId: string,
  _ctx: ExecutionContextLike
): Promise<Response | null> {
  if (method === 'GET' && pathname === '/api/pool/telemetry') return handlePoolTelemetry(env, tenantId);
  if (method === 'GET' && pathname === '/api/pool/standing') return handlePoolStanding(env, tenantId);
  if (method === 'GET' && pathname === '/api/pool/contribution') return handlePoolContribution(env, tenantId);
  if (method === 'GET' && pathname === '/api/notifications') {
    const url = new URL(request.url);
    const since = parseInt(url.searchParams.get('since') ?? '0', 10);
    return handleNotifications(env, tenantId, since);
  }
  return null;
}
