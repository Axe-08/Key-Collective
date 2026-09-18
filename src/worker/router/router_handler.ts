/**
 * Key Collective v2/v4 — Edge Router Orchestrator
 * Pure dispatcher coordinating edge auth, model routes, developer dashboard,
 * and LLM chat completions pipeline.
 */

import type { KeyPoolContract } from "../../contracts/key_pool";
import type { RouterContract } from "../../contracts/router";
import { UpstreamClient } from "../../proxy/upstream/index";
import { CapabilityFilter } from "../../router/capability/index";
import type { CascadeRouter } from "../../router/cascade/index";
import {
  ALL_MODEL_DEFINITIONS,
  IModelRegistry,
  ModelRegistry,
} from "../../router/registry/index";
import { AuthTokensRepository } from "../../storage/repositories/auth_tokens/index";
import { CostLedgerRepository } from "../../storage/repositories/cost_ledger/index";
import {
  AuthenticatedContext,
  AuthMiddleware,
  WorkerEnv,
} from "../auth/index";
import { ExecutionContextLike, TelemetryEmitter } from "../telemetry_emitter";
import { ChatHandler } from "./chat_handler";
import { DashboardHandler } from "./dashboard_handler";
import { ModelRoutesHandler } from "./model_routes";
import type { RouterHandlerOptions } from "./types";
import { RouterContextResolver } from "./core/resolver";
import { dispatchRoute, forwardToDO } from "./core/dispatcher";

export class RouterHandler {
  private readonly options: RouterHandlerOptions;
  private readonly authMiddleware: AuthMiddleware;
  private readonly modelRegistry: IModelRegistry;
  private readonly capabilityFilter: CapabilityFilter;
  private readonly upstreamClient?: UpstreamClient;
  private readonly timeProvider: () => number;
  private readonly modelRoutes: ModelRoutesHandler;
  private readonly dashboardHandler: DashboardHandler;
  private readonly chatHandler: ChatHandler;
  private readonly resolver: RouterContextResolver;

  constructor(options?: RouterHandlerOptions) {
    this.options = options ?? {};
    this.authMiddleware = this.options.authMiddleware ?? new AuthMiddleware();
    this.modelRegistry =
      this.options.modelRegistry ?? new ModelRegistry(ALL_MODEL_DEFINITIONS);
    this.capabilityFilter =
      this.options.capabilityFilter ?? new CapabilityFilter(this.modelRegistry);
    this.upstreamClient = this.options.upstreamClient;
    this.timeProvider = this.options.timeProvider ?? (() => Date.now());

    this.resolver = new RouterContextResolver(
      this.options,
      this.modelRegistry,
      this.capabilityFilter,
      this.upstreamClient
    );

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

  public getKeyPool(tenantId: string, env: WorkerEnv): KeyPoolContract {
    return this.resolver.getKeyPool(tenantId, env);
  }

  public getRouter(
    tenantId: string,
    keyPool: KeyPoolContract,
    env: WorkerEnv
  ): CascadeRouter | RouterContract {
    return this.resolver.getRouter(tenantId, keyPool, env);
  }

  public getCostLedgerRepo(env: WorkerEnv): CostLedgerRepository | undefined {
    return this.resolver.getCostLedgerRepo(env);
  }

  public getAuthTokensRepo(env: WorkerEnv): AuthTokensRepository | undefined {
    return this.resolver.getAuthTokensRepo(env);
  }

  public getTelemetryEmitter(
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): TelemetryEmitter {
    return this.resolver.getTelemetryEmitter(env, ctx);
  }

  public async handleReport(request: Request, env: WorkerEnv): Promise<Response> {
    return this.modelRoutes.handleReport(request, env);
  }

  public handleListModels(request: Request): Response {
    return this.modelRoutes.handleListModels(request, this.modelRegistry);
  }

  public handleGetModel(request: Request, modelId: string): Response {
    return this.modelRoutes.handleGetModel(request, modelId, this.modelRegistry);
  }

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

  public async forwardToDO(
    request: Request,
    tenantId: string,
    env: WorkerEnv
  ): Promise<Response> {
    return forwardToDO(request, tenantId, env, this.resolver);
  }

  public async handle(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    preAuthenticatedContext?: AuthenticatedContext
  ): Promise<Response> {
    return dispatchRoute({
      request,
      env,
      ctx,
      preAuthenticatedContext,
      options: this.options,
      authMiddleware: this.authMiddleware,
      modelRegistry: this.modelRegistry,
      modelRoutes: this.modelRoutes,
      dashboardHandler: this.dashboardHandler,
      chatHandler: this.chatHandler,
      resolver: this.resolver,
      now: () => this.now(),
    });
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
