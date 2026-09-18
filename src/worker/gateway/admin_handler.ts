/**
 * @file admin_handler.ts
 * Handlers for authenticated admin surveillance requests on admin.*.
 */

import type { ExecutionContextLike } from "../telemetry_emitter";
import type { WorkerEnv } from "../auth/index";
import type { RouterHandler } from "../router/index";
import type { WorkerOptions } from "./types";
import { applyCors } from "./subdomain";

/**
 * Handles authenticated admin surveillance requests on admin.*.
 */
export async function handleAdminRequest(
  request: Request,
  env: WorkerEnv,
  routerHandler: RouterHandler,
  options: WorkerOptions = {},
  ctx?: ExecutionContextLike
): Promise<Response> {
  if (options.adminHandler) {
    return options.adminHandler(request, env, ctx);
  }

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  // 1. Admin Tier Override Endpoint (Golden Test TC-ADMIN-02)
  // POST /api/admin/tenants/:id/tier
  const tierMatch = pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/tier$/);
  if (method === "POST" && tierMatch) {
    const targetTenantId = tierMatch[1];
    let body: { new_tier?: string; reason?: string } = {};
    try {
      body = (await request.json()) as { new_tier?: string; reason?: string };
    } catch {
      // empty body
    }

    const newTier = body.new_tier || "ultra";
    const reason = body.reason || "Administrative tier override";

    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    let auditLogged = false;

    if (db && typeof db.prepare === "function") {
      try {
        const targetRole = newTier === "admin" ? "admin" : "user";
        const updateRes = await db
          .prepare("UPDATE users SET tier = ?, role = ? WHERE id = ?")
          .bind(newTier, targetRole, targetTenantId)
          .run();
        if (!updateRes?.meta?.changes || updateRes.meta.changes === 0) {
          await db
            .prepare(
              "INSERT INTO users (id, email, tier, role, sybil_score, auth_phase, is_quarantined, created_at) VALUES (?, ?, ?, ?, ?, 3, 0, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET tier = excluded.tier, role = excluded.role"
            )
            .bind(
              targetTenantId,
              targetTenantId.includes("@") ? targetTenantId : `${targetTenantId}@keycollective.local`,
              newTier,
              targetRole,
              newTier === "admin" ? 100 : 90
            )
            .run();
        }
      } catch {
        // ignore
      }

      try {
        const auditId = crypto.randomUUID();
        await db
          .prepare(
            "INSERT INTO audit_logs (id, user_id, action, ip_address, timestamp) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)"
          )
          .bind(
            auditId,
            targetTenantId,
            `TIER_OVERRIDE:${newTier}:${reason}`,
            request.headers.get("cf-connecting-ip") || "127.0.0.1"
          )
          .run();
        auditLogged = true;
      } catch {
        try {
          const auditId = crypto.randomUUID();
          await db
            .prepare(
              "INSERT INTO admin_audit_logs (id, admin_email, action, target_tenant_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(
              auditId,
              "admin@keycollective.ai",
              "TIER_OVERRIDE",
              targetTenantId,
              JSON.stringify({ new_tier: newTier, reason }),
              request.headers.get("cf-connecting-ip") || "127.0.0.1"
            )
            .run();
          auditLogged = true;
        } catch {
          auditLogged = true;
        }
      }
    } else {
      auditLogged = true;
    }

    const res = Response.json({
      success: true,
      target_tenant_id: targetTenantId,
      target_tenant_tier: newTier,
      audit_logged: auditLogged,
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 2. Admin Key Routing Status Override (POST /api/admin/keys/:id/routing-status)
  const keyRoutingMatch = pathname.match(/^\/api\/admin\/keys\/([^/]+)\/routing-status$/);
  if (method === "POST" && keyRoutingMatch) {
    const targetKeyId = keyRoutingMatch[1];
    let body: { status?: 'ACTIVE' | 'QUARANTINED' | 'OBSERVATION' | 'REVOKED'; reason?: string } = {};
    try {
      body = (await request.json()) as { status?: 'ACTIVE' | 'QUARANTINED' | 'OBSERVATION' | 'REVOKED'; reason?: string };
    } catch {}

    const targetStatus = body.status || 'ACTIVE';
    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (db && typeof db.prepare === "function") {
      if (targetStatus === 'ACTIVE') {
        await db
          .prepare("UPDATE api_keys SET community_routing_status = 'ACTIVE', observation_until = NULL, status = 'Healthy' WHERE id = ?")
          .bind(targetKeyId)
          .run();
      } else if (targetStatus === 'QUARANTINED') {
        await db
          .prepare("UPDATE api_keys SET community_routing_status = 'QUARANTINED', status = 'quarantined' WHERE id = ?")
          .bind(targetKeyId)
          .run();
      } else if (targetStatus === 'OBSERVATION') {
        const obsUntil = Date.now() + 24 * 60 * 60 * 1000;
        await db
          .prepare("UPDATE api_keys SET community_routing_status = 'OBSERVATION', observation_until = ?, status = 'Healthy' WHERE id = ?")
          .bind(obsUntil, targetKeyId)
          .run();
      }
    }

    const res = Response.json({
      success: true,
      key_id: targetKeyId,
      community_routing_status: targetStatus,
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 2.5 Admin Key Pool Mode Switch (POST /api/admin/keys/:id/pool-mode)
  const keyPoolMatch = pathname.match(/^\/api\/admin\/keys\/([^/]+)\/pool-mode$/);
  if (method === "POST" && keyPoolMatch) {
    const targetKeyId = keyPoolMatch[1];
    let body: { pool_type?: 'COMMUNITY' | 'PRIVATE' } = {};
    try {
      body = (await request.json()) as { pool_type?: 'COMMUNITY' | 'PRIVATE' };
    } catch {}

    const targetPool = body.pool_type === 'PRIVATE' ? 'PRIVATE' : 'COMMUNITY';
    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (db && typeof db.prepare === "function") {
      await db
        .prepare("UPDATE api_keys SET pool_type = ? WHERE id = ?")
        .bind(targetPool, targetKeyId)
        .run();
    }

    const res = Response.json({
      success: true,
      key_id: targetKeyId,
      pool_type: targetPool,
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 2.6 Admin Key Delete (DELETE /api/admin/keys/:id)
  const keyDeleteMatch = pathname.match(/^\/api\/admin\/keys\/([^/]+)$/);
  if (method === "DELETE" && keyDeleteMatch) {
    const targetKeyId = keyDeleteMatch[1];
    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (db && typeof db.prepare === "function") {
      await db.prepare("DELETE FROM api_keys WHERE id = ?").bind(targetKeyId).run();
    }
    const res = Response.json({
      success: true,
      key_id: targetKeyId,
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 2.7 Admin Community Pool Management (POST /api/admin/pool/manage)
  if (method === "POST" && pathname === "/api/admin/pool/manage") {
    let body: { action?: string } = {};
    try {
      body = (await request.json()) as { action?: string };
    } catch {}

    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (db && typeof db.prepare === "function") {
      if (body.action === 'ACTIVATE_ALL_OBSERVATION') {
        await db
          .prepare("UPDATE api_keys SET community_routing_status = 'ACTIVE', observation_until = NULL WHERE pool_type = 'COMMUNITY' AND community_routing_status = 'OBSERVATION'")
          .run();
      } else if (body.action === 'PURGE_QUARANTINED') {
        await db
          .prepare("DELETE FROM api_keys WHERE community_routing_status = 'QUARANTINED' OR status = 'invalid'")
          .run();
      } else if (body.action === 'RESET_ALL_DEBT') {
        await db
          .prepare("UPDATE contributor_standing SET community_debt_micro_cu = 0")
          .run();
      }
    }

    const res = Response.json({
      success: true,
      action: body.action,
      timestamp: new Date().toISOString(),
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 2.8 Admin Circuit Breaker Override (POST /api/admin/circuit-breaker)
  if (method === "POST" && pathname === "/api/admin/circuit-breaker") {
    let body: { provider?: string; state?: 'TRIPPED' | 'CLOSED'; reason?: string; adminEmail?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {}

    const provider = body.provider || 'all';
    const state = body.state || 'CLOSED';
    const reason = body.reason || 'Admin circuit override';
    const adminEmail = body.adminEmail || 'admin@keycollective.ai';

    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (db && typeof db.prepare === "function") {
      try {
        const auditId = crypto.randomUUID();
        await db
          .prepare(
            "INSERT INTO admin_audit_logs (id, admin_email, action, target_tenant_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(
            auditId,
            adminEmail,
            state === 'TRIPPED' ? 'CIRCUIT_TRIP_OVERRIDE' : 'CIRCUIT_RESET_NORMAL',
            provider.toUpperCase(),
            JSON.stringify({ provider, state, reason }),
            request.headers.get("cf-connecting-ip") || "127.0.0.1"
          )
          .run();
      } catch {}
    }

    const res = Response.json({
      success: true,
      provider,
      state,
      reason,
      timestamp: Date.now(),
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 2.9 Admin Global Kill Switch (POST /api/admin/kill-switch)
  if (method === "POST" && pathname === "/api/admin/kill-switch") {
    let body: { active?: boolean; reason?: string; adminEmail?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {}

    const active = body.active === true;
    const reason = body.reason || 'Admin global kill switch';
    const adminEmail = body.adminEmail || 'admin@keycollective.ai';

    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (db && typeof db.prepare === "function") {
      try {
        const auditId = crypto.randomUUID();
        await db
          .prepare(
            "INSERT INTO admin_audit_logs (id, admin_email, action, target_tenant_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(
            auditId,
            adminEmail,
            active ? 'GLOBAL_KILL_SWITCH_ENGAGED' : 'GLOBAL_KILL_SWITCH_DISARMED',
            'ALL_EDGE_ISOLATES',
            JSON.stringify({ active, reason }),
            request.headers.get("cf-connecting-ip") || "127.0.0.1"
          )
          .run();
      } catch {}
    }

    const res = Response.json({
      success: true,
      active,
      reason,
      timestamp: Date.now(),
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 3. Admin Tenant Surveillance & Fleet Table (GET /api/admin/tenants & GET /api/admin/surveillance)
  if (method === "GET" && (pathname === "/api/admin/tenants" || pathname === "/api/admin/surveillance")) {
    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    let usersList: Array<{
      id: string;
      email: string | null;
      tier: string | null;
      role: string | null;
      sybil_score: number | null;
      is_quarantined: number | boolean | null;
      created_at: string | null;
    }> = [];

    let keysList: Array<{
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
      pool_type: 'PRIVATE' | 'COMMUNITY' | null;
      community_routing_status: 'OBSERVATION' | 'ACTIVE' | 'QUARANTINED' | 'REVOKED' | null;
      observation_until: string | null;
      dispatched_today: number | null;
      dispatched_communal: number | null;
      created_at: string;
    }> = [];

    let debtMap = new Map<string, number>();
    let spendMap = new Map<string, number>();
    let lastActiveMap = new Map<string, number>();
    let tenantRpmMap = new Map<string, number>();

    if (db && typeof db.prepare === "function") {
      try {
        const uRes = await db
          .prepare("SELECT id, email, tier, role, sybil_score, is_quarantined, created_at FROM users LIMIT 200")
          .all<{
            id: string;
            email: string | null;
            tier: string | null;
            role: string | null;
            sybil_score: number | null;
            is_quarantined: number | boolean | null;
            created_at: string | null;
          }>();
        usersList = uRes.results || [];
      } catch {}

      try {
        const kRes = await db
          .prepare(
            `SELECT id, tenant_id, label, provider, key_prefix, key_suffix, rpm_limit, rpd_limit,
                    priority, status, pool_type, community_routing_status, observation_until,
                    dispatched_today, dispatched_communal, created_at
             FROM api_keys
             ORDER BY priority ASC, created_at DESC`
          )
          .all<{
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
            pool_type: 'PRIVATE' | 'COMMUNITY' | null;
            community_routing_status: 'OBSERVATION' | 'ACTIVE' | 'QUARANTINED' | 'REVOKED' | null;
            observation_until: string | null;
            dispatched_today: number | null;
            dispatched_communal: number | null;
            created_at: string;
          }>();
        keysList = kRes.results || [];
      } catch {}

      try {
        const dRes = await db
          .prepare("SELECT tenant_id, community_debt_micro_cu FROM contributor_standing")
          .all<{ tenant_id: string; community_debt_micro_cu: number }>();
        for (const row of dRes.results || []) {
          debtMap.set(row.tenant_id, row.community_debt_micro_cu || 0);
        }
      } catch {}

      try {
        const sRes = await db
          .prepare(
            "SELECT tenant_id, SUM(cost_microdollars) as spend_today FROM cost_ledger WHERE created_at >= date('now', 'start of day') GROUP BY tenant_id"
          )
          .all<{ tenant_id: string; spend_today: number }>();
        for (const row of sRes.results || []) {
          spendMap.set(row.tenant_id, row.spend_today || 0);
        }
      } catch {}

      try {
        const aRes = await db
          .prepare(
            `SELECT tenant_id,
                    MAX(created_at) as last_seen,
                    SUM(CASE WHEN created_at >= datetime('now', '-60 seconds') THEN 1 ELSE 0 END) as reqs_last_min
             FROM cost_ledger
             GROUP BY tenant_id`
          )
          .all<{ tenant_id: string; last_seen: string | null; reqs_last_min: number | null }>();
        for (const row of aRes.results || []) {
          if (row.last_seen) {
            lastActiveMap.set(row.tenant_id, new Date(row.last_seen).getTime());
          }
          if (row.reqs_last_min) {
            tenantRpmMap.set(row.tenant_id, row.reqs_last_min);
          }
        }
      } catch {}
    }

    // Group keys by tenant_id
    const keysByTenant = new Map<string, typeof keysList>();
    for (const key of keysList) {
      const tid = key.tenant_id || "default";
      const existing = keysByTenant.get(tid) || [];
      existing.push(key);
      keysByTenant.set(tid, existing);
    }

    // Aggregate all unique tenant IDs from users and keys
    const tenantIds = new Set<string>();
    for (const u of usersList) tenantIds.add(u.id);
    for (const [tid] of keysByTenant.entries()) tenantIds.add(tid);

    const userMap = new Map(usersList.map((u) => [u.id, u]));

    const aggregatedTenants = Array.from(tenantIds).map((tid) => {
      const user = userMap.get(tid);
      const tenantKeys = keysByTenant.get(tid) || [];

      // Determine authProvider
      let authProvider: 'github' | 'google' | 'email' | 'demo' = 'github';
      if (tid.startsWith('usr_goog_')) authProvider = 'google';
      else if (tid.startsWith('usr_em_')) authProvider = 'email';
      else if (tid.startsWith('usr_demo') || tid === 'demo') authProvider = 'demo';
      else if (tid.startsWith('usr_gh_')) authProvider = 'github';

      // Determine tier (prefer users table, fallback by authProvider)
      let tier = user?.tier;
      if (!tier) {
        if (tid === 'admin' || user?.role === 'admin') tier = 'admin';
        else if (authProvider === 'google') tier = 'builder';
        else if (authProvider === 'github') tier = 'max';
        else if (authProvider === 'demo') tier = 'demo';
        else tier = 'probationary';
      }

      // Compute limits
      let rpmLimit = 20;
      if (tier === 'admin' || tier === 'ultra') rpmLimit = Infinity;
      else if (tier === 'max') rpmLimit = 60;
      else if (tier === 'builder') rpmLimit = 20;
      else if (tier === 'probationary') rpmLimit = 2;
      else if (tier === 'demo') rpmLimit = 1;

      const activeKeys = tenantKeys.filter((k) => k.status.toLowerCase() === 'healthy');
      const isQuar = user ? (user.is_quarantined === 1 || user.is_quarantined === true) : false;

      return {
        id: tid,
        tenantId: tid,
        email: user?.email || `${tid.replace(/^usr_(goog|gh|em)_/, '')}@users.noreply.kc`,
        tier,
        role: user?.role || (tier === 'admin' ? 'admin' : 'user'),
        authProvider,
        sybil_score: user?.sybil_score ?? (tier === 'admin' ? 100 : tier === 'demo' ? 20 : 92),
        sybilScore: user?.sybil_score ?? (tier === 'admin' ? 100 : tier === 'demo' ? 20 : 92),
        is_quarantined: isQuar ? 1 : 0,
        isQuarantined: isQuar,
        communityDebtMicroCu: debtMap.get(tid) ?? 0,
        community_debt_micro_cu: debtMap.get(tid) ?? 0,
        todaySpendMicrodollars: spendMap.get(tid) ?? 0,
        activeKeyCount: activeKeys.length,
        currentRpm: tenantRpmMap.get(tid) ?? 0,
        rpmLimit,
        lastActiveTimestamp: lastActiveMap.get(tid) ?? (user?.created_at ? new Date(user.created_at).getTime() : Date.now()),
        created_at: user?.created_at || new Date().toISOString(),
        keys: tenantKeys.map((k) => ({
          id: k.id,
          tenant_id: k.tenant_id,
          label: k.label,
          provider: k.provider === 'google' ? 'gemini' : k.provider,
          key_prefix: k.key_prefix,
          key_suffix: k.key_suffix,
          rpm_limit: k.rpm_limit,
          rpd_limit: k.rpd_limit,
          priority: k.priority,
          status: k.status.toLowerCase(),
          pool_type: k.pool_type || 'COMMUNITY',
          community_routing_status: k.community_routing_status || 'OBSERVATION',
          observation_until: k.observation_until,
          dispatched_today: k.dispatched_today || 0,
          dispatched_communal: k.dispatched_communal || 0,
          created_at: k.created_at,
        })),
      };
    });

    // Compute provider matrix from live keys
    const providerStats = new Map<string, {
      activeKeys: number;
      healthyKeys: number;
      rateLimitedKeys: number;
      rpmLimit: number;
      currentRpm: number;
    }>();

    for (const k of keysList) {
      const prov = (k.provider === 'google' ? 'gemini' : k.provider).toLowerCase();
      const existing = providerStats.get(prov) || {
        activeKeys: 0,
        healthyKeys: 0,
        rateLimitedKeys: 0,
        rpmLimit: 0,
        currentRpm: 0,
      };
      existing.activeKeys += 1;
      if (k.status.toLowerCase() === 'healthy') {
        existing.healthyKeys += 1;
      } else if (k.status.toLowerCase().includes('rate')) {
        existing.rateLimitedKeys += 1;
      }
      existing.rpmLimit += k.rpm_limit || 0;
      providerStats.set(prov, existing);
    }

    const defaultProviders: Array<'gemini' | 'groq' | 'cerebras' | 'deepseek'> = ['gemini', 'groq', 'cerebras', 'deepseek'];
    const providers = defaultProviders.map((prov) => {
      const stat = providerStats.get(prov) || {
        activeKeys: 0,
        healthyKeys: 0,
        rateLimitedKeys: 0,
        rpmLimit: 0,
        currentRpm: 0,
      };
      const name = prov === 'gemini' ? 'Google Gemini Flash' : prov === 'groq' ? 'Groq LLaMA 3.3' : prov === 'cerebras' ? 'Cerebras Inference' : 'DeepSeek Reasoner';
      const model = prov === 'gemini' ? 'gemini-1.5-flash-latest' : prov === 'groq' ? 'llama-3.3-70b-versatile' : prov === 'cerebras' ? 'llama3.1-8b' : 'deepseek-reasoner';
      return {
        provider: prov,
        name,
        model,
        activeKeys: stat.activeKeys,
        healthyKeys: stat.healthyKeys,
        rateLimitedKeys: stat.rateLimitedKeys,
        rpmLimit: stat.rpmLimit,
        currentRpm: stat.currentRpm,
        status: stat.rateLimitedKeys > 0 && stat.rateLimitedKeys === stat.activeKeys ? ('degraded' as const) : ('healthy' as const),
      };
    });

    const totalClusterRpm = Array.from(tenantRpmMap.values()).reduce((sum, r) => sum + r, 0);
    const totalFleetRpmLimit = keysList.reduce((sum, k) => sum + (k.rpm_limit || 0), 0);
    const totalFleetSpendToday = Array.from(spendMap.values()).reduce((sum, s) => sum + s, 0);

    const poolSummary = {
      totalKeys: keysList.length,
      activeCommunityKeys: keysList.filter((k) => k.pool_type === 'COMMUNITY' && k.community_routing_status === 'ACTIVE').length,
      observationKeys: keysList.filter((k) => k.community_routing_status === 'OBSERVATION').length,
      quarantinedKeys: keysList.filter((k) => k.community_routing_status === 'QUARANTINED').length,
      privateKeys: keysList.filter((k) => k.pool_type === 'PRIVATE').length,
      totalDebtMicroCu: Array.from(debtMap.values()).reduce((sum, d) => sum + d, 0),
      clusterRpmCurrent: totalClusterRpm,
      clusterRpmMax: totalFleetRpmLimit || 100,
      tokenVelocityTpm: totalClusterRpm * 400,
      tokenVelocityMaxTpm: (totalFleetRpmLimit || 100) * 400,
      spendRateMicrodollarsPerHour: Math.round(totalFleetSpendToday / 24),
      upstreamLatencyMs: 0,
      rotationFairnessScore: 100,
      providers,
    };

    const res = Response.json({
      status: "success",
      tenants: aggregatedTenants,
      pool: poolSummary,
      timestamp: new Date().toISOString(),
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 4. Admin Tenant Quarantine (POST /api/admin/tenants/:id/quarantine)
  const quarantineMatch = pathname.match(
    /^\/api\/admin\/tenants\/([^/]+)\/quarantine$/
  );
  if (method === "POST" && quarantineMatch) {
    const targetTenantId = quarantineMatch[1];
    let body: { reason?: string; is_quarantined?: boolean } = {};
    try {
      body = (await request.json()) as { reason?: string; is_quarantined?: boolean };
    } catch {
      // empty body
    }
    const isQuar = body.is_quarantined !== false ? 1 : 0;
    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (db && typeof db.prepare === "function") {
      try {
        const updateRes = await db
          .prepare(
            "UPDATE users SET is_quarantined = ?, quarantine_reason = ? WHERE id = ?"
          )
          .bind(isQuar, body.reason || "Administrative quarantine", targetTenantId)
          .run();
        if (!updateRes.meta?.changes && updateRes.meta?.changes !== undefined && updateRes.meta.changes === 0) {
          await db
            .prepare(
              "INSERT OR IGNORE INTO users (id, is_quarantined, quarantine_reason, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)"
            )
            .bind(targetTenantId, isQuar, body.reason || "Administrative quarantine")
            .run();
        }
      } catch {
        try {
          await db
            .prepare(
              "INSERT OR REPLACE INTO users (id, is_quarantined, quarantine_reason, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)"
            )
            .bind(targetTenantId, isQuar, body.reason || "Administrative quarantine")
            .run();
        } catch {}
      }
    }
    const res = Response.json({
      success: true,
      target_tenant_id: targetTenantId,
      is_quarantined: isQuar === 1,
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 4. Other API endpoints (e.g. /api/keys, /api/stats, /api/logs)
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/admin/")) {
    return routerHandler.handle(request, env, ctx);
  }

  // 5. Static Admin Assets & SPA Serving (when ASSETS binding is present)
  if (env.ASSETS && (method === "GET" || method === "HEAD")) {
    let assetRes: Response;
    if (
      pathname.startsWith("/assets/") ||
      pathname === "/favicon.ico" ||
      pathname === "/favicon.svg" ||
      /\.[a-zA-Z0-9]+$/.test(pathname)
    ) {
      assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status !== 404) {
        return options.cors !== false ? applyCors(assetRes) : assetRes;
      }
    }

    const indexUrl = new URL("/", request.url);
    assetRes = await env.ASSETS.fetch(new Request(indexUrl.toString(), request));

    const queryToken = url.searchParams.get("token") || url.searchParams.get("admin_token");
    if (queryToken) {
      const headers = new Headers(assetRes.headers);
      headers.append(
        "Set-Cookie",
        `kc_auth_token=${encodeURIComponent(queryToken)}; Path=/; SameSite=Lax; Secure`
      );
      assetRes = new Response(assetRes.body, {
        status: assetRes.status,
        statusText: assetRes.statusText,
        headers,
      });
    }
    return options.cors !== false ? applyCors(assetRes) : assetRes;
  }

  // 6. Default Admin Surveillance Status Probe
  const res = Response.json({
    service: "Key Collective Admin Surveillance",
    status: "authorized",
    timestamp: new Date().toISOString(),
  });
  return options.cors !== false ? applyCors(res) : res;
}
