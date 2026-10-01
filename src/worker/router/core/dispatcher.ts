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
import { formatRouterError, RouterError } from "../errors";
import type { ModelRoutesHandler } from "../model_routes";
import type { DashboardHandler } from "../dashboard_handler";
import type { ChatHandler } from "../chat_handler";
import type { RouterHandlerOptions } from "../types";
import type { RouterContextResolver } from "./resolver";
import { handleDemoTokenRequest } from "../demo_routes";
import { applyKcHeaders } from "../headers";

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

  const startTime = now();
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  // Resolve trace ID from request headers or generate fresh UUID
  const traceId =
    request.headers.get("x-kc-trace-id") ??
    request.headers.get("x-trace-id") ??
    crypto.randomUUID();

  const wrapResponse = (res: Response): Response => {
    if (pathname.startsWith("/api/")) {
      return res;
    }
    return applyKcHeaders(res, { traceId, requestId: traceId });
  };

  if (env.MIDNIGHT_FREEZE === "true" || env.MIDNIGHT_FREEZE === "1") {
    return wrapResponse(
      new Response(
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
      )
    );
  }

  // 1. Health check bypass
  if (pathname === "/health" || pathname === "/v1/health") {
    return wrapResponse(modelRoutes.handleHealth(startTime));
  }

  if (method === "POST" && (pathname === "/v1/report" || pathname === "/report")) {
    return wrapResponse(await modelRoutes.handleReport(request, env));
  }

  if (method === "GET" && (pathname === "/openapi.json" || pathname === "/v1/openapi.json")) {
    return wrapResponse(modelRoutes.handleOpenApiSpec());
  }

  // 1.05 Ephemeral Demo Sandbox Token Issuance
  if (
    (method === "POST" || method === "GET") &&
    (pathname === "/v1/demo/token" || pathname === "/demo/token" || pathname === "/api/demo/token")
  ) {
    return wrapResponse(await handleDemoTokenRequest(request, env));
  }

  // 1.1 Public Model Discovery
  if (method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
    return wrapResponse(modelRoutes.handleListModels(request, modelRegistry));
  }

  if (
    method === "GET" &&
    (pathname.startsWith("/v1/models/") || pathname.startsWith("/models/"))
  ) {
    const parts = pathname.split("/");
    const modelId = parts[parts.length - 1];
    try {
      return wrapResponse(modelRoutes.handleGetModel(request, modelId, modelRegistry));
    } catch (err: unknown) {
      if (
        err instanceof ModelNotFoundError ||
        (err && typeof err === "object" && (err as { code?: string }).code === "MODEL_NOT_FOUND")
      ) {
        const res = formatRouterError(
          err instanceof ModelNotFoundError ? err : new RouterError(`Model '${modelId}' not found`, { code: "MODEL_NOT_FOUND", statusCode: 404 }),
          { traceId, requestId: traceId }
        );
        res.headers.set("access-control-allow-origin", "*");
        return wrapResponse(res);
      }
      throw err;
    }
  }

  // 2.1 Dashboard API endpoints
  if (pathname.startsWith("/api/")) {
    return await dashboardHandler.handle(request, pathname, method, env, ctx, traceId);
  }

  try {
    // 3. Authentication & Tenant Resolution
    let authContext: AuthenticatedContext;

    if (preAuthenticatedContext) {
      authContext = preAuthenticatedContext;
    } else {
      authContext = await authMiddleware.authenticate(request, env);
    }

    /**
     * 4. Assert Tenant Isolation against explicit header if provided (GEMINI.md Invariant).
     * The 'x-tenant-id' header is optional and informational; tenant isolation is strictly
     * enforced based on authenticated context credentials. If provided, any mismatch
     * with the authenticated token's tenant will result in an immediate 403.
     */
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
      return wrapResponse(modelRoutes.handleListModels(request, modelRegistry));
    }

    if (
      method === "GET" &&
      (pathname.startsWith("/v1/models/") || pathname.startsWith("/models/"))
    ) {
      const parts = pathname.split("/");
      const modelId = parts[parts.length - 1];
      return wrapResponse(modelRoutes.handleGetModel(request, modelId, modelRegistry));
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

      return wrapResponse(
        await chatHandler.handleChatCompletions(
          request,
          body,
          authContext,
          env,
          ctx,
          traceId,
          startTime
        )
      );
    }

    return wrapResponse(
      new Response(
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
      )
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

    const errorRes = formatRouterError(err, { traceId, requestId: traceId });
    return wrapResponse(errorRes);
  }
}
