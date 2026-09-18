/**
 * @file types.ts
 * AuthMiddleware domain types and request context contracts.
 */

import { AuthContext } from "../../contracts/auth";
import { hashToken, type KeyInput } from "../../crypto";
import type { DurableObjectStorageLike } from "../../durable_objects/circuit_breaker";
import { RateLimiter } from "../../durable_objects/rate_limiter";
import { DomainError } from "../../errors/domain_error";
import {
  AuthTokenRecord,
  AuthTokensRepository,
} from "../../storage/repositories/auth_tokens/index";

/**
 * Cloudflare Worker environment bindings interface.
 */
export interface WorkerEnv {
  DB?: D1Database;
  KEY_POOL?: DurableObjectNamespace;
  TENANT_QUOTA?: DurableObjectNamespace;
  TELEMETRY?: AnalyticsEngineDataset;
  KC_MASTER_KEY?: string;
  ASSETS?: { fetch(request: Request | string): Promise<Response> };
  REPORT_WEBHOOK_SECRET?: string;
  MIDNIGHT_FREEZE?: string;
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
  /** Optional TenantQuota DurableObject namespace override */
  tenantQuota?: DurableObjectNamespace;
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
