/**
 * Key Collective v2/v4 — Edge Router Request Dispatcher
 *
 * Invariants (GEMINI.md Constitution):
 * - Strict TypeScript (zero `any`).
 * - Non-blocking telemetry.
 * - Per-Tenant Isolation checks.
 */

import { TenantIsolationError } from "../../../errors/auth_errors";
import { DomainError } from "../../../errors/domain_error";
import { ModelNotFoundError } from "../../../errors/routing_errors";
import type { IModelRegistry } from "../../../router/registry/index";
import type {
  AuthenticatedContext,
  AuthMiddleware,
  WorkerEnv,
} from "../../auth/index";
import type { ExecutionContextLike } from "../../telemetry_emitter";
import { DurableObjectKeyPoolClient } from "../do_client";
import { formatRouterError, RouterError } from "../errors";
import type { ModelRoutesHandler } from "../model_routes";
import type { DashboardHandler } from "../dashboard_handler";
import type { ChatHandler } from "../chat_handler";
import type { RouterHandlerOptions } from "../types";
import type { RouterContextResolver } from "./resolver";
import { handleDemoTokenRequest } from "../demo_routes";

export interface DispatchParams {
  request: Request;
  env: WorkerEnv;
  ctx?: ExecutionContextLike;
  preAuthenticatedContext?: AuthenticatedContext;
  options: RouterHandlerOptions;
  authMiddleware: AuthMiddleware;
  modelRegistry: IModelRegistry;
  modelRoutes: ModelRoutesHandler;
  dashboardHandler: DashboardHandler;
  chatHandler: ChatHandler;
  resolver: RouterContextResolver;
  now: () => number;
}

export async function forwardToDO(
  request: Request,
  tenantId: string,
  env: WorkerEnv,
  resolver: RouterContextResolver
): Promise<Response> {
  const keyPool = resolver.getKeyPool(tenantId, env);
  if (keyPool instanceof DurableObjectKeyPoolClient) {
    const stub = keyPool.getStub();
    const url = new URL(request.url);

    const doPath = url.pathname.replace(/^\/v1/, "") || "/";
    const targetUrl = new URL(doPath + url.search, "http://key-pool");

    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set("x-tenant-id", tenantId);

    return await stub.fetch(targetUrl.toString(), {
      method: request.method,
      headers: forwardHeaders,
      body: request.body,
    });
  }

  throw new RouterError("Target key pool is not a DurableObjectKeyPoolClient", {
    statusCode: 500,
    code: "INVALID_KEY_POOL_TYPE",
  });
}

export async function dispatchRoute(params: DispatchParams): Promise<Response> {
  const {
    request,
    env,
    ctx,
    preAuthenticatedContext,
    options,
    authMiddleware,
    modelRegistry,
    modelRoutes,
    dashboardHandler,
    chatHandler,
    resolver,
    now,
  } = params;

  if (env.MIDNIGHT_FREEZE === "true" || env.MIDNIGHT_FREEZE === "1") {
    return new Response(
      JSON.stringify({
        error: {
          message:
            "Service is temporarily unavailable due to a scheduled or emergency maintenance freeze (Midnight Freeze).",
          type: "service_unavailable",
          code: "MIDNIGHT_FREEZE",
          statusCode: 503,
        },
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      }
    );
  }

  const startTime = now();
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  // 1. Health check bypass
  if (pathname === "/health" || pathname === "/v1/health") {
    return modelRoutes.handleHealth(startTime);
  }

  if (method === "POST" && (pathname === "/v1/report" || pathname === "/report")) {
    return await modelRoutes.handleReport(request, env);
  }

  if (method === "GET" && (pathname === "/openapi.json" || pathname === "/v1/openapi.json")) {
    return modelRoutes.handleOpenApiSpec();
  }

  // 1.05 Ephemeral Demo Sandbox Token Issuance
  if (
    (method === "POST" || method === "GET") &&
    (pathname === "/v1/demo/token" || pathname === "/demo/token" || pathname === "/api/demo/token")
  ) {
    return await handleDemoTokenRequest(request, env);
  }

  // 1.1 Public Model Discovery
  if (method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
    return modelRoutes.handleListModels(request, modelRegistry);
  }

  if (
    method === "GET" &&
    (pathname.startsWith("/v1/models/") || pathname.startsWith("/models/"))
  ) {
    const parts = pathname.split("/");
    const modelId = parts[parts.length - 1];
    try {
      return modelRoutes.handleGetModel(request, modelId, modelRegistry);
    } catch (err: unknown) {
      if (
        err instanceof ModelNotFoundError ||
        (err && typeof err === "object" && (err as { code?: string }).code === "MODEL_NOT_FOUND")
      ) {
        return Response.json(
          {
            error: `Model '${modelId}' not found in registry`,
            code: "MODEL_NOT_FOUND",
            statusCode: 404,
            details: { modelIdOrAlias: modelId },
          },
          {
            status: 404,
            headers: {
              "access-control-allow-origin": "*",
              "content-type": "application/json; charset=utf-8",
            },
          }
        );
      }
      throw err;
    }
  }

  // 2. Resolve trace ID from request headers or generate fresh UUID
  const traceId =
    request.headers.get("x-kc-trace-id") ??
    request.headers.get("x-trace-id") ??
    crypto.randomUUID();

  // 2.1 Dashboard API endpoints
  if (pathname.startsWith("/api/")) {
    return await dashboardHandler.handle(request, pathname, method, env, ctx, traceId);
  }

  try {
    // 3. Authentication & Tenant Resolution
    let authContext: AuthenticatedContext;

    if (preAuthenticatedContext) {
      authContext = preAuthenticatedContext;
    } else if (options.requireAuth !== false) {
      authContext = await authMiddleware.authenticate(request, env);
    } else {
      const headerTenant =
        request.headers.get("x-tenant-id") ??
        request.headers.get("kc-tenant-id") ??
        "default";
      authContext = {
        tenantId: headerTenant,
        isAuthenticated: false,
        token: {
          id: "unauthenticated",
          hashSha256: "",
          tenantId: headerTenant,
          budgetMicrodollars: 0n,
          spentMicrodollars: 0n,
          allowedProviders: [],
          rpmLimit: 1000,
          expiresAt: null,
          createdAt: new Date(startTime).toISOString(),
        },
        rpmLimit: 1000,
        currentRpm: 1,
        remainingRpm: 999,
        budgetMicrodollars: 0n,
        spentMicrodollars: 0n,
      };
    }

    // 4. Assert Tenant Isolation against explicit header if provided (GEMINI.md Invariant)
    const explicitHeaderTenant = request.headers.get("x-tenant-id");
    if (
      explicitHeaderTenant &&
      explicitHeaderTenant.trim() !== authContext.tenantId.trim()
    ) {
      throw new TenantIsolationError(
        `Tenant isolation violation: Header x-tenant-id '${explicitHeaderTenant}' does not match authenticated token tenant '${authContext.tenantId}'`,
        {
          tenantId: authContext.tenantId,
          attemptedTenantId: explicitHeaderTenant,
        }
      );
    }

    // 5. Route Dispatching
    if (method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
      return modelRoutes.handleListModels(request, modelRegistry);
    }

    if (
      method === "GET" &&
      (pathname.startsWith("/v1/models/") || pathname.startsWith("/models/"))
    ) {
      const parts = pathname.split("/");
      const modelId = parts[parts.length - 1];
      return modelRoutes.handleGetModel(request, modelId, modelRegistry);
    }

    if (
      pathname.startsWith("/v1/keys") ||
      pathname.startsWith("/keys") ||
      pathname.startsWith("/v1/metrics") ||
      pathname.startsWith("/metrics") ||
      pathname.startsWith("/v1/capacity") ||
      pathname.startsWith("/capacity")
    ) {
      return await forwardToDO(request, authContext.tenantId, env, resolver);
    }

    if (
      method === "POST" &&
      (pathname === "/v1/chat/completions" ||
        pathname === "/chat/completions" ||
        pathname === "/v1/route" ||
        pathname === "/" ||
        pathname === "")
    ) {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        throw new RouterError("Malformed JSON in request body", {
          statusCode: 400,
          code: "INVALID_REQUEST_BODY",
        });
      }

      return await chatHandler.handleChatCompletions(
        request,
        body,
        authContext,
        env,
        ctx,
        traceId,
        startTime
      );
    }

    return new Response(
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
          "x-kc-trace-id": traceId,
        },
      }
    );
  } catch (err: unknown) {
    const telemetryEmitter = resolver.getTelemetryEmitter(env, ctx);
    try {
      const tenantId =
        preAuthenticatedContext?.tenantId ??
        request.headers.get("x-tenant-id") ??
        "unknown";
      telemetryEmitter.emit({
        traceId,
        tenantId,
        timestamp: startTime,
        eventType: "request_error",
        latencyMs: now() - startTime,
        costMicrodollars: 0n,
        metadata: {
          pathname,
          method,
          error: err instanceof Error ? err.message : String(err),
          errorCode: err instanceof DomainError ? err.code : "UNKNOWN_ERROR",
        },
      });
    } catch {
      // Non-blocking telemetry invariant
    }

    return formatRouterError(err);
  }
}
