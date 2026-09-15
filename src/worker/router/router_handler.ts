/**
 * Key Collective v2/v4 — Edge Router Orchestrator
 * Pure dispatcher coordinating edge auth, model routes, developer dashboard,
 * and LLM chat completions pipeline.
 */

import type { KeyPoolContract } from "../../contracts/key_pool";
import type { RouterContract } from "../../contracts/router";
import { TenantIsolationError } from "../../errors/auth_errors";
import { DomainError } from "../../errors/domain_error";
import { ModelNotFoundError } from "../../errors/routing_errors";
import { UpstreamClient } from "../../proxy/upstream_client";
import { CapabilityFilter } from "../../router/capability_filter";
import {
  CascadeRouter,
  CascadeRouterOptions,
} from "../../router/cascade_router";
import {
  ALL_MODEL_DEFINITIONS,
  IModelRegistry,
  ModelRegistry,
} from "../../router/model_registry";
import { AuthTokensRepository } from "../../storage/repositories/authTokens";
import { CostLedgerRepository } from "../../storage/repositories/costLedger";
import {
  AuthenticatedContext,
  AuthMiddleware,
  WorkerEnv,
} from "../auth_middleware";
import { ExecutionContextLike, TelemetryEmitter } from "../telemetry_emitter";
import { ChatHandler } from "./chat_handler";
import { DashboardHandler } from "./dashboard_handler";
import { DurableObjectKeyPoolClient } from "./do_client";
import { formatRouterError, RouterError } from "./errors";
import { ModelRoutesHandler } from "./model_routes";
import type {
  DurableObjectNamespaceLike,
  RouterHandlerOptions,
} from "./types";

export class RouterHandler {
  private readonly options: RouterHandlerOptions;
  private readonly authMiddleware: AuthMiddleware;
  private readonly modelRegistry: IModelRegistry;
  private readonly capabilityFilter: CapabilityFilter;
  private readonly upstreamClient: UpstreamClient;
  private readonly timeProvider: () => number;
  private readonly modelRoutes: ModelRoutesHandler;
  private readonly dashboardHandler: DashboardHandler;
  private readonly chatHandler: ChatHandler;

  constructor(options?: RouterHandlerOptions) {
    this.options = options ?? {};
    this.authMiddleware = this.options.authMiddleware ?? new AuthMiddleware();
    this.modelRegistry =
      this.options.modelRegistry ?? new ModelRegistry(ALL_MODEL_DEFINITIONS);
    this.capabilityFilter =
      this.options.capabilityFilter ?? new CapabilityFilter(this.modelRegistry);
    this.upstreamClient = this.options.upstreamClient ?? new UpstreamClient();
    this.timeProvider = this.options.timeProvider ?? (() => Date.now());

    this.modelRoutes = new ModelRoutesHandler();
    this.dashboardHandler = new DashboardHandler(
      this.options,
      this.authMiddleware,
      (tenantId, env) => this.getKeyPool(tenantId, env)
    );
    this.chatHandler = new ChatHandler({
      options: this.options,
      modelRegistry: this.modelRegistry,
      timeProvider: this.timeProvider,
      getKeyPool: (tenantId, env) => this.getKeyPool(tenantId, env),
      getRouter: (tenantId, keyPool, env) => this.getRouter(tenantId, keyPool, env),
      getCostLedgerRepo: (env) => this.getCostLedgerRepo(env),
      getAuthTokensRepo: (env) => this.getAuthTokensRepo(env),
      getTelemetryEmitter: (env, ctx) => this.getTelemetryEmitter(env, ctx),
    });
  }

  private now(): number {
    return this.timeProvider();
  }

  /**
   * Resolves or creates a KeyPoolContract client for the given tenant ID.
   * Enforces Per-Tenant DO Isolation (GEMINI.md Invariant).
   */
  public getKeyPool(tenantId: string, env: WorkerEnv): KeyPoolContract {
    if (this.options.keyPoolFactory) {
      return this.options.keyPoolFactory(tenantId, env);
    }

    const keyPoolNamespace = env.KEY_POOL as unknown as DurableObjectNamespaceLike | undefined;
    if (keyPoolNamespace && typeof keyPoolNamespace.idFromName === "function") {
      const doId = keyPoolNamespace.idFromName(tenantId);
      const doStub = keyPoolNamespace.get(doId);
      return new DurableObjectKeyPoolClient(doStub, tenantId);
    }

    if (this.options.router && "getKeyPool" in this.options.router) {
      const routerKeyPool = (this.options.router as CascadeRouter).getKeyPool();
      if (routerKeyPool) {
        return routerKeyPool;
      }
    }

    throw new RouterError(
      `No KEY_POOL Durable Object namespace binding or keyPoolFactory found for tenant '${tenantId}'`,
      { statusCode: 500, code: "MISSING_KEY_POOL_BINDING" }
    );
  }

  /**
   * Resolves or creates a CascadeRouter for the given tenant ID.
   */
  public getRouter(
    tenantId: string,
    keyPool: KeyPoolContract,
    env: WorkerEnv
  ): CascadeRouter | RouterContract {
    if (this.options.routerFactory) {
      return this.options.routerFactory(tenantId, keyPool, env);
    }

    if (this.options.router) {
      return this.options.router;
    }

    const client =
      this.upstreamClient ??
      new UpstreamClient({
        keyResolver: async (provider: string) => {
          return keyPool.getKey(provider);
        },
      });

    return new CascadeRouter({
      keyPool,
      registry: this.modelRegistry,
      capabilityFilter: this.capabilityFilter,
      upstreamClient: client,
    });
  }

  /**
   * Resolves or creates a CostLedgerRepository instance.
   */
  public getCostLedgerRepo(env: WorkerEnv): CostLedgerRepository | undefined {
    if (this.options.costLedgerRepo) {
      return this.options.costLedgerRepo;
    }
    if (env.DB && typeof env.DB.prepare === "function") {
      return new CostLedgerRepository(env.DB);
    }
    return undefined;
  }

  /**
   * Resolves or creates an AuthTokensRepository instance.
   */
  public getAuthTokensRepo(env: WorkerEnv): AuthTokensRepository | undefined {
    if (this.options.authTokensRepo) {
      return this.options.authTokensRepo;
    }
    if (env.DB && typeof env.DB.prepare === "function") {
      const masterKey =
        this.options.masterKey ??
        (env.KC_MASTER_KEY ? String(env.KC_MASTER_KEY) : undefined);
      return new AuthTokensRepository(env.DB, { masterKey });
    }
    return undefined;
  }

  /**
   * Resolves or creates a TelemetryEmitter instance.
   */
  public getTelemetryEmitter(
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): TelemetryEmitter {
    if (this.options.telemetryEmitter) {
      return this.options.telemetryEmitter;
    }
    return new TelemetryEmitter({
      dataset: env.TELEMETRY,
      ctx,
    });
  }

  /**
   * Gateway takedown report handler.
   */
  public async handleReport(request: Request, env: WorkerEnv): Promise<Response> {
    return this.modelRoutes.handleReport(request, env);
  }

  /**
   * Public models list handler.
   */
  public handleListModels(request: Request): Response {
    return this.modelRoutes.handleListModels(request, this.modelRegistry);
  }

  /**
   * Public model detail handler.
   */
  public handleGetModel(request: Request, modelId: string): Response {
    return this.modelRoutes.handleGetModel(request, modelId, this.modelRegistry);
  }

  /**
   * Dashboard REST API handler.
   */
  public async handleDashboardApi(
    request: Request,
    pathname: string,
    method: string,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    traceId?: string
  ): Promise<Response> {
    return this.dashboardHandler.handle(request, pathname, method, env, ctx, traceId);
  }

  /**
   * Chat completions handler.
   */
  public async handleChatCompletions(
    request: Request,
    body: Record<string, unknown>,
    authContext: AuthenticatedContext,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    traceId: string = crypto.randomUUID(),
    startTime: number = this.now()
  ): Promise<Response> {
    return this.chatHandler.handleChatCompletions(
      request,
      body,
      authContext,
      env,
      ctx,
      traceId,
      startTime
    );
  }

  /**
   * Forwards a management or observability request directly to the tenant's Durable Object.
   */
  public async forwardToDO(
    request: Request,
    tenantId: string,
    env: WorkerEnv
  ): Promise<Response> {
    const keyPool = this.getKeyPool(tenantId, env);
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

  /**
   * Primary edge HTTP entrypoint.
   */
  public async handle(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    preAuthenticatedContext?: AuthenticatedContext
  ): Promise<Response> {
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
    const startTime = this.now();
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    // 1. Health check bypass
    if (pathname === "/health" || pathname === "/v1/health") {
      return this.modelRoutes.handleHealth(startTime);
    }

    if (method === "POST" && (pathname === "/v1/report" || pathname === "/report")) {
      return await this.handleReport(request, env);
    }

    if (method === "GET" && (pathname === "/openapi.json" || pathname === "/v1/openapi.json")) {
      return this.modelRoutes.handleOpenApiSpec();
    }

    // 1.1 Public Model Discovery
    if (method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
      return this.handleListModels(request);
    }

    if (
      method === "GET" &&
      (pathname.startsWith("/v1/models/") || pathname.startsWith("/models/"))
    ) {
      const parts = pathname.split("/");
      const modelId = parts[parts.length - 1];
      try {
        return this.handleGetModel(request, modelId);
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
      return await this.handleDashboardApi(request, pathname, method, env, ctx, traceId);
    }

    try {
      // 3. Authentication & Tenant Resolution
      let authContext: AuthenticatedContext;

      if (preAuthenticatedContext) {
        authContext = preAuthenticatedContext;
      } else if (this.options.requireAuth !== false) {
        authContext = await this.authMiddleware.authenticate(request, env);
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
        return this.handleListModels(request);
      }

      if (
        method === "GET" &&
        (pathname.startsWith("/v1/models/") || pathname.startsWith("/models/"))
      ) {
        const parts = pathname.split("/");
        const modelId = parts[parts.length - 1];
        return this.handleGetModel(request, modelId);
      }

      if (
        pathname.startsWith("/v1/keys") ||
        pathname.startsWith("/keys") ||
        pathname.startsWith("/v1/metrics") ||
        pathname.startsWith("/metrics") ||
        pathname.startsWith("/v1/capacity") ||
        pathname.startsWith("/capacity")
      ) {
        return await this.forwardToDO(request, authContext.tenantId, env);
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

        return await this.handleChatCompletions(
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
      const telemetryEmitter = this.getTelemetryEmitter(env, ctx);
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
          latencyMs: this.now() - startTime,
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
}

export function createRouterHandler(options?: RouterHandlerOptions): RouterHandler {
  return new RouterHandler(options);
}

export const defaultRouterHandler = new RouterHandler();

export async function handleRoute(
  request: Request,
  env: WorkerEnv,
  ctx?: ExecutionContextLike,
  authContext?: AuthenticatedContext,
  options?: RouterHandlerOptions
): Promise<Response> {
  const handler = options ? new RouterHandler(options) : defaultRouterHandler;
  return handler.handle(request, env, ctx, authContext);
}
