/**
 * @file legacy_routes.ts
 * Deprecation routing and telemetry for legacy route aliases and host deprecations (WP-2.7).
 *
 * Serves:
 * - /v1/* on console and apex hosts
 * - path aliases on any host:
 *   /chat/completions, /v1/route, POST /, /models, /models/:id, /report,
 *   /demo/token, /api/demo/token, /v1/report
 *
 * Each legacy response attaches:
 * - Deprecation: true
 * - Sunset: <LEGACY_SUNSET>
 * - Link: <https://api.key-col.axe08.tech/v1>; rel="successor-version"
 *
 * Writes one legacy_route_hit telemetry event.
 */

import type { WorkerEnv } from "../auth/index";
import type { ExecutionContextLike } from "../telemetry_emitter";
import type { RouterHandler } from "../router/index";
import { handleDemoTokenRequest } from "../router/demo_routes";

export interface LegacyRouteMatch {
  routeId: string;
  targetPath: string;
  targetMethod: string;
}

const RAW_DO_PATHS = new Set([
  "/v1/keys",
  "/v1/keys/usage",
  "/v1/metrics",
  "/v1/capacity",
]);

/**
 * Matches an incoming request against legacy routes and aliases.
 * Returns LegacyRouteMatch if matched, or null if not a legacy route.
 */
export function matchLegacyRoute(
  hostType: "api" | "console" | "admin" | "apex",
  method: string,
  pathname: string
): LegacyRouteMatch | null {
  // Raw DO paths stay 404 everywhere (N-01 security invariant)
  if (RAW_DO_PATHS.has(pathname) || pathname.startsWith("/v1/keys/") || pathname === "/v1/keys") {
    return null;
  }

  // 1. /v1/* endpoints on console and apex hosts
  if (hostType === "console" || hostType === "apex") {
    if (method === "POST" && pathname === "/v1/chat/completions") {
      return {
        routeId: "POST /v1/chat/completions",
        targetPath: "/v1/chat/completions",
        targetMethod: "POST",
      };
    }
    if (method === "GET" && pathname === "/v1/models") {
      return {
        routeId: "GET /v1/models",
        targetPath: "/v1/models",
        targetMethod: "GET",
      };
    }
    if (method === "GET" && /^\/v1\/models\/[^/]+$/.test(pathname)) {
      return {
        routeId: "GET /v1/models/:id",
        targetPath: pathname,
        targetMethod: "GET",
      };
    }
    if (method === "GET" && pathname === "/v1/health") {
      return {
        routeId: "GET /v1/health",
        targetPath: "/v1/health",
        targetMethod: "GET",
      };
    }
    if (method === "GET" && pathname === "/v1/openapi.json") {
      return {
        routeId: "GET /v1/openapi.json",
        targetPath: "/v1/openapi.json",
        targetMethod: "GET",
      };
    }
    if ((method === "POST" || method === "GET") && pathname === "/v1/demo/token") {
      return {
        routeId: `${method} /v1/demo/token`,
        targetPath: "/v1/demo/token",
        targetMethod: method,
      };
    }
    if (method === "POST" && pathname === "/v1/report") {
      return {
        routeId: "POST /v1/report",
        targetPath: "/v1/report",
        targetMethod: "POST",
      };
    }
  }

  // 2. Path aliases on any host
  if (method === "POST" && pathname === "/chat/completions") {
    return {
      routeId: "POST /chat/completions",
      targetPath: "/v1/chat/completions",
      targetMethod: "POST",
    };
  }
  if (method === "POST" && pathname === "/v1/route") {
    return {
      routeId: "POST /v1/route",
      targetPath: "/v1/chat/completions",
      targetMethod: "POST",
    };
  }
  if (method === "POST" && pathname === "/") {
    return {
      routeId: "POST /",
      targetPath: "/v1/chat/completions",
      targetMethod: "POST",
    };
  }
  if (method === "GET" && pathname === "/models") {
    return {
      routeId: "GET /models",
      targetPath: "/v1/models",
      targetMethod: "GET",
    };
  }
  if (method === "GET" && /^\/models\/[^/]+$/.test(pathname)) {
    return {
      routeId: "GET /models/:id",
      targetPath: `/v1${pathname}`,
      targetMethod: "GET",
    };
  }
  if (method === "POST" && pathname === "/report") {
    return {
      routeId: "POST /report",
      targetPath: "/v1/report",
      targetMethod: "POST",
    };
  }
  if ((method === "POST" || method === "GET") && pathname === "/demo/token") {
    return {
      routeId: `${method} /demo/token`,
      targetPath: "/v1/demo/token",
      targetMethod: method,
    };
  }
  if (
    (method === "POST" || method === "GET") &&
    pathname === "/api/demo/token" &&
    hostType !== "console"
  ) {
    return {
      routeId: `${method} /api/demo/token`,
      targetPath: "/v1/demo/token",
      targetMethod: method,
    };
  }

  return null;
}

/**
 * Executes a legacy route request by forwarding to its canonical equivalent,
 * adding deprecation headers, and emitting telemetry.
 */
export async function handleLegacyRoute(
  request: Request,
  match: LegacyRouteMatch,
  env: WorkerEnv,
  ctx: ExecutionContextLike | undefined,
  routerHandler: RouterHandler
): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = match.targetPath;
  const canonicalRequest = new Request(url.toString(), request);

  let response: Response;

  if (match.targetPath === "/v1/report") {
    response = await routerHandler.handleReport(canonicalRequest, env);
  } else if (match.targetPath === "/v1/demo/token") {
    response = await handleDemoTokenRequest(canonicalRequest, env);
  } else {
    response = await routerHandler.handle(canonicalRequest, env, ctx);
  }

  // Record legacy_route_hit telemetry
  const telemetry = env.TELEMETRY;
  if (telemetry && typeof telemetry.writeDataPoint === "function") {
    try {
      telemetry.writeDataPoint({
        blobs: ["legacy_route_hit", match.routeId],
        doubles: [Date.now()],
        indexes: [],
      });
    } catch {
      // Non-blocking telemetry invariant
    }
  }

  // Attach deprecation headers
  const sunset = (env.LEGACY_SUNSET as string | undefined) ?? "Thu, 01 Jan 2026 00:00:00 GMT";
  const apiHost = (env.API_HOST as string | undefined) ?? "api.key-col.axe08.tech";

  const headers = new Headers(response.headers);
  headers.set("Deprecation", "true");
  headers.set("Sunset", sunset);
  headers.set("Link", `<https://${apiHost}/v1>; rel="successor-version"`);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
