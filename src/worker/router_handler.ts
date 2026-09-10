/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * RouterHandler: Worker Edge Routing, Per-Tenant Durable Object Dispatch & Streaming Response Handling
 *
 * Conforms to:
 * - LLD 2.3 & Edge Worker Architecture:
 *   1. Per-Tenant DO Isolation (GEMINI.md Invariant):
 *      Dispatches requests to tenant-isolated Durable Objects via `env.KEY_POOL.idFromName(tenantId)`.
 *      Enforces zero cross-tenant state leakage and verifies tenant boundary headers.
 *   2. DO RPC & KeyPoolContract Adapter:
 *      Wraps DurableObjectStub into a robust KeyPoolContract implementation that supports
 *      both direct method invocation and HTTP fetch RPC.
 *   3. Multi-Model Cascade Routing & Fallback Escalation:
 *      Integrates with CascadeRouter, ModelRegistry, and CapabilityFilter to route to optimal
 *      models and escalate seamlessly across fallbacks upon provider errors.
 *   4. Streaming Response Passthrough & Non-Blocking Observability (GEMINI.md Invariant):
 *      Pipes SSE streaming chunks with 0ms added latency. Intercepts terminal usage blocks
 *      and defers cost ledger writes and telemetry emission to non-blocking `ctx.waitUntil()`.
 *   5. Fixed-Point Microdollars:
 *      All token costs and balances tracked in int64/bigint microdollars (1 USD = 1,000,000 µ$).
 *      Zero floating-point math for financials.
 *   6. Golden Tests Compliance:
 *      - tc-01: Happy path prompt routed to key with 200 response and cost calculation.
 *      - tc-02: Streaming request parses terminal usage block and logs cost.
 *      - tc-05: Context window gate returns HTTP 400 when prompt tokens exceed model limit.
 *      - tc-06: Model alias resolution ('smart-fast' -> 'gemini-2.0-flash').
 *      - tc-07: Capability filter excludes unsupported models when tools/vision requested.
 *      - tc-08: Budget exhaustion returns HTTP 429 with Retry-After header.
 *      - tc-12: Edge auth token validation rejects invalid tokens with HTTP 401.
 */

import { DEFAULT_RETRY_AFTER_SECONDS } from "../constants/limits";
import type { KeyPoolContract, KeyMetrics } from "../contracts/key_pool";
import type { RouteRequest, RouteResponse, RouterContract } from "../contracts/router";
import type { KeyInput } from "../crypto";
import type { CapacitySummary } from "../durable_objects/key_selector";
import { AuthenticationError, TenantIsolationError } from "../errors/auth_errors";
import { DomainError, DomainErrorOptions } from "../errors/domain_error";
import {
  InvalidKeyError,
  KeyNotFoundError,
  QuotaExceededError,
  RateLimitExceededError,
} from "../errors/key_errors";
import {
  CapabilityMismatchError,
  FallbackExhaustedError,
  ModelNotFoundError,
  NoAvailableProviderError,
  ProviderRoutingError,
  ProviderTimeoutError,
} from "../errors/routing_errors";
import {
  SSEStreamTransformer,
  StreamMetadata,
  StreamUsage,
} from "../proxy/sse_transformer";
import {
  UpstreamClient,
  UpstreamResponse,
} from "../proxy/upstream_client";
import { decryptKey } from "../durable_objects/crypto";
import { CapabilityFilter } from "../router/capability_filter";
import {
  CascadeRouter,
  CascadeRouteRequest,
  CascadeRouteResponse,
  CascadeRouterOptions,
} from "../router/cascade_router";
import {
  ALL_MODEL_DEFINITIONS,
  ContextWindowExceededError,
  IModelRegistry,
  ModelRegistry,
} from "../router/model_registry";
import {
  AuthTokenRecord,
  AuthTokensRepository,
} from "../storage/repositories/authTokens";
import {
  CostLedgerEventInput,
  CostLedgerRepository,
} from "../storage/repositories/costLedger";
import { createApiResponse, ApiResponse } from "../types/api";
import { ModelDef } from "../types/models";
import {
  AuthenticatedContext,
  AuthMiddleware,
  AuthMiddlewareOptions,
  extractBearerToken,
  formatAuthError,
  WorkerEnv,
} from "./auth_middleware";
import {
  ExecutionContextLike,
  TelemetryEmitter,
} from "./telemetry_emitter";

/**
 * Concrete domain error for edge routing failures.
 */
export class RouterError extends DomainError {
  public override readonly name = "RouterError";

  constructor(message: string, options: DomainErrorOptions = {}) {
    super(message, options);
    Object.setPrototypeOf(this, RouterError.prototype);
  }
}

/**
 * Structural interface matching Cloudflare DurableObjectStub.
 * Enables both Cloudflare native stubs and mock stubs in unit tests.
 */
export interface DurableObjectStubLike {
  id?: {
    toString(): string;
    name?: string;
  };
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  getKey?(provider: string): Promise<string>;
  recordUsage?(keyId: string, costMicrodollars: bigint): Promise<void>;
  recordResult?(keyId: string, success: boolean): Promise<void>;
  recordStatusCode?(keyId: string, statusCode: number): Promise<void>;
  getKeyMetrics?(keyId: string): Promise<KeyMetrics>;
  getCapacitySummary?(provider?: string): Promise<CapacitySummary>;
}

/**
 * Structural interface matching Cloudflare DurableObjectNamespace.
 */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStubLike;
}

/**
 * Adapter that presents a Cloudflare DurableObjectStub as a KeyPoolContract.
 * Enforces per-tenant DO isolation by communicating strictly with the designated tenant stub.
 */
export class DurableObjectKeyPoolClient implements KeyPoolContract {
  public readonly tenantId: string;
  private readonly stub: DurableObjectStubLike;

  constructor(stub: DurableObjectStubLike, tenantId: string) {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new TenantIsolationError("DurableObjectKeyPoolClient requires a non-empty tenantId");
    }
    this.stub = stub;
    this.tenantId = tenantId;
  }

  /**
   * Returns the underlying Durable Object stub.
   */
  public getStub(): DurableObjectStubLike {
    return this.stub;
  }

  /**
   * Acquires an active API key identifier for an upstream provider from the tenant's DO.
   */
  public async getKey(provider: string): Promise<string> {
    if (!provider || provider.trim().length === 0) {
      throw new InvalidKeyError("Provider parameter is required to acquire key");
    }

    // Direct DO RPC method invocation if supported
    if (typeof this.stub.getKey === "function") {
      try {
        return await this.stub.getKey(provider);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("does not support RPC")) {
          throw err;
        }
      }
    }

    // HTTP fetch RPC fallback
    const res = await this.stub.fetch("http://key-pool/keys/get", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": this.tenantId,
      },
      body: JSON.stringify({ provider, tenantId: this.tenantId }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 429) {
        throw new RateLimitExceededError(
          `Tenant '${this.tenantId}' key pool rate limit exceeded for provider '${provider}': ${errText}`,
          { tenantId: this.tenantId, provider }
        );
      }
      if (res.status === 403) {
        throw new TenantIsolationError(
          `Tenant isolation violation from DO: ${errText}`,
          { tenantId: this.tenantId }
        );
      }
      throw new KeyNotFoundError(
        provider,
        `No available key for provider '${provider}' in tenant '${this.tenantId}' pool: ${errText}`,
        { tenantId: this.tenantId }
      );
    }

    const data = (await res.json()) as {
      keyId?: string;
      key?: { id?: string; ciphertext?: string };
    };
    const resolvedKey = data.keyId ?? data.key?.id ?? data.key?.ciphertext;

    if (!resolvedKey) {
      throw new KeyNotFoundError(
        provider,
        `Tenant '${this.tenantId}' DO returned empty key for provider '${provider}'`,
        { tenantId: this.tenantId }
      );
    }

    return resolvedKey;
  }

  /**
   * Records token usage and microdollar cost against the key in the tenant's DO.
   */
  public async recordUsage(keyId: string, costMicrodollars: bigint): Promise<void> {
    if (typeof this.stub.recordUsage === "function") {
      try {
        return await this.stub.recordUsage(keyId, costMicrodollars);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("does not support RPC")) {
          throw err;
        }
      }
    }

    await this.stub.fetch("http://key-pool/keys/usage", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": this.tenantId,
      },
      body: JSON.stringify({
        keyId,
        costMicrodollars: costMicrodollars.toString(),
        tenantId: this.tenantId,
      }),
    });
  }

  /**
   * Informs the tenant DO circuit breaker of upstream success or failure.
   */
  public async recordResult(keyId: string, success: boolean): Promise<void> {
    if (typeof this.stub.recordResult === "function") {
      try {
        return await this.stub.recordResult(keyId, success);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("does not support RPC")) {
          throw err;
        }
      }
    }

    await this.stub.fetch("http://key-pool/keys/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": this.tenantId,
      },
      body: JSON.stringify({
        keyId,
        success,
        tenantId: this.tenantId,
      }),
    });
  }

  /**
   * Records upstream HTTP status code against the key in the tenant's DO.
   */
  public async recordStatusCode(keyId: string, statusCode: number): Promise<void> {
    if (typeof this.stub.recordStatusCode === "function") {
      try {
        return await this.stub.recordStatusCode(keyId, statusCode);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("does not support RPC")) {
          throw err;
        }
      }
    }

    await this.stub.fetch("http://key-pool/keys/status-code", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": this.tenantId,
      },
      body: JSON.stringify({
        keyId,
        statusCode,
        tenantId: this.tenantId,
      }),
    });
  }

  /**
   * Queries real-time key metrics from the tenant's DO.
   */
  public async getKeyMetrics(keyId: string): Promise<KeyMetrics> {
    if (typeof this.stub.getKeyMetrics === "function") {
      return this.stub.getKeyMetrics(keyId);
    }

    const res = await this.stub.fetch(`http://key-pool/metrics?keyId=${encodeURIComponent(keyId)}`, {
      method: "GET",
      headers: {
        "x-tenant-id": this.tenantId,
      },
    });

    if (!res.ok) {
      throw new KeyNotFoundError(keyId, `Failed to retrieve metrics for key '${keyId}' from DO`);
    }

    const data = (await res.json()) as {
      metrics: {
        rpm: number;
        circuitBreakerTripped: boolean;
        costAccumulatedMicrodollars: string;
      };
    };

    return {
      rpm: data.metrics.rpm,
      circuitBreakerTripped: data.metrics.circuitBreakerTripped,
      costAccumulatedMicrodollars: BigInt(data.metrics.costAccumulatedMicrodollars ?? "0"),
    };
  }

  /**
   * Queries real-time capacity summary for a provider from the tenant's DO.
   */
  public async getCapacitySummary(provider?: string): Promise<CapacitySummary> {
    if (typeof this.stub.getCapacitySummary === "function") {
      return this.stub.getCapacitySummary(provider);
    }

    const url = provider
      ? `http://key-pool/capacity?provider=${encodeURIComponent(provider)}`
      : "http://key-pool/capacity";

    const res = await this.stub.fetch(url, {
      method: "GET",
      headers: {
        "x-tenant-id": this.tenantId,
      },
    });

    if (!res.ok) {
      throw new RouterError("Failed to retrieve capacity summary from DO", {
        statusCode: res.status,
      });
    }

    const data = (await res.json()) as { capacity: CapacitySummary };
    return data.capacity;
  }
}

/**
 * Formats any caught error or exception into a standardized HTTP Response.
 * Injects WWW-Authenticate on 401 and Retry-After on 429.
 */
export function formatRouterError(error: unknown): Response {
  if (error instanceof RateLimitExceededError) {
    const retryAfter = error.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
    return error.toResponse({
      "retry-after": String(retryAfter),
    });
  }

  if (error instanceof QuotaExceededError) {
    return error.toResponse({
      "retry-after": String(DEFAULT_RETRY_AFTER_SECONDS),
    });
  }

  if (error instanceof AuthenticationError) {
    return error.toResponse({
      "www-authenticate": "Bearer",
    });
  }

  if (error instanceof DomainError) {
    return error.toResponse();
  }

  const message = error instanceof Error ? error.message : "Internal edge routing error";
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: "internal_server_error",
        code: "INTERNAL_ROUTING_ERROR",
        statusCode: 500,
      },
    }),
    {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }
  );
}

/**
 * Configuration options for RouterHandler.
 */
export interface RouterHandlerOptions {
  /** Injected AuthMiddleware instance or configuration options */
  authMiddleware?: AuthMiddleware;
  /** Whether to enforce Bearer token authentication (default: true) */
  requireAuth?: boolean;
  /** Injected CascadeRouter instance (overrides per-tenant router creation) */
  router?: CascadeRouter | RouterContract;
  /** Custom factory to build a CascadeRouter per tenant */
  routerFactory?: (
    tenantId: string,
    keyPool: KeyPoolContract,
    env: WorkerEnv
  ) => CascadeRouter | RouterContract;
  /** Custom factory to build a KeyPoolContract per tenant */
  keyPoolFactory?: (tenantId: string, env: WorkerEnv) => KeyPoolContract;
  /** Injected ModelRegistry */
  modelRegistry?: IModelRegistry;
  /** Injected CapabilityFilter */
  capabilityFilter?: CapabilityFilter;
  /** Injected UpstreamClient */
  upstreamClient?: UpstreamClient;
  /** Injected TelemetryEmitter */
  telemetryEmitter?: TelemetryEmitter;
  /** Injected CostLedgerRepository */
  costLedgerRepo?: CostLedgerRepository;
  /** Injected AuthTokensRepository */
  authTokensRepo?: AuthTokensRepository;
  /** Master encryption passphrase/key for D1 repositories */
  masterKey?: KeyInput;
  /** Injectable time provider for deterministic unit testing */
  timeProvider?: () => number;
  /** Default response format: "openai" (OpenAI-compatible payload) or "kc_api" (structured ApiResponse) */
  responseFormat?: "openai" | "kc_api";
}

/**
 * RouterHandler: Cloudflare Worker Edge Handler for Model Routing, DO Dispatch,
 * and Streaming Response Passthrough.
 */
export class RouterHandler {
  private readonly options: RouterHandlerOptions;
  private readonly authMiddleware: AuthMiddleware;
  private readonly modelRegistry: IModelRegistry;
  private readonly capabilityFilter: CapabilityFilter;
  private readonly upstreamClient: UpstreamClient;
  private readonly timeProvider: () => number;

  constructor(options?: RouterHandlerOptions) {
    this.options = options ?? {};
    this.authMiddleware = this.options.authMiddleware ?? new AuthMiddleware();
    this.modelRegistry =
      this.options.modelRegistry ?? new ModelRegistry(ALL_MODEL_DEFINITIONS);
    this.capabilityFilter =
      this.options.capabilityFilter ?? new CapabilityFilter(this.modelRegistry);
    this.upstreamClient = this.options.upstreamClient ?? new UpstreamClient();
    this.timeProvider = this.options.timeProvider ?? (() => Date.now());
  }

  /**
   * Current timestamp in milliseconds.
   */
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

    // Check Cloudflare DurableObjectNamespace binding
    const keyPoolNamespace = env.KEY_POOL as unknown as DurableObjectNamespaceLike | undefined;
    if (keyPoolNamespace && typeof keyPoolNamespace.idFromName === "function") {
      const doId = keyPoolNamespace.idFromName(tenantId);
      const doStub = keyPoolNamespace.get(doId);
      return new DurableObjectKeyPoolClient(doStub, tenantId);
    }

    // Check if injected router already has a keyPool
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

    const masterKey =
      this.options.masterKey ??
      (env.KC_MASTER_KEY ? String(env.KC_MASTER_KEY) : undefined);

    const client =
      this.options.upstreamClient ??
      new UpstreamClient({
        keyResolver: async (keyOrId: string, provider: string) => {
          if (
            keyOrId.startsWith("AIza") ||
            keyOrId.startsWith("gsk_") ||
            keyOrId.startsWith("sk-")
          ) {
            return keyOrId;
          }

          if (env.DB && typeof env.DB.prepare === "function" && masterKey) {
            try {
              const row = await env.DB.prepare(
                "SELECT encrypted_key_b64, nonce_b64 FROM api_keys WHERE id = ?"
              )
                .bind(keyOrId)
                .first<{ encrypted_key_b64: string; nonce_b64: string }>();

              if (row && row.encrypted_key_b64 && row.nonce_b64) {
                return await decryptKey(
                  row.encrypted_key_b64,
                  row.nonce_b64,
                  masterKey
                );
              }
            } catch {
              // Fallback to keyOrId
            }
          }

          return keyOrId;
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
  private getCostLedgerRepo(env: WorkerEnv): CostLedgerRepository | undefined {
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
  private getAuthTokensRepo(env: WorkerEnv): AuthTokensRepository | undefined {
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
  private getTelemetryEmitter(
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
   * Primary entrypoint: handles incoming HTTP requests to the Cloudflare Worker.
   *
   * @param request Inbound HTTP Request
   * @param env Cloudflare Worker environment bindings
   * @param ctx ExecutionContext for non-blocking waitUntil lifecycle management
   * @param preAuthenticatedContext Optional pre-authenticated context from upstream middleware
   */
  public async handle(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    preAuthenticatedContext?: AuthenticatedContext
  ): Promise<Response> {
    const startTime = this.now();
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    // 1. Health check bypass
    if (pathname === "/health" || pathname === "/v1/health") {
      return Response.json({
        status: "healthy",
        version: "0.2.0",
        runtime: "cloudflare-workers",
        timestamp: new Date(startTime).toISOString(),
      });
    }

    // 2. Resolve trace ID from request headers or generate fresh UUID
    const traceId =
      request.headers.get("x-kc-trace-id") ??
      request.headers.get("x-trace-id") ??
      crypto.randomUUID();

    try {
      // 3. Authentication & Tenant Resolution
      let authContext: AuthenticatedContext;

      if (preAuthenticatedContext) {
        authContext = preAuthenticatedContext;
      } else if (this.options.requireAuth !== false) {
        authContext = await this.authMiddleware.authenticate(request, env);
      } else {
        // Unauthenticated mode for testing or internal services
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
      // 5.1 Models catalog: GET /v1/models or GET /models
      if (method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
        return this.handleListModels(request);
      }

      // 5.2 Single model detail: GET /v1/models/:id or GET /models/:id
      if (
        method === "GET" &&
        (pathname.startsWith("/v1/models/") || pathname.startsWith("/models/"))
      ) {
        const parts = pathname.split("/");
        const modelId = parts[parts.length - 1];
        return this.handleGetModel(request, modelId);
      }

      // 5.3 Direct DO Key Management and Metrics Forwarding
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

      // 5.4 Chat completions: POST /v1/chat/completions, POST /chat/completions, POST /v1/route, POST /
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
      // Non-blocking telemetry on error
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

  /**
   * Handles chat completions routing, fallback escalation, and streaming response transformation.
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
    // 1. Validate and extract request parameters
    const modelAliasRaw = body.model ?? body.modelAlias;
    const modelAlias =
      typeof modelAliasRaw === "string" && modelAliasRaw.trim().length > 0
        ? modelAliasRaw.trim()
        : "auto";

    if (body.messages !== undefined && !Array.isArray(body.messages)) {
      throw new RouterError("'messages' parameter must be an array", {
        statusCode: 400,
        code: "INVALID_MESSAGES_PARAMETER",
      });
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const stream = Boolean(body.stream);

    // 2. Pre-calculate estimated prompt tokens for context window check (Golden Test tc-05)
    let estimatedPromptTokens: number | undefined =
      typeof body.estimatedPromptTokens === "number"
        ? body.estimatedPromptTokens
        : undefined;

    if (estimatedPromptTokens === undefined && messages.length > 0) {
      estimatedPromptTokens = CapabilityFilter.estimateTokens(messages);
    }

    // 3. Resolve tenant DO key pool & CascadeRouter
    const keyPool = this.getKeyPool(authContext.tenantId, env);
    const router = this.getRouter(authContext.tenantId, keyPool, env);

    // 4. Construct CascadeRouteRequest
    const maxTokens =
      typeof body.max_tokens === "number"
        ? body.max_tokens
        : typeof body.maxTokens === "number"
        ? body.maxTokens
        : typeof body.max_completion_tokens === "number"
        ? body.max_completion_tokens
        : undefined;

    const temperature =
      typeof body.temperature === "number" ? body.temperature : undefined;

    const cascadeReq: CascadeRouteRequest = {
      modelAlias,
      messages,
      stream,
      temperature,
      maxTokens,
      tools: Array.isArray(body.tools) ? body.tools : undefined,
      functions: Array.isArray(body.functions) ? body.functions : undefined,
      tool_choice: body.tool_choice,
      function_call: body.function_call,
      response_format: body.response_format,
      estimatedPromptTokens,
      signal: request.signal,
      headers: {
        "x-kc-trace-id": traceId,
        "x-kc-tenant-id": authContext.tenantId,
      },
    };

    // 5. Execute routing via CascadeRouter (handles model alias resolution tc-06, capability filter tc-07, and context window tc-05)
    const cascadeRes = (await router.route(cascadeReq)) as CascadeRouteResponse;

    // 6. Handle Streaming vs Non-Streaming Responses
    if (stream) {
      return this.handleStreamingResponse(
        cascadeRes,
        authContext,
        keyPool,
        env,
        ctx,
        traceId,
        startTime
      );
    }

    return await this.handleNonStreamingResponse(
      cascadeRes,
      authContext,
      keyPool,
      env,
      ctx,
      traceId,
      startTime
    );
  }

  /**
   * Handles streaming response passthrough, usage parsing, and non-blocking background ledger & telemetry writes.
   * Conforms to Golden Test tc-02 & GEMINI.md non-blocking telemetry invariant.
   */
  private handleStreamingResponse(
    cascadeRes: CascadeRouteResponse,
    authContext: AuthenticatedContext,
    keyPool: KeyPoolContract,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    traceId: string = crypto.randomUUID(),
    startTime: number = this.now()
  ): Response {
    const upstreamRes = cascadeRes.response;
    const bodyStream = upstreamRes?.body;

    if (!bodyStream) {
      throw new RouterError("Upstream returned empty body for streaming response", {
        statusCode: 502,
        code: "EMPTY_STREAM_BODY",
      });
    }

    let finalized = false;

    // Background task to finalize telemetry, cost calculation, and D1 ledger
    const finalizeStream = async (): Promise<void> => {
      if (finalized) return;
      finalized = true;

      const durationMs = this.now() - startTime;

      // 1. Extract usage from upstream response or transformer
      let usage: StreamUsage | null = null;
      try {
        usage = await upstreamRes?.getUsage(200);
      } catch {
        usage = null;
      }

      // 2. Calculate exact cost in fixed-point microdollars (int64 / bigint)
      let costMicrodollars = 0n;
      if (usage) {
        try {
          costMicrodollars = this.modelRegistry.calculateCost(cascadeRes.model, usage);
        } catch {
          costMicrodollars = 0n;
        }
      }

      // 3. Record key usage on tenant DO
      if (costMicrodollars > 0n && cascadeRes.modelDef?.id) {
        keyPool.recordUsage(cascadeRes.modelDef.id, costMicrodollars).catch(() => {});
      }

      // 4. Record event to D1 Cost Ledger (Golden Test tc-02)
      const costLedgerRepo = this.getCostLedgerRepo(env);
      if (costLedgerRepo) {
        try {
          await costLedgerRepo.recordEvent({
            requestId: traceId,
            tenantId: authContext.tenantId,
            keyId: cascadeRes.modelDef?.id ?? cascadeRes.model,
            provider: cascadeRes.provider,
            modelId: cascadeRes.model,
            promptTokens: usage?.promptTokens ?? 0,
            completionTokens: usage?.completionTokens ?? 0,
            cachedTokens: usage?.cachedTokens ?? 0,
            reasoningTokens: usage?.reasoningTokens ?? 0,
            costMicrodollars,
            latencyMs: durationMs,
            statusCode: 200,
          });
        } catch {
          // Non-blocking telemetry & hot path invariant
        }
      }

      // 5. Update AuthToken spend in D1
      const authTokensRepo = this.getAuthTokensRepo(env);
      if (authContext.token && authTokensRepo && costMicrodollars > 0n) {
        try {
          await authTokensRepo.recordSpend(
            authContext.token.id,
            authContext.tenantId,
            costMicrodollars
          );
        } catch {
          // Non-blocking hot path invariant
        }
      }

      // 6. Emit Non-Blocking Telemetry to Workers Analytics Engine
      const telemetryEmitter = this.getTelemetryEmitter(env, ctx);
      try {
        telemetryEmitter.emit({
          traceId,
          tenantId: authContext.tenantId,
          timestamp: startTime,
          eventType: "chat_completion_stream",
          latencyMs: durationMs,
          costMicrodollars,
          metadata: {
            model: cascadeRes.model,
            provider: cascadeRes.provider,
            statusCode: "200",
            promptTokens: String(usage?.promptTokens ?? 0),
            completionTokens: String(usage?.completionTokens ?? 0),
            totalTokens: String(usage?.totalTokens ?? 0),
          },
        });
      } catch {
        // Non-blocking telemetry invariant
      }
    };

    // Monitor stream chunks and invoke background finalizeStream on stream completion
    const monitorTransform = new TransformStream<Uint8Array | string, Uint8Array | string>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush() {
        const bgWork = finalizeStream();
        if (ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(bgWork);
        }
      },
      cancel() {
        const bgWork = finalizeStream();
        if (ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(bgWork);
        }
      },
    });

    const transformedStream = (bodyStream as ReadableStream<Uint8Array | string>).pipeThrough(
      monitorTransform
    );

    return new Response(transformedStream as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        "x-kc-trace-id": traceId,
        "x-kc-tenant-id": authContext.tenantId,
        "x-kc-model": cascadeRes.model,
        "x-kc-provider": cascadeRes.provider,
      },
    });
  }

  /**
   * Handles non-streaming response generation, cost calculation, and non-blocking D1 ledger logging.
   * Conforms to Golden Test tc-01.
   */
  private async handleNonStreamingResponse(
    cascadeRes: CascadeRouteResponse,
    authContext: AuthenticatedContext,
    keyPool: KeyPoolContract,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    traceId: string = crypto.randomUUID(),
    startTime: number = this.now()
  ): Promise<Response> {
    const durationMs = this.now() - startTime;
    const costMicrodollars = cascadeRes.costMicrodollars;

    // Asynchronous background task for D1 persistence and telemetry
    const postWork = async (): Promise<void> => {
      // 1. Record key usage on tenant DO
      if (costMicrodollars > 0n && cascadeRes.modelDef?.id) {
        keyPool.recordUsage(cascadeRes.modelDef.id, costMicrodollars).catch(() => {});
      }

      // 2. Record event to D1 Cost Ledger (Golden Test tc-01)
      const costLedgerRepo = this.getCostLedgerRepo(env);
      if (costLedgerRepo) {
        try {
          await costLedgerRepo.recordEvent({
            requestId: traceId,
            tenantId: authContext.tenantId,
            keyId: cascadeRes.modelDef?.id ?? cascadeRes.model,
            provider: cascadeRes.provider,
            modelId: cascadeRes.model,
            promptTokens: cascadeRes.usage?.promptTokens ?? 0,
            completionTokens: cascadeRes.usage?.completionTokens ?? 0,
            cachedTokens: cascadeRes.usage?.cachedTokens ?? 0,
            reasoningTokens: cascadeRes.usage?.reasoningTokens ?? 0,
            costMicrodollars,
            latencyMs: durationMs,
            statusCode: 200,
          });
        } catch {
          // Non-blocking hot path invariant
        }
      }

      // 3. Update AuthToken spend in D1
      const authTokensRepo = this.getAuthTokensRepo(env);
      if (authContext.token && authTokensRepo && costMicrodollars > 0n) {
        try {
          await authTokensRepo.recordSpend(
            authContext.token.id,
            authContext.tenantId,
            costMicrodollars
          );
        } catch {
          // Non-blocking hot path invariant
        }
      }

      // 4. Emit Telemetry to Workers Analytics Engine
      const telemetryEmitter = this.getTelemetryEmitter(env, ctx);
      try {
        telemetryEmitter.emit({
          traceId,
          tenantId: authContext.tenantId,
          timestamp: startTime,
          eventType: "chat_completion",
          latencyMs: durationMs,
          costMicrodollars,
          metadata: {
            model: cascadeRes.model,
            provider: cascadeRes.provider,
            statusCode: "200",
            promptTokens: String(cascadeRes.usage?.promptTokens ?? 0),
            completionTokens: String(cascadeRes.usage?.completionTokens ?? 0),
            totalTokens: String(cascadeRes.usage?.totalTokens ?? 0),
          },
        });
      } catch {
        // Non-blocking telemetry invariant
      }
    };

    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(postWork());
    } else {
      await postWork();
    }

    // Format OpenAI-compatible completion response payload
    const payload = {
      id: `chatcmpl-${traceId}`,
      object: "chat.completion",
      created: Math.floor(startTime / 1000),
      model: cascadeRes.model,
      provider: cascadeRes.provider,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: cascadeRes.content,
          },
          finish_reason: "stop",
        },
      ],
      usage: cascadeRes.usage
        ? {
            prompt_tokens: cascadeRes.usage.promptTokens,
            completion_tokens: cascadeRes.usage.completionTokens,
            total_tokens: cascadeRes.usage.totalTokens,
          }
        : {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
      cost_microdollars: costMicrodollars.toString(),
    };

    // Format response based on requested format
    if (this.options.responseFormat === "kc_api") {
      const apiRes = createApiResponse(payload, {
        latencyMs: durationMs,
        costMicrodollars: costMicrodollars.toString(),
        traceId,
        requestId: traceId,
        timestamp: startTime,
        provider: cascadeRes.provider,
        model: cascadeRes.model,
      });
      return new Response(JSON.stringify(apiRes), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-kc-trace-id": traceId,
          "x-kc-tenant-id": authContext.tenantId,
          "x-kc-model": cascadeRes.model,
          "x-kc-provider": cascadeRes.provider,
          "x-kc-cost-microdollars": costMicrodollars.toString(),
        },
      });
    }

    return Response.json(payload, {
      status: 200,
      headers: {
        "x-kc-trace-id": traceId,
        "x-kc-tenant-id": authContext.tenantId,
        "x-kc-model": cascadeRes.model,
        "x-kc-provider": cascadeRes.provider,
        "x-kc-cost-microdollars": costMicrodollars.toString(),
      },
    });
  }

  /**
   * Returns available models in OpenAI-compatible format: GET /v1/models.
   */
  public handleListModels(_request: Request): Response {
    const models = this.modelRegistry.getAllModels(true).map((m) => ({
      id: m.id,
      object: "model",
      created: 1726000000,
      owned_by: m.provider,
      permission: [],
      root: m.id,
      parent: null,
      context_window: m.contextWindow,
      max_output_tokens: m.maxOutputTokens,
      capabilities: {
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
        supportsJsonSchema: m.supportsJsonSchema,
      },
      pricing: {
        input_cost_per_mtok_micro: m.inputCostPerMTokMicro.toString(),
        output_cost_per_mtok_micro: m.outputCostPerMTokMicro.toString(),
        cache_read_cost_per_mtok_micro: m.cacheReadCostPerMTokMicro.toString(),
      },
    }));

    return Response.json({
      object: "list",
      data: models,
    });
  }

  /**
   * Returns a single model detail by ID or alias: GET /v1/models/:id.
   */
  public handleGetModel(_request: Request, modelId: string): Response {
    const model = this.modelRegistry.resolveModel(modelId);
    if (!model) {
      throw new ModelNotFoundError(modelId, `Model '${modelId}' not found in registry`);
    }

    return Response.json({
      id: model.id,
      object: "model",
      created: 1726000000,
      owned_by: model.provider,
      permission: [],
      root: model.id,
      parent: null,
      context_window: model.contextWindow,
      max_output_tokens: model.maxOutputTokens,
      capabilities: {
        supportsTools: model.supportsTools,
        supportsVision: model.supportsVision,
        supportsJsonSchema: model.supportsJsonSchema,
      },
      pricing: {
        input_cost_per_mtok_micro: model.inputCostPerMTokMicro.toString(),
        output_cost_per_mtok_micro: model.outputCostPerMTokMicro.toString(),
        cache_read_cost_per_mtok_micro: model.cacheReadCostPerMTokMicro.toString(),
      },
    });
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

      // Rewrite URL path to strip '/v1' prefix if necessary
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
}

/**
 * Factory function to create a new RouterHandler instance.
 */
export function createRouterHandler(options?: RouterHandlerOptions): RouterHandler {
  return new RouterHandler(options);
}

/**
 * Singleton default instance of RouterHandler.
 */
export const defaultRouterHandler = new RouterHandler();

/**
 * Standalone helper function to route an incoming request through RouterHandler.
 */
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
