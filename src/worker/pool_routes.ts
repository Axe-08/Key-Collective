/**
 * Key Collective v4.0 — Pool Routes Handler
 * Handles: GET /api/pool/telemetry, GET /api/pool/standing,
 *          GET /api/pool/contribution, GET /api/notifications
 */

import { githubLinkRequired, loadPoolRights } from "../auth/rights";
import type { WorkerEnv } from './auth/index';
import type { CoordinatorStats } from '../pool/coordinator_do';

type ExecutionContextLike = { waitUntil: (p: Promise<unknown>) => void };

async function handlePoolTelemetry(
  env: WorkerEnv,
  tenantId: string
): Promise<Response> {
  const isNamedTenant =
    Boolean(tenantId) &&
    tenantId !== 'anonymous' &&
    tenantId !== 'default' &&
    tenantId !== 'guest';

  const coordinatorStats = new Map<string, CoordinatorStats>();
  const coordinatorEyeAccessible = new Map<string, boolean>();
  const coordinatorNs = env.POOL_COORDINATOR as
    | {
        idFromName?: (n: string) => unknown;
        get?: (id: unknown) => {
          stats?: () => Promise<CoordinatorStats>;
          isEyeForEyeAccessible?: (tenant: string, provider?: string) => Promise<boolean>;
        };
      }
    | undefined;

  if (
    coordinatorNs &&
    typeof coordinatorNs.idFromName === 'function' &&
    typeof coordinatorNs.get === 'function'
  ) {
    for (const shard of ['google', 'groq']) {
      const uiProv = shard === 'google' ? 'gemini' : shard;
      try {
        const stub = coordinatorNs.get(coordinatorNs.idFromName(`pool:${shard}`));
        if (typeof stub.stats === 'function') {
          const st = await stub.stats();
          coordinatorStats.set(uiProv, st);
          if (isNamedTenant && typeof stub.isEyeForEyeAccessible === 'function') {
            const acc = await stub.isEyeForEyeAccessible(tenantId, shard);
            coordinatorEyeAccessible.set(uiProv, acc);
          }
        }
      } catch {
        // Coordinator shard unavailable
      }
    }
  }

  let totalActive = 0;
  let totalObservation = 0;
  let totalQuarantined = 0;
  let activeShards = 0;
  let sumUtilisationPct = 0;

  for (const st of coordinatorStats.values()) {
    totalActive += st.activeKeys ?? 0;
    totalObservation += st.observationKeys ?? 0;
    totalQuarantined += st.quarantinedKeys ?? 0;
    if ((st.activeKeys ?? 0) > 0) {
      activeShards += 1;
      sumUtilisationPct += st.utilisationPct ?? 0;
    }
  }

  const uPoolPercent = activeShards > 0 ? Math.floor(sumUtilisationPct / activeShards) : 0;

  const canonicalProviders = ['gemini', 'groq', 'sambanova', 'cerebras'];
  const providerPools = canonicalProviders.map(cp => {
    const st = coordinatorStats.get(cp);
    const activeCount = st?.activeKeys ?? 0;
    const observationCount = st?.observationKeys ?? 0;
    const quarantinedCount = st?.quarantinedKeys ?? 0;
    const p90 = st?.p90LatencyMs ?? 0;
    const wProviderPct = st?.wProviderPct ?? 100;
    const wProvider = Number((wProviderPct / 100).toFixed(2));
    return {
      provider: cp,
      active_keys: activeCount,
      observation_keys: observationCount,
      quarantined_keys: quarantinedCount,
      u_pool_percent: st?.utilisationPct ?? 0,
      w_provider: wProvider > 0 ? wProvider : 1.0,
      p90_latency_ms: p90,
      eye_for_eye_accessible: coordinatorEyeAccessible.get(cp) ?? false,
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
  caps?: {
    vesting: number;
    debt: number;
    band: number;
  };
  recovery?: {
    debt_decay: string;
    estimated_days: number;
  };
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
    // RA-12: a caller with no tenant has no standing; never answer an invented PRISTINE one.
    return Response.json(
      { error: { message: 'Authentication required', code: 'UNAUTHORIZED', statusCode: 401 } },
      { status: 401 }
    );
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
    caps: doState.caps ?? {
      vesting: 450,
      debt: debt > contributed ? 100 : 450,
      band: 450,
    },
    recovery: doState.recovery ?? {
      debt_decay: '20% per day at 00:00 UTC',
      estimated_days: 0,
    },
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
      SUM(CASE WHEN pool_type = 'COMMUNITY' AND community_routing_status = 'ACTIVE' THEN 1 ELSE 0 END) as community_active_keys
    FROM api_keys WHERE tenant_id = ?
  `).bind(tenantId).first<{
    total_keys: number;
    community_active_keys: number;
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
      `SELECT community_debt_cu, daily_contributed_cu FROM contributor_standing WHERE tenant_id = ?`
    ).bind(tenantId).first<{
      community_debt_cu?: number;
      daily_contributed_cu: number;
    }>();
    debt = standing?.community_debt_cu ?? 0;
    contributed = standing?.daily_contributed_cu ?? 0;
  }

  const dispatchedToday = coordDispatchedToday;
  const communalServed = coordCommunalServed;
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
  _ctx: ExecutionContextLike
): Promise<Response | null> {
  if (method === 'GET' && (pathname === '/api/pool/telemetry' || pathname === '/api/pool/contribution')) {
    const anonymous = !tenantId || tenantId === 'anonymous' || tenantId === 'guest';
    if (anonymous || !env.DB || !(await loadPoolRights(env.DB, tenantId)).communityPool) return githubLinkRequired();
  }
  if (method === 'GET' && pathname === '/api/pool/telemetry') return handlePoolTelemetry(env, tenantId);
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
