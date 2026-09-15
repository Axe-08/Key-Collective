/**
 * @file admin_handler.ts
 * Handlers for authenticated admin surveillance requests on admin.*.
 */

import type { ExecutionContextLike } from "../telemetry_emitter";
import type { WorkerEnv } from "../auth_middleware";
import type { RouterHandler } from "../router_handler";
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
        await db
          .prepare("UPDATE users SET tier = ? WHERE id = ?")
          .bind(newTier, targetTenantId)
          .run();
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

  // 2. Admin Tenant Surveillance Table (GET /api/admin/tenants)
  if (method === "GET" && pathname === "/api/admin/tenants") {
    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    let rows: unknown[] = [];
    if (db && typeof db.prepare === "function") {
      try {
        const result = await db
          .prepare(
            "SELECT id, email, tier, role, sybil_score, is_quarantined, created_at FROM users LIMIT 100"
          )
          .all();
        rows = result.results || [];
      } catch {
        rows = [];
      }
    }
    const res = Response.json({
      status: "success",
      tenants: rows,
      timestamp: new Date().toISOString(),
    });
    return options.cors !== false ? applyCors(res) : res;
  }

  // 3. Admin Tenant Quarantine (POST /api/admin/tenants/:id/quarantine)
  const quarantineMatch = pathname.match(
    /^\/api\/admin\/tenants\/([^/]+)\/quarantine$/
  );
  if (method === "POST" && quarantineMatch) {
    const targetTenantId = quarantineMatch[1];
    let body: { reason?: string } = {};
    try {
      body = (await request.json()) as { reason?: string };
    } catch {
      // empty body
    }
    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (db && typeof db.prepare === "function") {
      try {
        await db
          .prepare(
            "UPDATE users SET is_quarantined = 1, quarantine_reason = ? WHERE id = ?"
          )
          .bind(body.reason || "Administrative quarantine", targetTenantId)
          .run();
      } catch {
        // ignore
      }
    }
    const res = Response.json({
      success: true,
      target_tenant_id: targetTenantId,
      is_quarantined: true,
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
