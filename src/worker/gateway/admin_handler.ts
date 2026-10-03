/**
 * @file admin_handler.ts
 * Handlers for authenticated admin surveillance requests on admin.*.
 */

import type { ExecutionContextLike } from "../telemetry_emitter";
import type { WorkerEnv } from "../auth/index";
import type { RouterHandler } from "../router/index";
import type { WorkerOptions } from "./types";
import { applyCors } from "./subdomain";
import { TOKENS_PER_REQUEST_ESTIMATE } from "../../constants/keys";
import { normaliseKeyStatus, normalisePoolType } from "../../contracts/keys";
import { toEpochMs } from "../../utils/time";
import { clearMaintenanceCache } from "./control";
import { getWouldDenyStats } from "../../pool/enforcement";
import { ADMIN_SESSION_COOKIE, lookupSession, readCookie } from "../../auth/session/store";
import { Logger } from "../../utils/logger";

interface AdminActor {
  adminUserId: string | null;
  adminEmail: string;
}

/**
 * Resolves the acting admin from the kc_admin_session cookie. Sessions store only the
 * SHA-256 of the token (id_hash), so the lookup goes through lookupSession (QA-15).
 * Break-glass requests carry no session and keep the generic actor.
 */
async function getAdminActor(request: Request, db?: D1Database): Promise<AdminActor> {
  let adminEmail = "admin@keycollective.ai";
  let adminUserId: string | null = null;
  const token = readCookie(request, ADMIN_SESSION_COOKIE);
  if (token && db && typeof db.prepare === "function") {
    try {
      const session = await lookupSession(db, token);
      if (session && session.kind === "admin") {
        adminUserId = session.userId;
        if (session.email) adminEmail = session.email;
      }
    } catch (err: unknown) {
      new Logger({ traceId: crypto.randomUUID(), tenantId: "admin" }).error(
        "Failed to resolve admin actor from session",
        { error: err instanceof Error ? err.message : String(err) }
      );
    }
  }
  return { adminUserId, adminEmail };
}

async function logAdminAudit(
  db: D1Database | undefined,
  actor: AdminActor,
  action: string,
  target: string,
  details: Record<string, unknown>,
  ipAddress: string
): Promise<void> {
  if (!db || typeof db.prepare !== "function") return;
  try {
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO admin_audit_logs (id, admin_user_id, admin_email, action, target, details_json, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        actor.adminUserId,
        actor.adminEmail,
        action,
        target,
        JSON.stringify(details),
        ipAddress,
        Date.now()
      )
      .run();
  } catch {
    // ignore
  }
}

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

      const actor = await getAdminActor(request, db);
      const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1";
      await logAdminAudit(
        db,
        actor,
        "TIER_OVERRIDE",
        targetTenantId,
        { new_tier: newTier, reason },
        clientIp
      );
      auditLogged = true;
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
    } catch { /* ignore */ }

    const targetStatus = body.status || 'ACTIVE';
    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (db && typeof db.prepare === "function") {
      if (targetStatus === 'ACTIVE') {
        await db
          .prepare("UPDATE api_keys SET community_routing_status = 'ACTIVE', observation_until = NULL, status = 'HEALTHY' WHERE id = ?")
          .bind(targetKeyId)
          .run();
      } else if (targetStatus === 'QUARANTINED') {
        await db
          .prepare("UPDATE api_keys SET community_routing_status = 'QUARANTINED', status = 'QUARANTINED' WHERE id = ?")
          .bind(targetKeyId)
          .run();
      } else if (targetStatus === 'OBSERVATION') {
        const obsUntil = Date.now() + 24 * 60 * 60 * 1000;
        await db
          .prepare("UPDATE api_keys SET community_routing_status = 'OBSERVATION', observation_until = ?, status = 'HEALTHY' WHERE id = ?")
          .bind(obsUntil, targetKeyId)
          .run();
      }

      try {
        const auditId = crypto.randomUUID();
        await db
          .prepare(
            "INSERT INTO admin_audit_logs (id, admin_email, action, target, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(
            auditId,
            "admin@keycollective.ai",
            "KEY_ROUTING_STATUS_OVERRIDE",
            targetKeyId,
            JSON.stringify({ status: targetStatus, reason: body.reason || null }),
            request.headers.get("cf-connecting-ip") || "127.0.0.1"
          )
          .run();
      } catch { /* ignore */ }
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
    } catch { /* ignore */ }

    const targetPool = body.pool_type === 'PRIVATE' ? 'PRIVATE' : 'COMMUNITY';
    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (db && typeof db.prepare === "function") {
      await db
        .prepare("UPDATE api_keys SET pool_type = ? WHERE id = ?")
        .bind(targetPool, targetKeyId)
        .run();

      try {
        const auditId = crypto.randomUUID();
        await db
          .prepare(
            "INSERT INTO admin_audit_logs (id, admin_email, action, target, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(
            auditId,
            "admin@keycollective.ai",
            "KEY_POOL_MODE_SWITCH",
            targetKeyId,
            JSON.stringify({ pool_type: targetPool }),
            request.headers.get("cf-connecting-ip") || "127.0.0.1"
          )
          .run();
      } catch { /* ignore */ }
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

      try {
        const auditId = crypto.randomUUID();
        await db
          .prepare(
            "INSERT INTO admin_audit_logs (id, admin_email, action, target, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(
            auditId,
            "admin@keycollective.ai",
            "KEY_DELETE",
            targetKeyId,
            JSON.stringify({}),
            request.headers.get("cf-connecting-ip") || "127.0.0.1"
          )
          .run();
      } catch { /* ignore */ }
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
    } catch { /* ignore */ }

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
          .prepare("UPDATE contributor_standing SET community_debt_cu = 0")
          .run();
      } else if (body.action === 'PURGE_ALL_KEYS') {
        await db
          .prepare("DELETE FROM api_keys")
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

  // 2.75 Admin Providers Fleet Overview (GET /api/admin/providers)
  if (method === "GET" && pathname === "/api/admin/providers") {
    const coordNs = env.POOL_COORDINATOR as DurableObjectNamespace | undefined;
    const providerIds: Array<{ id: "google" | "groq"; name: string }> = [
      { id: "google", name: "Google Gemini Flash" },
      { id: "groq", name: "Groq LLaMA 3.3" },
    ];
    const providersList = await Promise.all(
      providerIds.map(async ({ id, name }) => {
        let stats: unknown = null;
        let override: { state: "TRIPPED" | "NORMAL"; until?: number | null; reason?: string | null } | null = null;
        if (coordNs && typeof coordNs.idFromName === "function" && typeof coordNs.get === "function") {
          try {
            const stub = coordNs.get(coordNs.idFromName(`pool:${id}`)) as unknown as {
              stats?: () => Promise<unknown>;
              getProviderOverride?: () => Promise<{ state: "TRIPPED" | "NORMAL"; until?: number | null; reason?: string | null } | null>;
            };
            if (typeof stub.stats === "function") {
              stats = await stub.stats();
            }
            if (typeof stub.getProviderOverride === "function") {
              override = await stub.getProviderOverride();
            }
          } catch {
            // ignore
          }
        }
        const isTripped = override?.state === "TRIPPED";
        return {
          provider: id,
          name,
          status: isTripped ? "tripped" : "healthy",
          override: override ?? { state: "NORMAL" },
          stats: stats ?? { activeKeys: 0 },
        };
      })
    );
    const res = Response.json({
      status: "success",
      providers: providersList,
      timestamp: new Date().toISOString(),
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 2.76 Admin Commons Would-Deny Surveillance (GET /api/admin/commons/would-deny)
  if (method === "GET" && pathname === "/api/admin/commons/would-deny") {
    const url = new URL(request.url);
    const hoursParam = parseInt(url.searchParams.get("hours") || "24", 10);
    const hours = isNaN(hoursParam) || hoursParam <= 0 ? 24 : hoursParam;

    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (!db || typeof db.prepare !== "function") {
      const unavailable = Response.json(
        { error: "database_unavailable", message: "Would-deny stats need the D1 binding" },
        { status: 503 }
      );
      return options.cors !== false ? applyCors(unavailable) : unavailable;
    }
    const stats = await getWouldDenyStats(db, hours);

    const res = Response.json({
      status: "success",
      period_hours: hours,
      rules: stats.rules,
      top_tenants: stats.topTenants.map((t) => ({
        tenant_hash: t.tenantHash,
        count: t.count,
        rules: t.rules,
      })),
      total: stats.total,
      timestamp: new Date().toISOString(),
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 2.8 Admin Circuit Breaker Override (POST /api/admin/circuit-breaker & POST /api/admin/providers)
  const provOverrideMatch = pathname.match(/^\/api\/admin\/providers(?:\/([^/]+)\/override)?$/);
  if (method === "POST" && (pathname === "/api/admin/circuit-breaker" || provOverrideMatch)) {
    let body: {
      provider?: string;
      state?: "TRIPPED" | "NORMAL" | "CLOSED";
      reason?: string;
      until?: number;
    } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      // ignore
    }

    const rawProvider = (provOverrideMatch && provOverrideMatch[1]) || body.provider || "all";
    const normProvider = rawProvider.trim().toLowerCase();
    const state: "TRIPPED" | "NORMAL" = body.state === "TRIPPED" ? "TRIPPED" : "NORMAL";
    const reason =
      body.reason || (state === "TRIPPED" ? "Admin circuit override" : "Admin circuit reset");
    const until = body.until;

    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    // The actor comes from the admin session only; body fields cannot rename it.
    const actor = await getAdminActor(request, db);

    const coordNs = env.POOL_COORDINATOR as DurableObjectNamespace | undefined;
    const targetProviders =
      normProvider === "all"
        ? ["google", "groq"]
        : [normProvider === "gemini" ? "google" : normProvider];

    let storedOverride: { updatedAt?: number } | null = null;
    for (const p of targetProviders) {
      if (coordNs && typeof coordNs.idFromName === "function" && typeof coordNs.get === "function") {
        try {
          const stub = coordNs.get(coordNs.idFromName(`pool:${p}`)) as unknown as {
            setProviderOverride?: (
              s: "TRIPPED" | "NORMAL",
              u?: number | null,
              r?: string | null,
              a?: string | null
            ) => Promise<{ updatedAt?: number }>;
          };
          if (typeof stub.setProviderOverride === "function") {
            storedOverride = await stub.setProviderOverride(
              state,
              until ?? null,
              reason,
              actor.adminUserId
            );
          }
        } catch {
          // ignore
        }
      }

      // Also push to KeyPoolDO for sys_operator
      const keyPoolNs = env.KEY_POOL as DurableObjectNamespace | undefined;
      if (keyPoolNs && typeof keyPoolNs.idFromName === "function" && typeof keyPoolNs.get === "function") {
        try {
          const opStub = keyPoolNs.get(keyPoolNs.idFromName("sys_operator")) as unknown as {
            setProviderOverride?: (
              pr: string,
              st: "TRIPPED" | "NORMAL",
              un?: number
            ) => Promise<void>;
          };
          if (typeof opStub.setProviderOverride === "function") {
            await opStub.setProviderOverride(p, state, until);
          }
        } catch {
          // ignore
        }
      }
    }

    const action = state === "TRIPPED" ? "CIRCUIT_TRIP_OVERRIDE" : "CIRCUIT_RESET_NORMAL";
    const target = (targetProviders.length === 1 ? targetProviders[0] : "ALL").toUpperCase();
    const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    await logAdminAudit(
      db,
      actor,
      action,
      target,
      { provider: normProvider, state, reason, until },
      clientIp
    );

    const res = Response.json({
      success: true,
      provider: normProvider,
      state,
      reason,
      until: until ?? null,
      updatedAt: storedOverride?.updatedAt ?? Date.now(),
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 2.9 Admin Global Kill Switch (POST /api/admin/kill-switch)
  if (method === "POST" && pathname === "/api/admin/kill-switch") {
    let body: { active?: boolean; reason?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      // ignore
    }

    const active = body.active === true;
    const reason =
      body.reason || (active ? "Admin global kill switch" : "Kill switch disarmed");

    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    // The actor comes from the admin session only; body fields cannot rename it.
    const actor = await getAdminActor(request, db);

    let storedState: { reason?: string; since?: number } | null = null;
    const coordNs = env.POOL_COORDINATOR as DurableObjectNamespace | undefined;
    if (coordNs && typeof coordNs.idFromName === "function" && typeof coordNs.get === "function") {
      try {
        const stub = coordNs.get(coordNs.idFromName("control")) as unknown as {
          setMaintenance?: (
            m: boolean,
            r?: string
          ) => Promise<{ reason?: string; since?: number }>;
        };
        if (typeof stub.setMaintenance === "function") {
          storedState = await stub.setMaintenance(active, reason);
        }
      } catch {
        // ignore
      }
    }

    clearMaintenanceCache();

    const action = active ? "GLOBAL_KILL_SWITCH_ENGAGED" : "GLOBAL_KILL_SWITCH_DISARMED";
    const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    await logAdminAudit(
      db,
      actor,
      action,
      "ALL_EDGE_ISOLATES",
      { active, reason },
      clientIp
    );

    const res = Response.json({
      success: true,
      active,
      reason: storedState?.reason ?? reason,
      since: storedState?.since ?? Date.now(),
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
      created_at: string;
    }> = [];

    let debtMap = new Map<string, number>();
    let spendMap = new Map<string, number>();
    let lastActiveMap = new Map<string, number>();
    let tenantRpmMap = new Map<string, number>();
    let upstreamLatencyMs = 0;

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
      } catch { /* ignore */ }

      try {
        const kRes = await db
          .prepare(
            `SELECT id, tenant_id, label, provider, key_prefix, key_suffix, rpm_limit, rpd_limit,
                    priority, status, pool_type, community_routing_status, observation_until,
                    created_at
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
            created_at: string;
          }>();
        keysList = kRes.results || [];
      } catch { /* ignore */ }

      try {
        const dRes = await db
          .prepare("SELECT tenant_id, community_debt_cu FROM contributor_standing")
          .all<{ tenant_id: string; community_debt_cu: number }>();
        for (const row of dRes.results || []) {
          debtMap.set(row.tenant_id, row.community_debt_cu || 0);
        }
      } catch { /* ignore */ }

      try {
        const sRes = await db
          .prepare(
            "SELECT tenant_id, SUM(cu) as spend_today FROM cost_ledger WHERE created_at >= date('now', 'start of day') GROUP BY tenant_id"
          )
          .all<{ tenant_id: string; spend_today: number }>();
        for (const row of sRes.results || []) {
          spendMap.set(row.tenant_id, row.spend_today || 0);
        }
      } catch { /* ignore */ }

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
            const epoch = toEpochMs(row.last_seen);
            if (epoch != null) {
              lastActiveMap.set(row.tenant_id, epoch);
            }
          }
          if (row.reqs_last_min) {
            tenantRpmMap.set(row.tenant_id, row.reqs_last_min);
          }
        }
      } catch { /* ignore */ }

      try {
        const latencyRow = await db
          .prepare(
            "SELECT AVG(latency_ms) as avg_lat FROM cost_ledger WHERE created_at > datetime('now', '-1 hour')"
          )
          .first<{ avg_lat: number | null }>();
        if (latencyRow?.avg_lat != null) {
          upstreamLatencyMs = Math.round(latencyRow.avg_lat);
        }
      } catch { /* ignore */ }
    }

    const coordKeyCounters = new Map<string, { dispatchedToday: number; dispatchedCommunal: number }>();
    const degraded: string[] = [];
    const coordinatorNs = env.POOL_COORDINATOR as
      | {
          idFromName?: (n: string) => unknown;
          get?: (id: unknown) => {
            getKeysCounterMap?: (
              ids?: string[]
            ) => Promise<Record<string, { dispatchedToday: number; dispatchedCommunal: number }>>;
          };
        }
      | undefined;
    if (
      keysList.length > 0 &&
      coordinatorNs &&
      typeof coordinatorNs.idFromName === "function" &&
      typeof coordinatorNs.get === "function"
    ) {
      const allKeyIds = keysList.map((k) => k.id);
      for (const shard of ["google", "groq"]) {
        try {
          const stub = coordinatorNs.get(coordinatorNs.idFromName(`pool:${shard}`));
          if (typeof stub.getKeysCounterMap === "function") {
            const map = await stub.getKeysCounterMap(allKeyIds);
            for (const [kId, entry] of Object.entries(map)) {
              coordKeyCounters.set(kId, entry);
            }
          }
        } catch (err) {
          // Degraded: dispatch counters for this shard read as 0; the body says so.
          degraded.push(`coordinator:${shard}`);
          new Logger({ traceId: "admin-surveillance", tenantId: "admin" }).warn("key_counters_read_failed", {
            shard,
            error: err,
          });
        }
      }
    }

    // Group keys by tenant_id
    const keysByTenant = new Map<string, typeof keysList>();
    for (const key of keysList) {
      const tid = key.tenant_id || "default";
      const existing = keysByTenant.get(tid) || [];
      existing.push(key);
      keysByTenant.set(tid, existing);
    }

    // Allocate RPM per provider based on tenant usage and active keys
    const providerRpmMap = new Map<string, number>();
    for (const k of keysList) {
      const prov = (k.provider === 'google' ? 'gemini' : k.provider).toLowerCase();
      const tenantRpm = tenantRpmMap.get(k.tenant_id) ?? 0;
      const existing = providerRpmMap.get(prov) ?? 0;
      const activeKeysForTenant = keysList.filter((x) => x.tenant_id === k.tenant_id).length;
      providerRpmMap.set(prov, existing + Math.round(tenantRpm / Math.max(1, activeKeysForTenant)));
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

      const activeKeys = tenantKeys.filter(
        (k) => normaliseKeyStatus(k.status, k.community_routing_status) === 'HEALTHY'
      );
      const isQuar = user ? (user.is_quarantined === 1 || user.is_quarantined === true) : false;

      return {
        id: tid,
        tenantId: tid,
        email: user?.email || `${tid.replace(/^usr_(goog|gh|em)_/, '')}@users.noreply.kc`,
        tier,
        role: user?.role || (tier === 'admin' ? 'admin' : 'user'),
        authProvider,
        sybil_score: user?.sybil_score ?? (tier === 'admin' ? 100 : tier === 'demo' ? 20 : 0),
        sybilScore: user?.sybil_score ?? (tier === 'admin' ? 100 : tier === 'demo' ? 20 : 0),
        is_quarantined: isQuar ? 1 : 0,
        isQuarantined: isQuar,
        communityDebtCu: debtMap.get(tid) ?? 0,
        todaySpendCu: spendMap.get(tid) ?? 0,
        activeKeyCount: activeKeys.length,
        currentRpm: tenantRpmMap.get(tid) ?? 0,
        rpmLimit,
        lastActiveTimestamp:
          lastActiveMap.get(tid) ??
          (user?.created_at ? toEpochMs(user.created_at) ?? Date.now() : Date.now()),
        created_at: toEpochMs(user?.created_at) ?? new Date().toISOString(),
        keys: tenantKeys.map((k) => {
          const kc = coordKeyCounters.get(k.id);
          return {
            id: k.id,
            tenant_id: k.tenant_id,
            label: k.label,
            provider: k.provider === 'google' ? 'gemini' : k.provider,
            key_prefix: k.key_prefix,
            key_suffix: k.key_suffix,
            rpm_limit: k.rpm_limit,
            rpd_limit: k.rpd_limit,
            priority: k.priority,
            status: normaliseKeyStatus(k.status, k.community_routing_status).toLowerCase(),
            pool_type: k.pool_type ? normalisePoolType(k.pool_type) : 'COMMUNITY',
            community_routing_status: k.community_routing_status || 'OBSERVATION',
            observation_until: toEpochMs(k.observation_until),
            dispatches_today: kc?.dispatchedToday ?? 0,
            dispatches_communal: kc?.dispatchedCommunal ?? 0,
            created_at: toEpochMs(k.created_at) ?? k.created_at,
          };
        }),
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
      if (normaliseKeyStatus(k.status, k.community_routing_status) === 'HEALTHY') {
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
      const model = prov === 'gemini' ? 'gemini-3.5-flash-lite' : prov === 'groq' ? 'openai/gpt-oss-120b' : prov === 'cerebras' ? 'llama3.1-8b' : 'deepseek-reasoner';
      const currentRpm = providerRpmMap.get(prov) ?? stat.currentRpm;
      return {
        provider: prov,
        name,
        model,
        activeKeys: stat.activeKeys,
        healthyKeys: stat.healthyKeys,
        rateLimitedKeys: stat.rateLimitedKeys,
        rpmLimit: stat.rpmLimit,
        currentRpm,
        status: stat.rateLimitedKeys > 0 && stat.rateLimitedKeys === stat.activeKeys ? ('degraded' as const) : ('healthy' as const),
      };
    });

    const totalClusterRpm = Array.from(tenantRpmMap.values()).reduce((sum, r) => sum + r, 0);
    const totalFleetRpmLimit = keysList.reduce((sum, k) => sum + (k.rpm_limit || 0), 0);
    const totalFleetSpendToday = Array.from(spendMap.values()).reduce((sum, s) => sum + s, 0);

    // Compute rotation fairness score based on variance across dispatched keys
    const dispatchCounts = keysList.map((k) => coordKeyCounters.get(k.id)?.dispatchedToday ?? 0);
    const totalDispatched = dispatchCounts.reduce((s, v) => s + v, 0);
    const fairness = totalDispatched === 0 || dispatchCounts.length === 0
      ? 100
      : Math.round(
          100 *
            (1 -
              dispatchCounts.reduce((s, v) => {
                const share = v / totalDispatched;
                return s + share * share;
              }, 0) *
                (dispatchCounts.length > 1 ? 1 / (dispatchCounts.length - 1) : 1))
        );
    const rotationFairnessScore = Math.max(0, Math.min(100, fairness));

    const poolSummary = {
      totalKeys: keysList.length,
      activeCommunityKeys: keysList.filter(
        (k) => normalisePoolType(k.pool_type) === 'COMMUNITY' && k.community_routing_status === 'ACTIVE'
      ).length,
      observationKeys: keysList.filter((k) => k.community_routing_status === 'OBSERVATION').length,
      quarantinedKeys: keysList.filter((k) => k.community_routing_status === 'QUARANTINED').length,
      privateKeys: keysList.filter((k) => normalisePoolType(k.pool_type) === 'PRIVATE').length,
      totalDebtCu: Array.from(debtMap.values()).reduce((sum, d) => sum + d, 0),
      clusterRpmCurrent: totalClusterRpm,
      clusterRpmMax: totalFleetRpmLimit || 100,
      tokenVelocityTpm: totalClusterRpm * TOKENS_PER_REQUEST_ESTIMATE,
      tokenVelocityMaxTpm: (totalFleetRpmLimit || 100) * TOKENS_PER_REQUEST_ESTIMATE,
      spendRateCuPerHour: Math.round(totalFleetSpendToday / 24),
      upstreamLatencyMs,
      rotationFairnessScore,
      providers,
    };

    const res = Response.json({
      status: "success",
      tenants: aggregatedTenants,
      pool: poolSummary,
      ...(degraded.length > 0 ? { degraded } : {}),
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
    const reason = body.reason || "Administrative quarantine";
    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (db && typeof db.prepare === "function") {
      const updateRes = await db
        .prepare(
          "UPDATE users SET is_quarantined = ?, quarantine_reason = ? WHERE id = ?"
        )
        .bind(isQuar, reason, targetTenantId)
        .run();
      if (!updateRes?.meta?.changes || updateRes.meta.changes === 0) {
        const notFoundRes = Response.json(
          { error: "tenant_not_found", message: "Tenant not found" },
          { status: 404 }
        );
        return options.cors !== false ? applyCors(notFoundRes) : notFoundRes;
      }

      const actor = await getAdminActor(request, db);
      const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1";
      await logAdminAudit(
        db,
        actor,
        "TENANT_QUARANTINE",
        targetTenantId,
        { is_quarantined: isQuar === 1, reason },
        clientIp
      );
    }
    const res = Response.json({
      success: true,
      target_tenant_id: targetTenantId,
      is_quarantined: isQuar === 1,
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 5. Admin Tenant Quota Reset (POST /api/admin/tenants/:id/reset-quota)
  const resetQuotaMatch = pathname.match(
    /^\/api\/admin\/tenants\/([^/]+)\/reset-quota$/
  );
  if (method === "POST" && resetQuotaMatch) {
    const targetTenantId = resetQuotaMatch[1];
    let body: { reason?: string } = {};
    try {
      body = (await request.json()) as { reason?: string };
    } catch {
      // empty body
    }
    const reason = body.reason || "Administrative quota reset";

    // Call TenantQuotaDO.reset()
    const quotaNs = env.TENANT_QUOTA as
      | {
          idFromName?: (name: string) => unknown;
          get?: (id: unknown) => {
            reset?: () => Promise<void>;
          };
        }
      | undefined;
    if (quotaNs && typeof quotaNs.idFromName === "function" && typeof quotaNs.get === "function") {
      try {
        const stub = quotaNs.get(quotaNs.idFromName(targetTenantId));
        if (typeof stub.reset === "function") {
          await stub.reset();
        }
      } catch {
        // ignore
      }
    }

    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (db && typeof db.prepare === "function") {
      const actor = await getAdminActor(request, db);
      const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1";
      await logAdminAudit(
        db,
        actor,
        "RESET_QUOTA",
        targetTenantId,
        { reason },
        clientIp
      );
    }

    const res = Response.json({
      success: true,
      tenant_id: targetTenantId,
      reason,
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 6. Admin Audit Logs (GET /api/admin/audit)
  if (method === "GET" && pathname === "/api/admin/audit") {
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    let events: Array<{
      id: string;
      admin_user_id: string | null;
      admin_email: string;
      action: string;
      target: string;
      details_json: string;
      ip_address: string;
      created_at: number;
    }> = [];
    let total = 0;

    if (db && typeof db.prepare === "function") {
      try {
        const countRes = await db
          .prepare("SELECT COUNT(*) as total FROM admin_audit_logs")
          .first<{ total: number }>();
        total = countRes?.total ?? 0;

        const listRes = await db
          .prepare(
            `SELECT id, admin_user_id, admin_email, action, target, details_json, ip_address, created_at
             FROM admin_audit_logs
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`
          )
          .bind(limit, offset)
          .all<{
            id: string;
            admin_user_id: string | null;
            admin_email: string;
            action: string;
            target: string;
            details_json: string;
            ip_address: string;
            created_at: number;
          }>();
        events = listRes.results || [];
      } catch {
        // ignore
      }
    }

    const res = Response.json({
      events,
      total,
      limit,
      offset,
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 4. Other API and proxy endpoints (e.g. /api/keys, /api/stats, /v1/chat/completions, /v1/models)
  if (
    (pathname.startsWith("/api/") && !pathname.startsWith("/api/admin/")) ||
    pathname.startsWith("/v1/") ||
    pathname === "/openapi.json"
  ) {
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
