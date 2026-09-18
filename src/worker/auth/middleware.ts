/**
 * @file middleware.ts
 * Core AuthMiddleware implementation, request interceptor, and higher-order route wrappers.
 */

import { AuthContext, AuthContract } from "../../contracts/auth";
import {
  DEFAULT_RPM_LIMIT,
} from "../../constants/limits";
import { hashToken } from "../../crypto";
import {
  RateLimiter,
  RateLimitCheckResult,
} from "../../durable_objects/rate_limiter";
import {
  AuthenticationError,
  TenantIsolationError,
} from "../../errors/auth_errors";
import { DomainError } from "../../errors/domain_error";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "../../errors/key_errors";
import {
  AuthTokensRepository,
} from "../../storage/repositories/auth_tokens/index";
import {
  WorkerEnv,
  AuthenticatedContext,
  AuthMiddlewareOptions,
  AuthMiddlewareResult,
} from "./types";
import { InMemoryRateLimiterStorage } from "./storage";
import { extractBearerToken } from "./token_extractor";
import { formatAuthError } from "./error_formatter";

/**
 * Resolves an AuthTokensRepository from options or environment bindings.
 */
export function resolveAuthTokensRepository(
  env?: WorkerEnv | D1Database,
  options?: AuthMiddlewareOptions
): AuthTokensRepository {
  if (options?.authRepo) {
    return options.authRepo;
  }

  let db: D1Database | undefined = options?.db;

  if (!db && env) {
    if (typeof (env as D1Database).prepare === "function") {
      db = env as D1Database;
    } else if ((env as WorkerEnv).DB) {
      db = (env as WorkerEnv).DB;
    }
  }

  if (!db) {
    throw new AuthenticationError(
      "D1 database binding (DB) is required for authentication lookup",
      { reason: "missing_db_binding" }
    );
  }

  const masterKey =
    options?.masterKey ??
    (env && !(typeof (env as D1Database).prepare === "function")
      ? (env as WorkerEnv).KC_MASTER_KEY
      : undefined);

  return new AuthTokensRepository(db, { masterKey });
}

/**
 * AuthMiddleware implementation.
 *
 * Implements `AuthContract` from domain contracts.
 */
export class AuthMiddleware implements AuthContract {
  private readonly defaultOptions: AuthMiddlewareOptions;
  private readonly inMemoryStorage: InMemoryRateLimiterStorage;
  private readonly rateLimiters = new Map<string, RateLimiter>();

  constructor(options?: AuthMiddlewareOptions) {
    this.defaultOptions = options ?? {};
    this.inMemoryStorage = new InMemoryRateLimiterStorage();
  }

  /**
   * Resolves or creates a RateLimiter instance for a tenant and token.
   */
  private getRateLimiter(
    tenantId: string,
    rpmLimit: number,
    options?: AuthMiddlewareOptions
  ): RateLimiter {
    if (options?.rateLimiter) {
      return options.rateLimiter;
    }

    if (options?.rateLimiterFactory) {
      return options.rateLimiterFactory(tenantId, rpmLimit);
    }

    if (this.defaultOptions.rateLimiter) {
      return this.defaultOptions.rateLimiter;
    }

    if (this.defaultOptions.rateLimiterFactory) {
      return this.defaultOptions.rateLimiterFactory(tenantId, rpmLimit);
    }

    const cacheKey = `${tenantId}:${rpmLimit}`;
    let limiter = this.rateLimiters.get(cacheKey);

    if (!limiter) {
      const storage =
        options?.storage ??
        this.defaultOptions.storage ??
        this.inMemoryStorage;
      const timeProvider =
        options?.timeProvider ?? this.defaultOptions.timeProvider;

      limiter = new RateLimiter(storage, {
        tenantId,
        rpmLimit,
        timeProvider,
      });
      this.rateLimiters.set(cacheKey, limiter);
    }

    return limiter;
  }

  /**
   * Clears cached rate limiter instances and in-memory storage.
   */
  public clearRateLimiters(): void {
    this.rateLimiters.clear();
    void this.inMemoryStorage.deleteAll();
  }

  /**
   * Implements `AuthContract.verifyToken(bearerToken: string): Promise<AuthContext>`.
   */
  public async verifyToken(bearerToken: string): Promise<AuthContext> {
    const rawToken = extractBearerToken(bearerToken);
    const repo = resolveAuthTokensRepository(undefined, this.defaultOptions);
    const record = await repo.findByToken(rawToken);

    if (!record) {
      throw new AuthenticationError("Invalid bearer token", {
        reason: "invalid_token",
      });
    }

    const now = this.defaultOptions.timeProvider
      ? this.defaultOptions.timeProvider()
      : Date.now();

    if (record.expiresAt && now >= new Date(record.expiresAt).getTime()) {
      throw new AuthenticationError("Bearer token has expired", {
        reason: "expired_token",
      });
    }

    return {
      tenantId: record.tenantId,
      isAuthenticated: true,
    };
  }

  /**
   * Authenticates an incoming HTTP Request against D1, checking format,
   * expiration, provider allowances, budget gating, and sliding-window RPM limits.
   */
  public async authenticate(
    request: Request,
    env?: WorkerEnv | D1Database,
    options?: AuthMiddlewareOptions
  ): Promise<AuthenticatedContext> {
    const mergedOptions: AuthMiddlewareOptions = {
      ...this.defaultOptions,
      ...options,
    };

    const timeProvider = mergedOptions.timeProvider ?? (() => Date.now());
    const now = timeProvider();

    // 1. Token extraction & syntax validation
    const rawToken = extractBearerToken(request);

    // 2. D1 Lookup with SHA-256 hash & constant-time comparison
    const repo = resolveAuthTokensRepository(env, mergedOptions);
    const record = await repo.findByToken(rawToken);

    if (!record) {
      // 2.1 Check if matching master key
      const masterKey =
        mergedOptions.masterKey ??
        (env && !(typeof (env as D1Database).prepare === "function")
          ? (env as WorkerEnv).KC_MASTER_KEY
          : undefined);

      if (masterKey && rawToken === masterKey) {
        return {
          tenantId: "admin",
          isAuthenticated: true,
          token: {
            id: "master_key",
            hashSha256: await hashToken(rawToken),
            tenantId: "admin",
            budgetMicrodollars: 0n,
            spentMicrodollars: 0n,
            allowedProviders: [],
            rpmLimit: 10000,
            expiresAt: null,
            createdAt: new Date(now).toISOString(),
          },
          rpmLimit: 10000,
          currentRpm: 1,
          remainingRpm: 9999,
          budgetMicrodollars: 0n,
          spentMicrodollars: 0n,
        };
      }

      // 2.2 Check if ephemeral rotating demo token (kc_demo_*)
      if (rawToken.startsWith("kc_demo_")) {
        const demoPool = (env as { DEMO_POOL?: DurableObjectNamespace })?.DEMO_POOL;
        if (demoPool) {
          const clientIp = request.headers.get("cf-connecting-ip") ?? "127.0.0.1";
          const doId = demoPool.idFromName("global_demo_pool");
          const stub = demoPool.get(doId);
          const consumeRes = await stub.fetch("http://demo/consume", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: rawToken, ip: clientIp }),
          });
          const consumeData = (await consumeRes.json().catch(() => ({}))) as {
            allowed?: boolean;
            error?: string;
            rateLimit?: { rpmLimit?: number; currentRpm?: number; remainingRpm?: number };
          };
          if (!consumeData.allowed) {
            throw new AuthenticationError(consumeData.error || "Invalid or expired demo token", {
              reason: "invalid_token",
            });
          }
          return {
            tenantId: "demo",
            isAuthenticated: true,
            token: {
              id: `demo_${rawToken.slice(0, 16)}`,
              hashSha256: await hashToken(rawToken),
              tenantId: "demo",
              budgetMicrodollars: 1_000_000n, // $1 demo budget
              spentMicrodollars: 0n,
              allowedProviders: [],
              rpmLimit: consumeData.rateLimit?.rpmLimit ?? 3,
              expiresAt: null,
              createdAt: new Date(now).toISOString(),
            },
            rpmLimit: consumeData.rateLimit?.rpmLimit ?? 3,
            currentRpm: consumeData.rateLimit?.currentRpm ?? 1,
            remainingRpm: consumeData.rateLimit?.remainingRpm ?? 2,
            budgetMicrodollars: 1_000_000n,
            spentMicrodollars: 0n,
          };
        }
      }

      throw new AuthenticationError("Invalid bearer token", {
        reason: "invalid_token",
      });
    }

    // 3. Expiration Check
    if (record.expiresAt) {
      const expiresAtMs = new Date(record.expiresAt).getTime();
      if (now >= expiresAtMs) {
        throw new AuthenticationError("Bearer token has expired", {
          reason: "expired_token",
        });
      }
    }

    // 4. Allowed Providers Check
    const requiredProvider = mergedOptions.requiredProvider;
    if (requiredProvider && record.allowedProviders.length > 0) {
      const normalizedRequired = requiredProvider.toLowerCase().trim();
      const isAllowed = record.allowedProviders.some(
        (p) => p.toLowerCase().trim() === normalizedRequired
      );
      if (!isAllowed) {
        throw new AuthenticationError(
          `Provider '${requiredProvider}' is not allowed for this authentication token`,
          {
            reason: "provider_not_allowed",
            details: {
              requiredProvider,
              allowedProviders: record.allowedProviders,
            },
          }
        );
      }
    }

    // 5. Budget Gating (Fixed-point int64 microdollars, zero floats)
    const budget = record.budgetMicrodollars;
    const spent = record.spentMicrodollars;
    const incomingCost = mergedOptions.costMicrodollars ?? 0n;

    if (budget > 0n) {
      // Check if already exhausted
      if (spent >= budget) {
        throw new QuotaExceededError(
          `Tenant budget ceiling reached: token budget exhausted (${spent}/${budget} µ$)`,
          {
            tenantId: record.tenantId,
            quotaType: "spend_limit",
            limit: budget,
            consumed: spent,
          }
        );
      }

      // Check if incoming cost exceeds headroom
      if (incomingCost > 0n && spent + incomingCost > budget) {
        throw new QuotaExceededError(
          `Estimated request cost exceeds remaining tenant budget`,
          {
            tenantId: record.tenantId,
            quotaType: "spend_limit",
            limit: budget,
            consumed: spent,
          }
        );
      }
    }

    // 6. Sliding-Window RPM Rate Limiting & Quota Consumption
    const effectiveRpm =
      mergedOptions.rpmLimitOverride ?? record.rpmLimit ?? DEFAULT_RPM_LIMIT;

    const tenantQuota =
      env &&
      typeof env === "object" &&
      !(typeof (env as D1Database).prepare === "function") &&
      "TENANT_QUOTA" in env &&
      (env as WorkerEnv).TENANT_QUOTA
        ? (env as WorkerEnv).TENANT_QUOTA
        : mergedOptions.tenantQuota;

    if (tenantQuota) {
      const targetTenantId = record.tenantId;
      const doId = tenantQuota.idFromName(targetTenantId);
      let stub: any = doId;
      if (typeof tenantQuota.get === "function") {
        if (typeof stub?.consumeQuota !== "function" && typeof stub?.fetch !== "function") {
          stub = tenantQuota.get(stub);
        } else {
          try {
            const fromGet = tenantQuota.get(stub) as any;
            if (fromGet && (typeof fromGet.consumeQuota === "function" || typeof fromGet.fetch === "function")) {
              stub = fromGet;
            }
          } catch {
            // Keep stub
          }
        }
      }

      const projectId =
        request.headers.get("x-project-id") ??
        request.headers.get("kc-project-id") ??
        undefined;

      let currentRpm: number;
      let remainingRpm: number;
      let effectiveRpmLimit: number = effectiveRpm;

      if (typeof stub?.consumeQuota === "function") {
        const consumeReq: any = {
          tenantId: targetTenantId,
          costMicrodollars: incomingCost,
          count: 1,
        };
        if (projectId) {
          consumeReq.projectId = projectId;
        }
        if (mergedOptions.rpmLimitOverride !== undefined) {
          consumeReq.projectMaxSubCap = mergedOptions.rpmLimitOverride;
        }

        const quotaResult = await stub.consumeQuota(consumeReq);

        if (!quotaResult.allowed) {
          const errorCode = quotaResult.errorCode ?? quotaResult.error_code;
          if (
            errorCode === "USER_DAILY_QUOTA_EXHAUSTED" ||
            quotaResult.reason === "rpd_limit_exceeded"
          ) {
            throw new QuotaExceededError(
              quotaResult.error ??
                `Daily request quota exceeded for tenant '${targetTenantId}': RPD limit reached (${quotaResult.currentRpd}/${quotaResult.rpdLimit})`,
              {
                tenantId: targetTenantId,
                quotaType: "rpd",
                limit: quotaResult.rpdLimit,
                consumed: quotaResult.currentRpd,
              }
            );
          }

          const retryAfter =
            quotaResult.retryAfterSeconds ??
            quotaResult.retry_after_seconds ??
            60;
          throw new RateLimitExceededError(
            quotaResult.error ??
              `Rate limit exceeded for tenant '${targetTenantId}': RPM limit reached (${quotaResult.currentRpm}/${quotaResult.rpmLimit})`,
            {
              tenantId: targetTenantId,
              keyId: record.id,
              rpmLimit: quotaResult.rpmLimit ?? effectiveRpm,
              currentRpm: quotaResult.currentRpm ?? effectiveRpm,
              retryAfterSeconds: retryAfter,
            }
          );
        }

        currentRpm = quotaResult.currentRpm;
        effectiveRpmLimit = quotaResult.rpmLimit ?? effectiveRpm;
        remainingRpm =
          quotaResult.remainingRpm ??
          Math.max(0, effectiveRpmLimit - currentRpm);
      } else if (typeof stub?.fetch === "function") {
        const res = await stub.fetch("http://tenant-quota/consume", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-tenant-id": targetTenantId,
            ...(projectId ? { "x-project-id": projectId } : {}),
          },
          body: JSON.stringify({
            tenantId: targetTenantId,
            costMicrodollars: incomingCost.toString(),
            count: 1,
            ...(projectId ? { projectId } : {}),
            ...(mergedOptions.rpmLimitOverride !== undefined
              ? { projectMaxSubCap: mergedOptions.rpmLimitOverride }
              : {}),
          }),
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as Record<string, any>;
          if (res.status === 403) {
            throw new TenantIsolationError(
              data.error ??
                `Tenant isolation violation for tenant '${targetTenantId}'`,
              { tenantId: targetTenantId }
            );
          }

          const errorCode = data.errorCode ?? data.error_code ?? data.code;
          if (
            errorCode === "USER_DAILY_QUOTA_EXHAUSTED" ||
            data.reason === "rpd_limit_exceeded"
          ) {
            throw new QuotaExceededError(
              data.error ??
                `Daily request quota exceeded for tenant '${targetTenantId}'`,
              {
                tenantId: targetTenantId,
                quotaType: "rpd",
                limit: data.rpdLimit,
                consumed: data.currentRpd,
              }
            );
          }

          const retryHeader = res.headers?.get?.("retry-after");
          const retryAfterSeconds = retryHeader
            ? parseInt(retryHeader, 10)
            : (data.retryAfterSeconds ?? data.retry_after_seconds ?? 60);

          throw new RateLimitExceededError(
            data.error ??
              `Rate limit exceeded for tenant '${targetTenantId}': RPM limit reached`,
            {
              tenantId: targetTenantId,
              keyId: record.id,
              rpmLimit: data.rpmLimit ?? effectiveRpm,
              currentRpm: data.currentRpm ?? effectiveRpm,
              retryAfterSeconds: isNaN(retryAfterSeconds) ? 60 : retryAfterSeconds,
            }
          );
        }

        const data = (await res.json().catch(() => ({}))) as Record<string, any>;
        if (data.allowed === false) {
          const retryHeader = res.headers?.get?.("retry-after");
          const retryAfterSeconds = retryHeader
            ? parseInt(retryHeader, 10)
            : (data.retryAfterSeconds ?? data.retry_after_seconds ?? 60);

          throw new RateLimitExceededError(
            data.error ??
              `Rate limit exceeded for tenant '${targetTenantId}': RPM limit reached`,
            {
              tenantId: targetTenantId,
              keyId: record.id,
              rpmLimit: data.rpmLimit ?? effectiveRpm,
              currentRpm: data.currentRpm ?? effectiveRpm,
              retryAfterSeconds: isNaN(retryAfterSeconds) ? 60 : retryAfterSeconds,
            }
          );
        }

        currentRpm = data.currentRpm ?? 1;
        effectiveRpmLimit = data.rpmLimit ?? effectiveRpm;
        remainingRpm =
          data.remainingRpm ?? Math.max(0, effectiveRpmLimit - currentRpm);
      } else {
        throw new AuthenticationError(
          `Tenant quota stub for '${targetTenantId}' does not support RPC or fetch`,
          { reason: "invalid_tenant_quota_stub" }
        );
      }

      const budgetRemainingMicrodollars =
        budget > 0n ? budget - spent : undefined;

      return {
        tenantId: record.tenantId,
        isAuthenticated: true,
        token: record,
        rpmLimit: effectiveRpmLimit,
        currentRpm,
        remainingRpm,
        budgetMicrodollars: budget,
        spentMicrodollars: spent,
        budgetRemainingMicrodollars,
      };
    }

    // Fallback: in-memory RateLimiter when env.TENANT_QUOTA is undefined
    const limiter = this.getRateLimiter(
      record.tenantId,
      effectiveRpm,
      mergedOptions
    );

    const checkResult: RateLimitCheckResult =
      await limiter.checkLimitDetailed(record.id, incomingCost);

    if (!checkResult.allowed) {
      if (checkResult.reason === "rpm_limit_exceeded") {
        throw new RateLimitExceededError(
          `Rate limit exceeded for tenant '${record.tenantId}': RPM limit reached (${checkResult.currentRpm}/${checkResult.rpmLimit})`,
          {
            tenantId: record.tenantId,
            keyId: record.id,
            rpmLimit: checkResult.rpmLimit,
            currentRpm: checkResult.currentRpm,
            retryAfterSeconds: checkResult.retryAfterSeconds,
          }
        );
      }

      if (checkResult.reason === "rpd_limit_exceeded") {
        throw new QuotaExceededError(
          `Daily request quota exceeded for tenant '${record.tenantId}': RPD limit reached (${checkResult.currentRpd}/${checkResult.rpdLimit})`,
          {
            tenantId: record.tenantId,
            quotaType: "rpd",
            limit: checkResult.rpdLimit,
            consumed: checkResult.currentRpd,
          }
        );
      }

      throw new QuotaExceededError(
        `Financial budget ceiling exceeded for tenant '${record.tenantId}'`,
        {
          tenantId: record.tenantId,
          quotaType: "spend_limit",
          limit: checkResult.maxBudgetMicrodollars,
          consumed: checkResult.costAccumulatedMicrodollars,
        }
      );
    }

    // Increment sliding window counter upon successful admission
    await limiter.increment(record.id, incomingCost);

    // Calculate remaining metrics
    const currentRpm = checkResult.currentRpm + 1;
    const remainingRpm = Math.max(0, effectiveRpm - currentRpm);
    const budgetRemainingMicrodollars =
      budget > 0n ? budget - spent : undefined;

    return {
      tenantId: record.tenantId,
      isAuthenticated: true,
      token: record,
      rpmLimit: effectiveRpm,
      currentRpm,
      remainingRpm,
      budgetMicrodollars: budget,
      spentMicrodollars: spent,
      budgetRemainingMicrodollars,
    };
  }

  /**
   * Safe authentication method that never throws.
   * Returns a discriminated union `AuthMiddlewareResult`.
   */
  public async authenticateSafe(
    request: Request,
    env?: WorkerEnv | D1Database,
    options?: AuthMiddlewareOptions
  ): Promise<AuthMiddlewareResult> {
    try {
      const context = await this.authenticate(request, env, options);
      return { success: true, context };
    } catch (err: unknown) {
      const error =
        err instanceof DomainError
          ? err
          : new AuthenticationError(
              err instanceof Error ? err.message : String(err),
              { reason: "internal_error" }
            );
      const response = formatAuthError(error);
      return { success: false, error, response };
    }
  }

  /**
   * Middleware handler for intercepting requests and passing context to next handler.
   */
  public async handle(
    request: Request,
    env: WorkerEnv | D1Database,
    next: (ctx: AuthenticatedContext) => Promise<Response>,
    options?: AuthMiddlewareOptions
  ): Promise<Response> {
    try {
      const context = await this.authenticate(request, env, options);
      return await next(context);
    } catch (err: unknown) {
      return formatAuthError(err);
    }
  }
}

/**
 * Singleton default instance of AuthMiddleware.
 */
export const defaultAuthMiddleware = new AuthMiddleware();

/**
 * Standalone helper function to authenticate an incoming request.
 */
export async function authenticateRequest(
  request: Request,
  env?: WorkerEnv | D1Database,
  options?: AuthMiddlewareOptions
): Promise<AuthenticatedContext> {
  return defaultAuthMiddleware.authenticate(request, env, options);
}

/**
 * Higher-order function wrapping a Cloudflare Worker fetch route with AuthMiddleware.
 * Protects downstream routes by verifying bearer tokens, budget, and RPM limits.
 */
export function withAuth(
  handler: (
    request: Request,
    ctx: AuthenticatedContext,
    env: WorkerEnv
  ) => Promise<Response>,
  options?: AuthMiddlewareOptions
): (
  request: Request,
  env: WorkerEnv,
  executionCtx?: ExecutionContext
) => Promise<Response> {
  const middleware = options ? new AuthMiddleware(options) : defaultAuthMiddleware;

  return async (
    request: Request,
    env: WorkerEnv,
    _executionCtx?: ExecutionContext
  ): Promise<Response> => {
    try {
      const authCtx = await middleware.authenticate(request, env, options);
      return await handler(request, authCtx, env);
    } catch (error: unknown) {
      return formatAuthError(error);
    }
  };
}
