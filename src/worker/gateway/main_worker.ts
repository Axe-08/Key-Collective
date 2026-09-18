/**
 * @file main_worker.ts
 * MainWorker: Primary API Gateway & Subdomain Router class for Key Collective Cloudflare Worker.
 */

import {
  AuthMiddleware,
  WorkerEnv,
} from "../auth/index";
import {
  formatRouterError,
  RouterHandler,
} from "../router/index";
import type { ExecutionContextLike } from "../telemetry_emitter";
import type { HealthResponse, WorkerOptions } from "./types";
import { applyCors, resolveHostRoute } from "./subdomain";
import { CORS_HEADERS } from "./types";
import { verifyAdminRequest } from "./admin_verifier";
import { handleConsoleRequest } from "./console_handler";
import { handleAdminRequest } from "./admin_handler";

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
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    // 1. CORS Preflight Request Handling (universal across all subdomains)
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // 2. Resolve Subdomain Route based on Host header
    const hostHeader = request.headers.get("host") || url.host || "";
    const route = resolveHostRoute(hostHeader);

    // 3. Admin Surveillance Subdomain Routing (admin.*)
    if (route.subdomain === "admin") {
      const isAdmin = await this.verifyAdmin(request, env);
      if (!isAdmin) {
        // Zero-Knowledge Denial: Absolute 404 Not Found
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

    // 4. Developer Console SPA Static Delivery & API Handling (console.*)
    if (route.subdomain === "console") {
      if (
        pathname.startsWith("/api/") ||
        pathname.startsWith("/v1/") ||
        pathname === "/openapi.json"
      ) {
        try {
          const res = await this.routerHandler.handle(request, env, ctx);
          return this.options.cors !== false ? applyCors(res) : res;
        } catch (err: unknown) {
          const errorRes = formatRouterError(err);
          return this.options.cors !== false ? applyCors(errorRes) : errorRes;
        }
      }
      return this.handleConsole(request, env);
    }

    // 5. Apex Redirect (key-col.axe08.tech -> console.key-col.axe08.tech)
    const normalizedHost = hostHeader.split(":")[0].toLowerCase().trim();
    if (normalizedHost === "key-col.axe08.tech" && (pathname === "/" || pathname === "")) {
      return Response.redirect("https://console.key-col.axe08.tech/", 302);
    }

    // 6. Health & Liveness Probes (Public, zero auth required on api.* and apex)
    if (
      method === "GET" &&
      (pathname === "/health" || pathname === "/v1/health")
    ) {
      const payload: HealthResponse = {
        status: "healthy",
        version: "0.2.0",
        runtime: "cloudflare-workers",
        timestamp: new Date().toISOString(),
      };
      const res = Response.json(payload, { status: 200 });
      return this.options.cors !== false ? applyCors(res) : res;
    }

    // 7. Static Assets & Dashboard SPA Serving on apex (when ASSETS binding is present)
    if (route.subdomain === "apex" && env.ASSETS && method === "GET") {
      if (
        pathname.startsWith("/assets/") ||
        pathname === "/favicon.ico" ||
        pathname === "/favicon.svg"
      ) {
        return env.ASSETS.fetch(request);
      }
      if (pathname === "/dashboard") {
        const indexUrl = new URL("/", request.url);
        return env.ASSETS.fetch(new Request(indexUrl.toString(), request));
      }
      if (
        (pathname === "/" || pathname === "") &&
        request.headers.get("accept")?.includes("text/html")
      ) {
        return env.ASSETS.fetch(request);
      }
    }

    // 8. Root Endpoint Status Probe (Public, backward compatible with smoke tests)
    if (method === "GET" && (pathname === "/" || pathname === "")) {
      const res = new Response("Key Collective v2 Edge Proxy Ready", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
      return this.options.cors !== false ? applyCors(res) : res;
    }

    // 9. Delegate to RouterHandler for OpenAI-compatible routing and DO forwarding (Hot Path)
    try {
      const res = await this.routerHandler.handle(request, env, ctx);
      return this.options.cors !== false ? applyCors(res) : res;
    } catch (err: unknown) {
      const errorRes = formatRouterError(err);
      return this.options.cors !== false ? applyCors(errorRes) : errorRes;
    }
  }
}
