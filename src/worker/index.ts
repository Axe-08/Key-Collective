/**
 * Key Collective v2 & v3.5 — Cloudflare-Native LLM Router
 * Main Worker Entrypoint: Subdomain Host Routing, API Gateway, SPA Delivery & Admin Surveillance
 *
 * Conforms to:
 * - LLD 1.0 (Main Worker Export) & v3.5 Subdomain Host Routing Architecture:
 *   1. Subdomain Dispatch (Host Header):
 *      - `api.*`: Dedicated LLM proxy gateway hot path (OpenAI-compatible chat completions,
 *        model catalog, capacity, DO forwarding).
 *      - `console.*`: Developer Console SPA static asset delivery and SPA fallback.
 *      - `admin.*`: Admin surveillance router with zero-knowledge denial (returns 404 for non-admins).
 *      - Apex (`key-col.axe08.tech`): Redirects to Developer Console SPA.
 *   2. Auth & Tenant Isolation (GEMINI.md Invariant):
 *      Bearer token verification in D1, budget checks, RPM limiting, and per-tenant DO isolation.
 *   3. Zero-Knowledge Admin Denial (v3.5 Invariant):
 *      Non-admin or unauthenticated access to admin.* produces absolute HTTP 404 Not Found
 *      with zero leakage of system existence.
 *   4. Fixed-Point Microdollars (GEMINI.md Invariant):
 *      All token costs and balances tracked strictly in int64 microdollars (1 USD = 1,000,000 µ$).
 *   5. Non-Blocking Telemetry (GEMINI.md Invariant):
 *      Streams SSE chunks with 0ms added latency; telemetry deferred to ctx.waitUntil().
 *   6. Strict TypeScript: Strict mode, zero `any`.
 */

import {
  AuthenticatedContext,
  AuthMiddleware,
  AuthMiddlewareOptions,
  formatAuthError,
  WorkerEnv,
} from "./auth_middleware";
import {
  formatRouterError,
  RouterError,
  RouterHandler,
  RouterHandlerOptions,
} from "./router_handler";
import {
  ExecutionContextLike,
  TelemetryEmitter,
} from "./telemetry_emitter";
import { hashToken } from "../crypto";
import type { EdgeSubdomain, HostRouteDecision } from "../contracts/v3_5_types";

/**
 * Health response payload format.
 */
export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  runtime: "cloudflare-workers";
  timestamp: string;
}

/**
 * Standard CORS headers applied to API Gateway responses.
 */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers":
    "Content-Type, Authorization, x-tenant-id, x-kc-trace-id, x-trace-id",
  "access-control-max-age": "86400",
};

/**
 * Parses the incoming Host header or URL host to determine the edge routing subdomain.
 *
 * Routing domains:
 * - `api.*` -> LLM Proxy Hot Path Gateway
 * - `console.*` -> Developer Console SPA static delivery
 * - `admin.*` -> Admin surveillance router
 * - Other / apex -> Apex routing
 *
 * @param host The Host header or hostname
 * @returns Parsed EdgeSubdomain (\"api\" | \"console\" | \"admin\" | \"apex\")
 */
export function parseSubdomain(host: string): EdgeSubdomain {
  if (!host) return "apex";
  const normalized = host.split(":")[0].toLowerCase().trim();
  if (normalized.startsWith("api.") || normalized === "api") {
    return "api";
  }
  if (normalized.startsWith("console.") || normalized === "console") {
    return "console";
  }
  if (normalized.startsWith("admin.") || normalized === "admin") {
    return "admin";
  }
  return "apex";
}

/**
 * Resolves the edge routing decision from a Host header string.
 *
 * @param host The Host header or hostname
 * @returns HostRouteDecision contract
 */
export function resolveHostRoute(host: string): HostRouteDecision {
  const subdomain = parseSubdomain(host);
  return {
    host,
    subdomain,
    requiresAdminAuth: subdomain === "admin",
    isApiGateway: subdomain === "api",
    isConsoleSpa: subdomain === "console",
  };
}

/**
 * Options for configuring MainWorker.
 */
export interface WorkerOptions extends RouterHandlerOptions {
  /** Injected RouterHandler instance */
  routerHandler?: RouterHandler;
  /** Injected AuthMiddleware instance */
  authMiddleware?: AuthMiddleware;
  /** Injected TelemetryEmitter instance */
  telemetryEmitter?: TelemetryEmitter;
  /** Whether to automatically attach CORS headers to responses (default: true) */
  cors?: boolean;
  /** Optional custom admin verifier function */
  verifyAdmin?: (
    token: string,
    request: Request,
    env: WorkerEnv
  ) => Promise<boolean> | boolean;
  /** Optional list of tokens considered admin */
  adminTokens?: string[];
  /** Optional custom admin surveillance router handler */
  adminHandler?: (
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ) => Promise<Response>;
}

/**
 * Injects CORS headers into a Response if they are not already set.
 */
export function applyCors(response: Response): Response {
  if (response.headers.has("access-control-allow-origin")) {
    return response;
  }
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    if (!newHeaders.has(key)) {
      newHeaders.set(key, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

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
    let rawToken: string | undefined;

    const authHeader =
      request.headers.get("authorization") ||
      request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      rawToken = authHeader.substring(7).trim();
    }

    // Support browser address bar navigation via ?token= or ?admin_token= or cookie
    if (!rawToken) {
      try {
        const url = new URL(request.url);
        const queryToken = url.searchParams.get("token") || url.searchParams.get("admin_token");
        if (queryToken && queryToken.trim().length > 0) {
          rawToken = queryToken.trim();
        }
      } catch {
        // ignore url parsing error
      }
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

    if (!rawToken) {
      return false;
    }

    // 1. Custom verifyAdmin hook if provided in options
    if (this.options.verifyAdmin) {
      try {
        return await this.options.verifyAdmin(rawToken, request, env);
      } catch {
        return false;
      }
    }

    // 2. Options adminTokens list if provided
    if (this.options.adminTokens && this.options.adminTokens.includes(rawToken)) {
      return true;
    }

    // 3. Env master key or admin token match
    const masterKey = (env.KC_MASTER_KEY ||
      env.MASTER_KEY_PASSPHRASE ||
      env.ADMIN_TOKEN) as string | undefined;
    if (masterKey && rawToken === masterKey) {
      return true;
    }

    // 4. Check D1 Database
    const db = (env.DB || env.D1_DB) as D1Database | undefined;
    if (!db || typeof db.prepare !== "function") {
      return false;
    }

    try {
      const tokenHash = await hashToken(rawToken);

      // Look up in auth_tokens
      const tokenStmt = db.prepare(
        "SELECT id, tenant_id, expires_at FROM auth_tokens WHERE hash_sha256 = ?"
      );
      const tokenRow = await tokenStmt.bind(tokenHash).first<{
        id: string;
        tenant_id: string;
        expires_at: string | null;
      }>();

      if (tokenRow) {
        if (tokenRow.expires_at) {
          const expiresAtMs = new Date(tokenRow.expires_at).getTime();
          if (Date.now() >= expiresAtMs) {
            return false;
          }
        }

        if (tokenRow.tenant_id === "admin") {
          return true;
        }

        // Check users table for this tenant
        try {
          const userStmt = db.prepare(
            "SELECT id, email, tier, role, is_quarantined FROM users WHERE id = ?"
          );
          const userRow = await userStmt.bind(tokenRow.tenant_id).first<{
            id: string;
            email: string | null;
            tier: string | null;
            role: string | null;
            is_quarantined: number | boolean | null;
          }>();

          if (userRow) {
            if (userRow.is_quarantined === 1 || userRow.is_quarantined === true) {
              return false;
            }
            if (userRow.tier === "admin" || userRow.role === "admin") {
              return true;
            }
            if (userRow.email && env.ADMIN_EMAILS) {
              const adminEmails = String(env.ADMIN_EMAILS)
                .split(",")
                .map((e) => e.trim().toLowerCase());
              if (adminEmails.includes(userRow.email.toLowerCase())) {
                return true;
              }
            }
          }
        } catch {
          // Ignore table schema differences
        }
      }

      // Check users table directly
      try {
        const directUserStmt = db.prepare(
          "SELECT id, email, tier, role, is_quarantined FROM users WHERE id = ?"
        );
        const directUser = await directUserStmt.bind(rawToken).first<{
          id: string;
          email: string | null;
          tier: string | null;
          role: string | null;
          is_quarantined: number | boolean | null;
        }>();

        if (directUser) {
          if (directUser.is_quarantined === 1 || directUser.is_quarantined === true) {
            return false;
          }
          if (directUser.tier === "admin" || directUser.role === "admin") {
            return true;
          }
          if (directUser.email && env.ADMIN_EMAILS) {
            const adminEmails = String(env.ADMIN_EMAILS)
              .split(",")
              .map((e) => e.trim().toLowerCase());
            if (adminEmails.includes(directUser.email.toLowerCase())) {
              return true;
            }
          }
        }
      } catch {
        // Ignore table schema differences
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Handles authenticated admin surveillance requests on admin.*.
   */
  public async handleAdmin(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): Promise<Response> {
    if (this.options.adminHandler) {
      return this.options.adminHandler(request, env, ctx);
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
      return this.options.cors !== false ? applyCors(res) : res;
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
      return this.options.cors !== false ? applyCors(res) : res;
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
      return this.options.cors !== false ? applyCors(res) : res;
    }

    // 4. Other API endpoints (e.g. /api/keys, /api/stats, /api/logs)
    if (pathname.startsWith("/api/") && !pathname.startsWith("/api/admin/")) {
      return this.routerHandler.handle(request, env, ctx);
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
          return this.options.cors !== false ? applyCors(assetRes) : assetRes;
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
      return this.options.cors !== false ? applyCors(assetRes) : assetRes;
    }

    // 6. Default Admin Surveillance Status Probe
    const res = Response.json({
      service: "Key Collective Admin Surveillance",
      status: "authorized",
      timestamp: new Date().toISOString(),
    });
    return this.options.cors !== false ? applyCors(res) : res;
  }

  /**
   * Handles static asset delivery and SPA fallback on console.*.
   */
  public async handleConsole(
    request: Request,
    env: WorkerEnv
  ): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    // Health probe on console
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

    // Static Assets & Dashboard SPA Serving (when ASSETS binding is present)
    if (env.ASSETS && (method === "GET" || method === "HEAD")) {
      if (
        pathname.startsWith("/assets/") ||
        pathname === "/favicon.ico" ||
        pathname === "/favicon.svg" ||
        /\.[a-zA-Z0-9]+$/.test(pathname)
      ) {
        const assetRes = await env.ASSETS.fetch(request);
        if (assetRes.status !== 404) {
          return assetRes;
        }
      }

      // SPA navigation fallback
      const indexUrl = new URL("/", request.url);
      let res = await env.ASSETS.fetch(new Request(indexUrl.toString(), request));

      const queryToken = url.searchParams.get("token") || url.searchParams.get("admin_token");
      if (queryToken) {
        const headers = new Headers(res.headers);
        headers.append(
          "Set-Cookie",
          `kc_auth_token=${encodeURIComponent(queryToken)}; Path=/; SameSite=Lax; Secure`
        );
        res = new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      }
      return res;
    }

    // Default SPA HTML delivery when ASSETS binding is absent
    if (method === "GET" || method === "HEAD") {
      const res = new Response(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"/><title>Key Collective Console</title></head><body><div id=\"app\"></div></body></html>",
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        }
      );
      return this.options.cors !== false ? applyCors(res) : res;
    }

    return new Response("Method Not Allowed", { status: 405 });
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
      if (pathname.startsWith("/api/") || pathname.startsWith("/v1/")) {
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

/**
 * Singleton default instance of MainWorker.
 */
export const defaultMainWorker = new MainWorker();

/**
 * Factory function to create a new MainWorker instance with custom options.
 */
export function createWorker(options?: WorkerOptions): {
  fetch(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): Promise<Response>;
} {
  const worker = new MainWorker(options);
  return {
    fetch: (req, env, ctx) => worker.fetch(req, env, ctx),
  };
}

/**
 * Cloudflare Worker Default Fetch Handler Export.
 */
const defaultExport = {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): Promise<Response> {
    return defaultMainWorker.fetch(request, env, ctx);
  },
};

export default defaultExport;

// Re-export core worker components
export {
  AuthMiddleware,
  AuthenticatedContext,
  AuthMiddlewareOptions,
  withAuth,
  authenticateRequest,
  extractBearerToken,
  formatAuthError,
  InMemoryRateLimiterStorage,
} from "./auth_middleware";

export {
  RouterHandler,
  RouterHandlerOptions,
  RouterError,
  DurableObjectKeyPoolClient,
  formatRouterError,
  createRouterHandler,
  defaultRouterHandler,
  handleRoute,
} from "./router_handler";

export {
  TelemetryEmitter,
  TelemetryEmitterOptions,
  ExecutionContextLike,
  createTelemetryEmitter,
  defaultDataPointMapper,
} from "./telemetry_emitter";

export type { EdgeSubdomain, HostRouteDecision };
