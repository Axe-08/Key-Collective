/**
 * Key Collective v2/v4 — Developer Dashboard & Console REST API Handler
 */

import type { KeyPoolContract } from "../../../contracts/key_pool";
import type { AuthMiddleware, WorkerEnv } from "../../auth/index";
import type { WorkerEnv as AppWorkerEnv } from "../../auth/types";
import type { ExecutionContextLike } from "../../telemetry_emitter";
import type { RouterHandlerOptions } from "../types";
import { handleReportKeyAbuse } from "./abuse_routes";
import { handleOAuthGithubCallback, handleSyncSession } from "./auth_routes";
import {
  handleDeleteKey,
  handleGetKeys,
  handlePoolMode,
  handlePostKeys,
  handleRotateKeySecret,
  handleTestKey,
} from "./keys/index";
import {
  handleDeleteProject,
  handleGetProjects,
  handlePostProjects,
  handleUpdateProject,
} from "./project_routes";
import {
  handleDeleteToken,
  handleGetTokens,
  handlePostTokens,
} from "./token_routes";
import { handleGetLogs, handleGetStats } from "./metrics_routes";
import { handlePoolRoute } from "../../pool_routes";
import { handleAdminRequest } from "../../gateway/admin_handler";

export class DashboardRouter {
  constructor(
    private readonly options: RouterHandlerOptions,
    private readonly authMiddleware: AuthMiddleware,
    private readonly getKeyPool: (tenantId: string, env: WorkerEnv) => KeyPoolContract
  ) {}

  public async handle(
    request: Request,
    pathname: string,
    method: string,
    env: WorkerEnv,
    _ctx?: ExecutionContextLike,
    _traceId?: string
  ): Promise<Response> {
    const masterKey =
      this.options.masterKey ??
      (env.KC_MASTER_KEY ? String(env.KC_MASTER_KEY) : undefined);

    let tenantId = "anonymous";
    const headerTenant = request.headers.get("x-tenant-id");

    // 0. OAuth GitHub Callback
    if (method === "GET" && pathname === "/api/auth/github/callback") {
      return handleOAuthGithubCallback(request, env);
    }

    // 0.1 User Session Sync to D1
    if (method === "POST" && pathname === "/api/auth/sync-session") {
      return handleSyncSession(request, env);
    }

    // Auth token extraction
    let rawToken: string | undefined;
    const authHeader =
      request.headers.get("authorization") ||
      request.headers.get("Authorization");

    if (authHeader && authHeader.startsWith("Bearer ")) {
      rawToken = authHeader.substring(7).trim();
    }

    if (!rawToken) {
      try {
        const u = new URL(request.url);
        const queryToken = u.searchParams.get("token") || u.searchParams.get("admin_token");
        if (queryToken && queryToken.trim().length > 0) {
          rawToken = queryToken.trim();
        }
      } catch {}
    }

    if (!rawToken) {
      const cookieHeader = request.headers.get("cookie") || request.headers.get("Cookie");
      if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)kc_auth_token=([^;]+)/);
        if (match && match[1]) {
          rawToken = decodeURIComponent(match[1].trim());
        }
      }
    }

    if (rawToken && masterKey && rawToken === masterKey) {
      tenantId = (headerTenant && headerTenant.trim().length > 0) ? headerTenant.trim() : "admin";
    } else if (rawToken) {
      try {
        const authReq = new Request(request.url, {
          headers: new Headers({
            ...Object.fromEntries(request.headers.entries()),
            authorization: `Bearer ${rawToken}`,
          }),
        });
        const authContext = await this.authMiddleware.authenticate(authReq, env);
        tenantId = authContext.tenantId || "anonymous";
        if ((tenantId === "default" || tenantId === "anonymous") && headerTenant && headerTenant.trim().length > 0) {
          tenantId = headerTenant.trim();
        }
      } catch {
        if (method !== "GET") {
          return new Response(
            JSON.stringify({
              error: {
                message: "Invalid authorization token",
                code: "UNAUTHORIZED",
                statusCode: 401,
              },
            }),
            {
              status: 401,
              headers: { "content-type": "application/json; charset=utf-8" },
            }
          );
        }
      }
    }

    // 0.5 Admin Surveillance APIs (/api/admin/*) on console/dashboard
    if (pathname.startsWith("/api/admin/")) {
      let isAdmin = tenantId === "admin" || (!!rawToken && !!masterKey && rawToken === masterKey);
      if (!isAdmin && env.DB && typeof env.DB.prepare === "function" && tenantId && tenantId !== "anonymous") {
        try {
          const userRow = await env.DB.prepare("SELECT tier, role FROM users WHERE id = ?").bind(tenantId).first<{ tier?: string; role?: string }>();
          if (userRow && (userRow.tier === "admin" || userRow.role === "admin")) {
            isAdmin = true;
          }
        } catch {}
      }
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: { message: "Admin access required", code: "FORBIDDEN", statusCode: 403 } }), {
          status: 403,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      return handleAdminRequest(request, env, this as any, this.options, _ctx);
    }

    // 1. GET /api/keys
    if (method === "GET" && pathname === "/api/keys") {
      return handleGetKeys(env, tenantId);
    }

    // 2. POST /api/keys
    if (method === "POST" && pathname === "/api/keys") {
      return handlePostKeys(request, env, tenantId, headerTenant, masterKey);
    }

    // 3. DELETE /api/keys/:id
    if (method === "DELETE" && pathname.startsWith("/api/keys/")) {
      return handleDeleteKey(pathname, env, tenantId, headerTenant);
    }

    // PATCH /api/keys/:id/pool-mode (Anti-Midnight Freeze FR-22)
    if (method === "PATCH" && /^\/api\/keys\/[^/]+\/pool-mode$/.test(pathname)) {
      return handlePoolMode(pathname, request, env, tenantId);
    }

    // 3.8 POST /api/keys/:id/rotate
    if (method === "POST" && pathname.startsWith("/api/keys/") && pathname.endsWith("/rotate")) {
      return handleRotateKeySecret(pathname, request, env, tenantId, headerTenant, masterKey);
    }

    // 4. POST /api/keys/:id/test
    if (method === "POST" && pathname.startsWith("/api/keys/") && pathname.endsWith("/test")) {
      return handleTestKey(pathname, env, tenantId, headerTenant, masterKey);
    }

    // 4.1 Projects APIs
    if (method === "GET" && (pathname === "/api/projects" || pathname === "/api/projects/")) {
      return handleGetProjects(request, env as unknown as AppWorkerEnv, tenantId);
    }

    if (method === "POST" && (pathname === "/api/projects" || pathname === "/api/projects/")) {
      return handlePostProjects(request, env as unknown as AppWorkerEnv, tenantId);
    }

    if (method === "DELETE" && (pathname === "/api/projects" || pathname.startsWith("/api/projects/"))) {
      return handleDeleteProject(pathname, env as unknown as AppWorkerEnv, tenantId);
    }

    if (method === "PATCH" && (pathname === "/api/projects" || pathname.startsWith("/api/projects/"))) {
      return handleUpdateProject(request, pathname, env as unknown as AppWorkerEnv, tenantId);
    }

    // 4.2 Auth Tokens APIs
    if (method === "GET" && (pathname === "/api/tokens" || pathname === "/api/tokens/")) {
      return handleGetTokens(request, env as unknown as AppWorkerEnv, tenantId);
    }

    if (method === "POST" && (pathname === "/api/tokens" || pathname === "/api/tokens/")) {
      return handlePostTokens(request, env as unknown as AppWorkerEnv, tenantId);
    }

    if (method === "DELETE" && (pathname === "/api/tokens" || pathname.startsWith("/api/tokens/"))) {
      return handleDeleteToken(pathname, env as unknown as AppWorkerEnv, tenantId);
    }

    // 4.5 POST /api/abuse/report-key
    if (method === "POST" && pathname === "/api/abuse/report-key") {
      return handleReportKeyAbuse(request, env);
    }

    // 5. GET /api/logs
    if (method === "GET" && pathname === "/api/logs") {
      return handleGetLogs(env, tenantId, headerTenant, this.getKeyPool);
    }

    // 6. GET /api/stats
    if (method === "GET" && pathname === "/api/stats") {
      return handleGetStats(env, tenantId, headerTenant, this.getKeyPool);
    }

    // 7. Pool Commons & Notifications Routes (/api/pool/*, /api/notifications)
    const poolRes = await handlePoolRoute(pathname, method, request, env, tenantId, _ctx as any);
    if (poolRes) {
      return poolRes;
    }

    return new Response(
      JSON.stringify({
        error: {
          message: `Dashboard API endpoint '${method} ${pathname}' not found`,
          code: "NOT_FOUND",
          statusCode: 404,
        },
      }),
      { status: 404, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}

export { DashboardRouter as DashboardHandler };
