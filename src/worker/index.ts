/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Main Worker Entrypoint: API Gateway, OpenAI-Compatible Routing, Auth & Observability
 *
 * Conforms to:
 * - LLD 1.0 (Main Worker Export) & Edge Worker Auth Architecture:
 *   1. Routes:
 *      - `GET /health`, `GET /v1/health`: Basic liveness probe returning healthy payload.
 *      - `GET /`: Edge proxy root status probe.
 *      - `OPTIONS *`: CORS preflight handling with standard cross-origin headers.
 *      - `GET /v1/models`, `GET /models`: OpenAI-compatible models catalog listing.
 *      - `GET /v1/models/:id`, `GET /models/:id`: Single model detail and alias resolution.
 *      - `POST /v1/chat/completions`, `POST /chat/completions`, `POST /v1/route`:
 *        Authenticated OpenAI-compatible chat completions (streaming & non-streaming).
 *      - `/v1/keys`, `/v1/metrics`, `/v1/capacity`: Direct tenant DO forwarding.
 *   2. Auth & Tenant Isolation (GEMINI.md Invariant):
 *      Intercepts incoming requests, delegates to AuthMiddleware for constant-time
 *      Bearer token verification in D1, budget checks, and RPM limiting.
 *      Enforces tenant isolation by verifying matching tenant headers.
 *   3. Non-Blocking Telemetry & Hot Path (GEMINI.md Invariant):
 *      Delegates execution to RouterHandler, streaming SSE chunks with 0ms added latency
 *      and deferring telemetry and ledger writes to non-blocking `ctx.waitUntil()`.
 *   4. Fixed-Point Microdollars:
 *      All token costs and balances tracked strictly in int64/bigint microdollars.
 *      Zero floating-point math for financials.
 *   5. Strict TypeScript: Strict mode, zero `any`.
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
 * MainWorker: Primary API Gateway class for Key Collective Cloudflare Worker.
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

    // 1. CORS Preflight Request Handling
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // 2. Health & Liveness Probes (Public, zero auth required)
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

    // 3. Root Endpoint Status Probe (Public, backward compatible with smoke tests)
    if (method === "GET" && (pathname === "/" || pathname === "")) {
      const res = new Response("Key Collective v2 Edge Proxy Ready", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
      return this.options.cors !== false ? applyCors(res) : res;
    }

    // 4. Delegate to RouterHandler for OpenAI-compatible routing and DO forwarding
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
