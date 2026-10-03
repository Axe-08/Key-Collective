/**
 * @file main_worker.ts
 * MainWorker: Primary API Gateway & Subdomain Router class for Key Collective Cloudflare Worker.
 *
 * Implements WP-2.7 per-host routing:
 * - ApiHost: canonical v1 router, legacy aliases, OPTIONS with CORS
 * - ConsoleHost: SPA static delivery, /api/* dashboard API (no CORS), legacy routes
 * - AdminHost: public SPA shell and Google sign-in; every API path behind zero-knowledge denial (no CORS)
 * - ApexHost: redirects non-API paths to console (301 for GET/HEAD, 308 for others), legacy routes
 */

import { AuthMiddleware, WorkerEnv } from "../auth/index";
import { formatRouterError, RouterHandler } from "../router/index";
import type { ExecutionContextLike } from "../telemetry_emitter";
import type { WorkerOptions } from "./types";
import { applyCors, resolveHost } from "./subdomain";
import { CORS_HEADERS } from "./types";
import { verifyAdminRequest } from "./admin_verifier";
import { handleConsoleRequest } from "./console_handler";
import { handleAdminRequest } from "./admin_handler";
import { handleV1Route } from "../api/v1_router";
import { handleDemoTokenRequest } from "../router/demo_routes";
import { checkMaintenance } from "./control";

const RAW_DO_PATHS = new Set([
  "/v1/keys",
  "/v1/keys/usage",
  "/v1/metrics",
  "/v1/capacity",
]);

/**
 * MainWorker: Primary API Gateway & Subdomain Router class for Key Collective Cloudflare Worker.
 */
export class MainWorker {
  private readonly routerHandler: RouterHandler;
  private readonly authMiddleware: AuthMiddleware;
  private readonly options: WorkerOptions;

  constructor(options?: WorkerOptions) {
    this.options = options ?? {};
    this.authMiddleware =
      this.options.authMiddleware ?? new AuthMiddleware(this.options);
    this.routerHandler =
      this.options.routerHandler ??
      new RouterHandler({
        ...this.options,
        authMiddleware: this.authMiddleware,
      });
  }

  /**
   * Returns the underlying RouterHandler instance.
   */
  public getRouterHandler(): RouterHandler {
    return this.routerHandler;
  }

  /**
   * Returns the underlying AuthMiddleware instance.
   */
  public getAuthMiddleware(): AuthMiddleware {
    return this.authMiddleware;
  }

  /**
   * Verifies whether an incoming request to admin.* originates from an authorized administrator.
   * Enforces zero-knowledge denial: returns boolean without leaking details.
   */
  public async verifyAdmin(
    request: Request,
    env: WorkerEnv
  ): Promise<boolean> {
    return verifyAdminRequest(request, env, this.options);
  }

  /**
   * Handles authenticated admin surveillance requests on admin.*.
   */
  public async handleAdmin(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): Promise<Response> {
    return handleAdminRequest(request, env, this.routerHandler, this.options, ctx);
  }

  /**
   * Handles static asset delivery and SPA fallback on console.*.
   */
  public async handleConsole(
    request: Request,
    env: WorkerEnv
  ): Promise<Response> {
    return handleConsoleRequest(request, env, this.options);
  }

  /**
   * Handles ApiHost requests (api.*).
   */
  private async handleApiHost(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    // 1. CORS Preflight (only ApiHost returns CORS headers)
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // 1.5. Kill switch: check maintenance mode (T-4.6.2)
    const maintenance = await checkMaintenance(env);
    if (maintenance) {
      const resp = new Response(
        JSON.stringify({
          error: {
            code: "maintenance",
            message:
              maintenance.reason ??
              "Service temporarily unavailable due to maintenance",
          },
        }),
        {
          status: 503,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "retry-after": "60",
          },
        }
      );
      return this.options.cors !== false ? applyCors(resp) : resp;
    }

    // 2. Canonical route resolution via v1_router
    const v1Res = await handleV1Route({
      request,
      env,
      ctx,
      routerHandler: this.routerHandler,
      startTime: Date.now(),
    });
    if (v1Res) {
      return this.options.cors !== false ? applyCors(v1Res) : v1Res;
    }

    // 3. Default 404 for unrouted paths on api.*
    const notFoundRes = new Response(
      JSON.stringify({
        error: {
          message: `Route '${method} ${pathname}' not found`,
          code: "ROUTE_NOT_FOUND",
          statusCode: 404,
        },
      }),
      {
        status: 404,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      }
    );
    return this.options.cors !== false ? applyCors(notFoundRes) : notFoundRes;
  }

  /**
   * Handles ConsoleHost requests (console.*).
   */
  private async handleConsoleHost(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    // 1. OPTIONS on console.* returns 204 with NO CORS headers
    if (method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    // 2. Raw DO routes and /v1/* proxy routes return 404 on console.* (N-01, WP-7.1)
    if (RAW_DO_PATHS.has(pathname) || pathname === "/v1" || pathname.startsWith("/v1/")) {
      return new Response("Not Found", { status: 404 });
    }

    // 3. Ephemeral token endpoints on console.*
    if (
      // The playground token needs a session and is minted by the dashboard router (WP-3.10).
      pathname === "/api/demo/token" &&
      (method === "POST" || method === "GET")
    ) {
      return handleDemoTokenRequest(request, env);
    }

    // 4. Dashboard API endpoints (/api/*)
    if (pathname.startsWith("/api/")) {
      try {
        const traceId =
          request.headers.get("x-kc-trace-id") ?? crypto.randomUUID();
        return await this.routerHandler.handleDashboardApi(
          request,
          pathname,
          method,
          env,
          ctx,
          traceId
        );
      } catch (err: unknown) {
        return formatRouterError(err);
      }
    }

    // 5. SPA static assets delivery
    return this.handleConsole(request, env);
  }

  /**
   * Handles AdminHost requests (admin.*).
   */
  private async handleAdminHost(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): Promise<Response> {
    const method = request.method.toUpperCase();

    // 1. OPTIONS on admin.* returns 204 with NO CORS headers
    if (method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    // 2. Raw DO routes stay 404 everywhere (N-01)
    if (RAW_DO_PATHS.has(pathname) || pathname.startsWith("/v1/keys/")) {
      return new Response("Not Found", { status: 404 });
    }

    // 3. Sign-in on the admin host (QA-15): a browser must be able to obtain kc_admin_session
    // here before it holds one, so Google sign-in is served without the gate. The handler
    // only issues an admin session for ADMIN_EMAILS accounts.
    if (method === "POST" && pathname === "/api/auth/google") {
      try {
        const traceId = request.headers.get("x-kc-trace-id") ?? crypto.randomUUID();
        return await this.routerHandler.handleDashboardApi(
          request,
          pathname,
          method,
          env,
          ctx,
          traceId
        );
      } catch (err: unknown) {
        return formatRouterError(err);
      }
    }

    // 4. The SPA shell (navigation and static assets) is public, like on console.*: it holds
    // no admin data. Every API path below stays behind the gate.
    const isApiPath =
      pathname === "/api" ||
      pathname.startsWith("/api/") ||
      pathname === "/v1" ||
      pathname.startsWith("/v1/") ||
      pathname === "/openapi.json";
    if ((method === "GET" || method === "HEAD") && !isApiPath) {
      return handleConsoleRequest(request, env, { ...this.options, cors: false });
    }

    // 5. Admin zero-knowledge authentication check
    const isAdmin = await this.verifyAdmin(request, env);
    if (!isAdmin) {
      return new Response("Not Found", {
        status: 404,
        statusText: "Not Found",
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    return this.handleAdmin(request, env, ctx);
  }

  /**
   * Handles ApexHost requests (apex).
   */
  private async handleApexHost(
    request: Request,
    env: WorkerEnv,
    _ctx?: ExecutionContextLike
  ): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    // 1. OPTIONS on apex returns 204 with NO CORS headers
    if (method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    // 2. Raw DO routes stay 404 everywhere (N-01)
    if (RAW_DO_PATHS.has(pathname) || pathname.startsWith("/v1/keys/")) {
      return new Response("Not Found", { status: 404 });
    }

    // 3. Apex paths redirect to console (301 for GET/HEAD, 308 for others)
    const consoleHost =
      (env.CONSOLE_HOST as string | undefined) ?? "console.key-col.axe08.tech";
    const targetUrl = `https://${consoleHost}${url.pathname}${url.search}`;
    const redirectStatus = method === "GET" || method === "HEAD" ? 301 : 308;
    return Response.redirect(targetUrl, redirectStatus);
  }

  /**
   * Primary entrypoint: handles incoming HTTP request to the Cloudflare Worker.
   *
   * @param request Inbound HTTP Request
   * @param env Cloudflare Worker environment bindings
   * @param ctx ExecutionContext for background tasks and non-blocking telemetry
   */
  public async fetch(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): Promise<Response> {
    const url = new URL(request.url);
    const hostHeader = request.headers.get("host") || url.host || "";
    const host = resolveHost(hostHeader, env);

    switch (host) {
      case "api":
        return this.handleApiHost(request, env, ctx);
      case "console":
        return this.handleConsoleHost(request, env, ctx);
      case "admin":
        return this.handleAdminHost(request, env, ctx);
      case "apex":
        return this.handleApexHost(request, env, ctx);
      default:
        return new Response("Not Found", { status: 404 });
    }
  }
}
