/**
 * Key Collective v4.0 — Pool Routes Handler
 * Handles: GET /api/pool/telemetry, GET /api/pool/standing,
 *          GET /api/pool/contribution, GET /api/notifications
 */

import { githubLinkRequired, loadPoolRights } from "../auth/rights";
import type { WorkerEnv } from './auth/index';
import { normaliseKeyStatus } from '../contracts/keys';

type ExecutionContextLike = { waitUntil: (p: Promise<unknown>) => void };

interface ProviderAggregate {
  provider: string;
  active_count: number;
  observation_count: number;
  quarantined_count: number;
  total_dispatched_today: number;
  total_dispatched_communal: number;
}

async function handlePoolTelemetry(
  env: WorkerEnv,
  tenantId: string,
  ctx?: ExecutionContextLike
): Promise<Response> {
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

  // 1. Query coordinator stats via typed RPC per provider shard when available
  const coordinatorStats = new Map<string, { activeKeys: number; quarantinedKeys: number }>();
  const coordinatorNs = env.POOL_COORDINATOR as
    | {
        idFromName?: (n: string) => unknown;
        get?: (id: unknown) => {
          stats?: () => Promise<{ activeKeys: number; quarantinedKeys: number }>;
        };
      }
    | undefined;
  if (
    coordinatorNs &&
    typeof coordinatorNs.idFromName === 'function' &&
    typeof coordinatorNs.get === 'function'
  ) {
    for (const shard of ['google', 'groq']) {
      try {
        const stub = coordinatorNs.get(coordinatorNs.idFromName(`pool:${shard}`));
        if (typeof stub.stats === 'function') {
          const st = await stub.stats();
          coordinatorStats.set(shard === 'google' ? 'gemini' : shard, st);
        }
      } catch {
        // Coordinator fallback to D1 counts
      }
    }
  }
  void ctx;

  // 2. Query P90 latency per provider from cost_ledger
  const p90Map = new Map<string, number>();
  try {
    for (const cp of canonicalProviders) {
      const countRow = await db.prepare(
        `SELECT COUNT(*) as total FROM cost_ledger WHERE provider = ? AND created_at > datetime('now', '-24 hours')`
      ).bind(cp).first<{ total: number }>();
      const total = countRow?.total ?? 0;
      if (total > 0) {
        const offset = Math.max(0, Math.floor(total * 0.9) - 1);
        const latRow = await db.prepare(
          `SELECT latency_ms FROM cost_ledger WHERE provider = ? AND created_at > datetime('now', '-24 hours') ORDER BY latency_ms ASC LIMIT 1 OFFSET ?`
        ).bind(cp, offset).first<{ latency_ms: number }>();
        p90Map.set(cp, Math.round(latRow?.latency_ms ?? 0));
      } else {
        p90Map.set(cp, 0);
      }
    }
  } catch {
    // D1 fallback
  }

  const providerPools = canonicalProviders.map(cp => {
    const p = providerMap.get(cp);
    const st = coordinatorStats.get(cp);
    const activeCount = p?.active_count ?? st?.activeKeys ?? 0;
    const quarantinedCount = p?.quarantined_count ?? st?.quarantinedKeys ?? 0;
    const totalKeys = activeCount + quarantinedCount;
    const p90 = p90Map.get(cp) ?? 0;
    const wProvider =
      totalKeys > 0
        ? Number(((activeCount / totalKeys) * (1000 / (p90 || 1000))).toFixed(2))
        : 1.0;
    return {
      provider: cp,
      active_keys: activeCount,
      observation_keys: p?.observation_count ?? 0,
      quarantined_keys: quarantinedCount,
      u_pool_percent: (p && p.total_dispatched_today > 0)
        ? Math.round(((p.total_dispatched_communal ?? 0) / p.total_dispatched_today) * 100)
        : 0,
      w_provider: wProvider > 0 ? wProvider : 1.0,
      p90_latency_ms: p90,
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

interface LiveStandingState {
  communityDebtCu: string;
  contributedCu24h?: string;
  dailyContributedCu: string;
  multiplierCeiling: number;
  multiplierPct?: number;
  trustedContributor?: boolean;
  consecutiveDebtFreeDays?: number;
  jailStatus: 'PRISTINE' | 'SOFT_WARNING' | 'HARD_JAIL';
}

async function fetchLiveStandingFromDO(
  env: WorkerEnv,
  tenantId: string
): Promise<LiveStandingState | null> {
  const quotaNs = env.TENANT_QUOTA as
    | {
        idFromName?: (name: string) => unknown;
        get?: (id: unknown) => {
          standing?: (tenantId?: string) => Promise<LiveStandingState>;
          getDebtStateAsync?: () => Promise<LiveStandingState>;
          getDebtState?: () => Promise<LiveStandingState> | LiveStandingState;
        };
      }
    | undefined;
  if (
    !quotaNs ||
    typeof quotaNs.idFromName !== 'function' ||
    typeof quotaNs.get !== 'function'
  ) {
    return null;
  }
  try {
    const stub = quotaNs.get(quotaNs.idFromName(tenantId));
    if (typeof stub.standing === 'function') {
      return await stub.standing(tenantId);
    }
    if (typeof stub.getDebtStateAsync === 'function') {
      return await stub.getDebtStateAsync();
    }
    if (typeof stub.getDebtState === 'function') {
      return await stub.getDebtState();
    }
  } catch (err) {
    void err;
  }
  return null;
}

async function handlePoolStanding(env: WorkerEnv, tenantId: string): Promise<Response> {
  if (!tenantId || tenantId === 'anonymous' || tenantId === 'default' || tenantId === 'guest') {
    return Response.json({
      multiplier: 1.0,
      multiplier_pct: 100,
      multiplier_ceiling: 1.0,
      community_debt_cu: 0,
      contributed_cu_24h: 0,
      daily_contributed_cu: 0,
      cu_contributed_today: 0,
      cu_consumed_today: 0,
      net_cu_balance: 0,
      trusted_contributor: false,
      jail_status: 'PRISTINE',
      consecutive_debt_free_days: 0,
    });
  }

  const doState = await fetchLiveStandingFromDO(env, tenantId);
  if (!doState) {
    return Response.json({ error: 'Standing unavailable' }, { status: 500 });
  }

  const debt = Number(doState.communityDebtCu ?? 0);
  const contributed = Number(doState.contributedCu24h ?? doState.dailyContributedCu ?? 0);
  const multiplierPct = doState.multiplierPct ?? doState.multiplierCeiling ?? 100;
  const ceilingPct = doState.multiplierCeiling ?? multiplierPct;
  const multiplier = multiplierPct / 100;
  const ceiling = ceilingPct / 100;

  return Response.json({
    multiplier,
    multiplier_pct: multiplierPct,
    multiplier_ceiling: ceiling,
    community_debt_cu: debt,
    contributed_cu_24h: contributed,
    daily_contributed_cu: contributed,
    cu_contributed_today: contributed,
    cu_consumed_today: debt,
    net_cu_balance: contributed - debt,
    trusted_contributor: Boolean(doState.trustedContributor),
    jail_status: doState.jailStatus ?? 'PRISTINE',
    consecutive_debt_free_days: doState.consecutiveDebtFreeDays ?? 0,
  });
}

async function handlePoolContribution(env: WorkerEnv, tenantId: string): Promise<Response> {
  if (!tenantId || tenantId === 'anonymous' || tenantId === 'default' || tenantId === 'guest') {
    return Response.json({
      total_keys: 0,
      community_active_keys: 0,
      requests_served_for_community_today: 0,
      personal_requests_today: 0,
      community_debt_cu: 0,
      cu_contributed_24h: 0,
      cu_borrowed_24h: 0,
      net_cu: 0,
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
    total_keys: number;
    community_active_keys: number;
    total_dispatched_today: number;
    total_communal_served: number;
  }>();

  let coordActiveKeys = 0;
  let coordDispatchedToday = 0;
  let coordCommunalServed = 0;
  let hasCoordinatorStats = false;

  const coordinatorNs = env.POOL_COORDINATOR as
    | {
        idFromName?: (n: string) => unknown;
        get?: (id: unknown) => {
          ownerStats?: (owner: string) => Promise<{
            totalCommunityKeys: number;
            activeCommunityKeys: number;
            dispatchedToday: number;
            dispatchedCommunal: number;
          }>;
        };
      }
    | undefined;

  if (
    coordinatorNs &&
    typeof coordinatorNs.idFromName === 'function' &&
    typeof coordinatorNs.get === 'function'
  ) {
    for (const shard of ['google', 'groq']) {
      try {
        const stub = coordinatorNs.get(coordinatorNs.idFromName(`pool:${shard}`));
        if (typeof stub.ownerStats === 'function') {
          const st = await stub.ownerStats(tenantId);
          coordActiveKeys += st.activeCommunityKeys ?? 0;
          coordDispatchedToday += st.dispatchedToday ?? 0;
          coordCommunalServed += st.dispatchedCommunal ?? 0;
          hasCoordinatorStats = true;
        }
      } catch (err) {
        void err;
      }
    }
  }

  const doState = await fetchLiveStandingFromDO(env, tenantId);
  let debt = 0;
  let contributed = 0;
  if (doState) {
    debt = Number(doState.communityDebtCu ?? 0);
    contributed = Number(doState.contributedCu24h ?? doState.dailyContributedCu ?? 0);
  } else {
    const standing = await db.prepare(
      `SELECT community_debt_cu, community_debt_micro_cu, daily_contributed_cu FROM contributor_standing WHERE tenant_id = ?`
    ).bind(tenantId).first<{
      community_debt_cu?: number;
      community_debt_micro_cu?: number;
      daily_contributed_cu: number;
    }>();
    debt = standing?.community_debt_cu ?? standing?.community_debt_micro_cu ?? 0;
    contributed = standing?.daily_contributed_cu ?? 0;
  }

  const dispatchedToday = hasCoordinatorStats
    ? coordDispatchedToday
    : (result?.total_dispatched_today ?? 0);
  const communalServed = hasCoordinatorStats
    ? coordCommunalServed
    : (result?.total_communal_served ?? 0);
  const personalRequestsToday = Math.max(0, dispatchedToday - communalServed);
  const netCu = contributed - debt;

  return Response.json({
    total_keys: result?.total_keys ?? 0,
    community_active_keys: hasCoordinatorStats && coordActiveKeys > 0
      ? coordActiveKeys
      : (result?.community_active_keys ?? 0),
    requests_served_for_community_today: communalServed,
    personal_requests_today: personalRequestsToday,
    community_debt_cu: debt,
    cu_contributed_24h: contributed,
    cu_borrowed_24h: debt,
    net_cu: netCu,
    cu_contributed_today: contributed,
    cu_consumed_today: debt,
    net_cu_balance: netCu,
  });
}

async function handleNotifications(env: WorkerEnv, tenantId: string, since: number): Promise<Response> {
  if (!env.DB || typeof (env.DB as { prepare?: unknown }).prepare !== 'function') {
    return Response.json({ notifications: [] });
  }
  const db = env.DB as D1Database;
  const result = await db
    .prepare(`
      SELECT id, tenant_id, type, key_id, message, created_at, read_at
      FROM notifications
      WHERE tenant_id = ? AND created_at > ?
      ORDER BY created_at DESC
      LIMIT 50
    `)
    .bind(tenantId, since)
    .all<{
      id: string;
      tenant_id: string;
      type: string;
      key_id: string | null;
      message: string;
      created_at: number;
      read_at: number | null;
    }>();

  return Response.json({ notifications: result.results ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}

async function handleMarkNotificationRead(env: WorkerEnv, tenantId: string, id: string): Promise<Response> {
  if (!env.DB || typeof (env.DB as { prepare?: unknown }).prepare !== 'function') {
    return Response.json({ error: { message: "Database unavailable", statusCode: 503 } }, { status: 503 });
  }
  const db = env.DB as D1Database;
  const now = Date.now();
  await db
    .prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND tenant_id = ?")
    .bind(now, id, tenantId)
    .run();

  return Response.json({ success: true, id, read_at: now });
}

export async function handlePoolRoute(
  pathname: string,
  method: string,
  request: Request,
  env: WorkerEnv,
  tenantId: string,
  ctx: ExecutionContextLike
): Promise<Response | null> {
  if (method === 'GET' && (pathname === '/api/pool/telemetry' || pathname === '/api/pool/contribution')) {
    const anonymous = !tenantId || tenantId === 'anonymous' || tenantId === 'guest';
    if (anonymous || !env.DB || !(await loadPoolRights(env.DB, tenantId)).communityPool) return githubLinkRequired();
  }
  if (method === 'GET' && pathname === '/api/pool/telemetry') return handlePoolTelemetry(env, tenantId, ctx);
  if (method === 'GET' && pathname === '/api/pool/standing') return handlePoolStanding(env, tenantId);
  if (method === 'GET' && pathname === '/api/pool/contribution') return handlePoolContribution(env, tenantId);
  if (method === 'GET' && pathname === '/api/notifications') {
    const url = new URL(request.url);
    const since = parseInt(url.searchParams.get('since') ?? '0', 10);
    return handleNotifications(env, tenantId, Number.isNaN(since) ? 0 : since);
  }
  if (method === 'POST' && pathname.startsWith('/api/notifications/') && pathname.endsWith('/read')) {
    const parts = pathname.split('/');
    const id = parts[3];
    if (id) {
      return handleMarkNotificationRead(env, tenantId, id);
    }
  }
  return null;
}
