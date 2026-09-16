/**
 * Key Collective v2/v4 — Developer Dashboard & Console REST API Handler
 */

import type { KeyPoolContract } from "../../../contracts/key_pool";
import type { AuthMiddleware, WorkerEnv } from "../../auth_middleware";
import type { ExecutionContextLike } from "../../telemetry_emitter";
import type { RouterHandlerOptions } from "../types";
import { handleReportKeyAbuse } from "./abuse_routes";
import { handleOAuthGithubCallback } from "./auth_routes";
import {
  handleDeleteKey,
  handleGetKeys,
  handlePoolMode,
  handlePostKeys,
  handleRotateKeySecret,
  handleTestKey,
} from "./key_routes";
import { handleGetLogs, handleGetStats } from "./metrics_routes";
import { handlePoolRoute } from "../../pool_routes";

export class DashboardHandler {
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

    let tenantId = "default";
    const headerTenant = request.headers.get("x-tenant-id");
    if (headerTenant && headerTenant.trim().length > 0) {
      tenantId = headerTenant.trim();
    }

    // 0. OAuth GitHub Callback
    if (method === "GET" && pathname === "/api/auth/github/callback") {
      return handleOAuthGithubCallback(request, env);
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
      tenantId = headerTenant || "admin";
    } else if (rawToken) {
      try {
        const authReq = new Request(request.url, {
          headers: new Headers({
            ...Object.fromEntries(request.headers.entries()),
            authorization: `Bearer ${rawToken}`,
          }),
        });
        const authContext = await this.authMiddleware.authenticate(authReq, env);
        tenantId = headerTenant || authContext.tenantId;
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
    if (method === 'PATCH' && /^\/api\/keys\/[^/]+\/pool-mode$/.test(pathname)) {
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
