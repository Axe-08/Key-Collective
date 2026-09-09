/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * AuthMiddleware: Edge Authentication, Token Validation, RPM Checking & Budget Gating
 *
 * Invariants Enforced (GEMINI.md Constitution & ADR 001):
 * 1. Strict TypeScript: Strict mode, zero `any`.
 * 2. Timing-Safe Cryptographic Comparisons: Constant-time Web Crypto verification for all tokens.
 * 3. No Plaintext Keys/Tokens: Tokens stored as AES-256-GCM ciphertext + SHA-256 index in D1.
 * 4. Fixed-Point Microdollars: All budgets and costs in `int64` / `bigint` microdollars.
 *    Zero floating-point math for financials.
 * 5. Per-Tenant DO Isolation: Zero cross-tenant state.
 * 6. Non-Blocking Edge Hot Path: Lightweight token resolution (<2ms) before DO dispatch.
 */

import { AuthContext, AuthContract } from "../contracts/auth";
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  DEFAULT_RPM_LIMIT,
} from "../constants/limits";
import type { KeyInput } from "../crypto";
import type { DurableObjectStorageLike } from "../durable_objects/circuit_breaker";
import {
  RateLimiter,
  RateLimiterOptions,
  RateLimitCheckResult,
} from "../durable_objects/rate_limiter";
import {
  AuthenticationError,
  TenantIsolationError,
} from "../errors/auth_errors";
import { DomainError } from "../errors/domain_error";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "../errors/key_errors";
import {
  AuthTokenRecord,
  AuthTokensRepository,
  TokenValidationResult,
} from "../storage/repositories/authTokens";

/**
 * Cloudflare Worker environment bindings interface.
 */
export interface WorkerEnv {
  DB?: D1Database;
  KEY_POOL?: DurableObjectNamespace;
  TELEMETRY?: AnalyticsEngineDataset;
  KC_MASTER_KEY?: string;
  [key: string]: unknown;
}

/**
 * Strongly typed authenticated request context passed to downstream handlers.
 * Extends `AuthContext` from domain contracts.
 */
export interface AuthenticatedContext extends AuthContext {
  /** Tenant ID owning the authenticated token */
  tenantId: string;
  /** Boolean flag indicating successful authentication (always true here) */
  isAuthenticated: boolean;
  /** Full validated token domain record from D1 */
  token: AuthTokenRecord;
  /** Effective requests-per-minute limit */
  rpmLimit: number;
  /** Current RPM count consumed in the active sliding window */
  currentRpm: number;
  /** Remaining requests allowed in the active RPM sliding window */
  remainingRpm: number;
  /** Budget ceiling in fixed-point int64 microdollars (0n = unlimited) */
  budgetMicrodollars: bigint;
  /** Spend accumulated so far in fixed-point int64 microdollars */
  spentMicrodollars: bigint;
  /** Remaining budget in microdollars, or undefined if unlimited */
  budgetRemainingMicrodollars?: bigint;
}

/**
 * Configuration options for AuthMiddleware and token authentication.
 */
export interface AuthMiddlewareOptions {
  /** Cloudflare D1 Database binding */
  db?: D1Database;
  /** Master encryption passphrase/key for AuthTokensRepository */
  masterKey?: KeyInput;
  /** Injectable AuthTokensRepository instance */
  authRepo?: AuthTokensRepository;
  /** Required LLM provider name (e.g. 'google', 'openai') to enforce token permissions */
  requiredProvider?: string;
  /** DurableObjectStorageLike instance for RateLimiter counters */
  storage?: DurableObjectStorageLike;
  /** Custom injectable RateLimiter instance */
  rateLimiter?: RateLimiter;
  /** Custom factory to build a RateLimiter per tenant */
  rateLimiterFactory?: (tenantId: string, rpmLimit: number) => RateLimiter;
  /** Explicit RPM limit override */
  rpmLimitOverride?: number;
  /** Estimated cost of the incoming request in microdollars to check against budget */
  costMicrodollars?: bigint;
  /** Injectable time provider for deterministic testing (defaults to Date.now) */
  timeProvider?: () => number;
  /**
   * Whether to throw DomainError on failure (default: true).
   * If false, returns an AuthMiddlewareFailure object.
   */
  throwOnError?: boolean;
}

/**
 * Success result from safe authentication.
 */
export interface AuthMiddlewareSuccess {
  success: true;
  context: AuthenticatedContext;
  error?: never;
  response?: never;
}

/**
 * Failure result from safe authentication containing the HTTP Response and DomainError.
 */
export interface AuthMiddlewareFailure {
  success: false;
  context?: never;
  error: DomainError;
  response: Response;
}

/**
 * Discriminated union for non-throwing authentication.
 */
export type AuthMiddlewareResult =
  | AuthMiddlewareSuccess
  | AuthMiddlewareFailure;

/**
 * In-memory implementation of DurableObjectStorageLike.
 * Enables edge-worker sliding-window rate limiting in local worker memory
 * when persistent DO storage is not explicitly passed.
 */
export class InMemoryRateLimiterStorage implements DurableObjectStorageLike {
  private readonly store = new Map<string, unknown>();

  public async get<T = unknown>(key: string): Promise<T | undefined>;
  public async get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  public async get<T = unknown>(
    keyOrKeys: string | string[]
  ): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(keyOrKeys)) {
      const result = new Map<string, T>();
      for (const k of keyOrKeys) {
        if (this.store.has(k)) {
          result.set(k, this.store.get(k) as T);
        }
      }
      return result;
    }
    return this.store.get(keyOrKeys) as T | undefined;
  }

  public async put<T = unknown>(key: string, value: T): Promise<void>;
  public async put<T = unknown>(entries: Record<string, T>): Promise<void>;
  public async put<T = unknown>(
    keyOrEntries: string | Record<string, T>,
    value?: T
  ): Promise<void> {
    if (typeof keyOrEntries === "string") {
      this.store.set(keyOrEntries, value);
    } else {
      for (const [k, v] of Object.entries(keyOrEntries)) {
        this.store.set(k, v);
      }
    }
  }

  public async delete(key: string): Promise<boolean>;
  public async delete(keys: string[]): Promise<number>;
  public async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    if (Array.isArray(keyOrKeys)) {
      let count = 0;
      for (const k of keyOrKeys) {
        if (this.store.delete(k)) count++;
      }
      return count;
    }
    return this.store.delete(keyOrKeys);
  }

  public async deleteAll(): Promise<void> {
    this.store.clear();
  }

  public async list<T = unknown>(options?: {
    prefix?: string;
  }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const prefix = options?.prefix ?? "";
    for (const [k, v] of this.store.entries()) {
      if (k.startsWith(prefix)) {
        result.set(k, v as T);
      }
    }
    return result;
  }
}

/**
 * Extracts and validates the Bearer token string from a Request, Headers, or raw string.
 *
 * @throws AuthenticationError if missing, malformed, or empty.
 */
export function extractBearerToken(
  input: Request | Headers | string | null | undefined
): string {
  if (input === null || input === undefined) {
    throw new AuthenticationError("Missing Authorization header", {
      reason: "missing_token",
    });
  }

  let authHeader: string | null = null;

  if (typeof input === "string") {
    authHeader = input.trim();
  } else if ("headers" in input && typeof input.headers.get === "function") {
    authHeader = input.headers.get("authorization");
  } else {
    authHeader = (input as unknown as Headers).get("authorization");
  }

  if (!authHeader || authHeader.trim().length === 0) {
    throw new AuthenticationError("Missing Authorization header", {
      reason: "missing_token",
    });
  }

  const trimmed = authHeader.trim();
  const bearerRegex = /^bearer\s*(.*)$/i;
  const match = bearerRegex.exec(trimmed);

  if (!match) {
    throw new AuthenticationError(
      "Malformed Authorization header: Bearer scheme required",
      { reason: "malformed_header" }
    );
  }

  const token = match[1] ? match[1].trim() : "";
  if (token.length === 0) {
    throw new AuthenticationError("Bearer token cannot be empty", {
      reason: "missing_token",
    });
  }

  return token;
}

/**
 * Converts any DomainError or thrown exception into a standard JSON HTTP Response.
 * Automatically injects `WWW-Authenticate` for 401 and `Retry-After` for 429.
 */
export function formatAuthError(error: unknown): Response {
  if (error instanceof RateLimitExceededError) {
    return error.toResponse();
  }

  if (error instanceof QuotaExceededError) {
    return error.toResponse({
      "retry-after": String(DEFAULT_RETRY_AFTER_SECONDS),
    });
  }

  if (error instanceof AuthenticationError) {
    return error.toResponse();
  }

  if (error instanceof DomainError) {
    return error.toResponse();
  }

  const message =
    error instanceof Error ? error.message : "Internal authentication error";
  return new Response(
    JSON.stringify({
      error: message,
      code: "INTERNAL_AUTH_ERROR",
      statusCode: 500,
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
 * Resolves an AuthTokensRepository from options or environment bindings.
 */
function resolveAuthTokensRepository(
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
   *
   * @throws AuthenticationError (401) on invalid/expired token
   * @throws QuotaExceededError (429) on budget exhaustion
   * @throws RateLimitExceededError (429) on RPM limit breach
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

    // 6. Sliding-Window RPM Rate Limiting
    const effectiveRpm =
      mergedOptions.rpmLimitOverride ?? record.rpmLimit ?? DEFAULT_RPM_LIMIT;
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
 *
 * @param handler Target route handler receiving authenticated context
 * @param options AuthMiddleware configuration options
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
