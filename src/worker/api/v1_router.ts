/**
 * @file v1_router.ts
 * Literal route table and handler for api.* (WP-2.7 Host Topology).
 *
 * Serves canonical API endpoints:
 * - POST /v1/chat/completions (Bearer API key required)
 * - GET /v1/models & GET /v1/models/:id
 * - GET /v1/health & GET /health (Liveness bypass)
 * - GET /v1/openapi.json & GET /openapi.json
 * - POST /v1/report (Takedown & abuse report)
 * - POST /v1/demo/token & GET /v1/demo/token
 * - GET / (Edge Proxy ready message)
 *
 * All unlisted paths return null (handled as 404 by the host gateway).
 */

import type { WorkerEnv } from "../auth/index";
import type { ExecutionContextLike } from "../telemetry_emitter";
import type { RouterHandler } from "../router/index";
import { handleDemoTokenRequest } from "../router/demo_routes";

export interface V1RouteParams {
  request: Request;
  env: WorkerEnv;
  ctx?: ExecutionContextLike;
  routerHandler: RouterHandler;
  startTime: number;
}

export type V1RouteHandler = (params: V1RouteParams) => Promise<Response>;

export interface V1RouteEntry {
  method: string;
  path: string | RegExp;
  handler: V1RouteHandler;
}

export const V1_ROUTE_TABLE: V1RouteEntry[] = [
  // 1. Root ready check
  {
    method: "GET",
    path: "/",
    handler: async () =>
      new Response("Key Collective v2 Edge Proxy Ready\n", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
  },
  // 2. Health check endpoints
  {
    method: "GET",
    path: "/v1/health",
    handler: async ({ request, env, ctx, routerHandler }) =>
      routerHandler.handle(request, env, ctx),
  },
  {
    method: "GET",
    path: "/health",
    handler: async ({ request, env, ctx, routerHandler }) =>
      routerHandler.handle(request, env, ctx),
  },
  // 3. OpenAPI specification
  {
    method: "GET",
    path: "/v1/openapi.json",
    handler: async ({ request, env, ctx, routerHandler }) =>
      routerHandler.handle(request, env, ctx),
  },
  {
    method: "GET",
    path: "/openapi.json",
    handler: async ({ request, env, ctx, routerHandler }) =>
      routerHandler.handle(request, env, ctx),
  },
  // 4. Abuse & takedown reporting
  {
    method: "POST",
    path: "/v1/report",
    handler: async ({ request, env, routerHandler }) =>
      routerHandler.handleReport(request, env),
  },
  // 5. Ephemeral demo sandbox token issuance
  {
    method: "POST",
    path: "/v1/demo/token",
    handler: async ({ request, env }) => handleDemoTokenRequest(request, env),
  },
  {
    method: "GET",
    path: "/v1/demo/token",
    handler: async ({ request, env }) => handleDemoTokenRequest(request, env),
  },
  // 6. Public model discovery
  {
    method: "GET",
    path: "/v1/models",
    handler: async ({ request, env, ctx, routerHandler }) =>
      routerHandler.handle(request, env, ctx),
  },
  {
    method: "GET",
    path: /^\/v1\/models\/[^/]+$/,
    handler: async ({ request, env, ctx, routerHandler }) =>
      routerHandler.handle(request, env, ctx),
  },
  // 7. Chat completions
  {
    method: "POST",
    path: "/v1/chat/completions",
    handler: async ({ request, env, ctx, routerHandler }) =>
      routerHandler.handle(request, env, ctx),
  },
];

/**
 * Matches an incoming request against the literal V1 route table for api.*.
 * Returns the Response if matched, or null if no route matched.
 */
export async function handleV1Route(params: V1RouteParams): Promise<Response | null> {
  const { request } = params;
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  for (const entry of V1_ROUTE_TABLE) {
    if (entry.method !== method) continue;

    if (typeof entry.path === "string") {
      if (entry.path === pathname) {
        return await entry.handler(params);
      }
    } else if (entry.path instanceof RegExp) {
      if (entry.path.test(pathname)) {
        return await entry.handler(params);
      }
    }
  }

  return null;
}
