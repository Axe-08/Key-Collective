/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Tenant and Routing Configuration Types
 *
 * Invariants:
 * - Strict mode, no `any`.
 * - Fixed-point microdollars (int64 microdollars, 1 USD = 1,000,000 µ$). Zero floating-point math.
 * - Multi-tenant isolation: strict per-tenant configuration and RPM/circuit-breaker thresholds.
 */

import { ModelProvider } from "./models";

/**
 * Key routing strategy employed when selecting a model or key.
 */
export type RoutingStrategy =
  | "cost-optimal"
  | "lowest-latency"
  | "priority"
  | "round-robin"
  | "load-balanced"
  | "cascade";

export const ROUTING_STRATEGIES: readonly RoutingStrategy[] = [
  "cost-optimal",
  "lowest-latency",
  "priority",
  "round-robin",
  "load-balanced",
  "cascade",
] as const;

/**
 * Configuration for key and model routing.
 */
export interface KeyRoutingConfig {
  /** Primary routing strategy */
  strategy: RoutingStrategy;
  /** Logical alias mappings to canonical models or priority-ordered model chains */
  modelMappings?: Record<string, string | string[]>;
  /** Ordered provider priority list */
  providerPriority?: ModelProvider[];
  /** Explicit list of allowed model providers for this tenant */
  allowedProviders?: ModelProvider[];
  /** Whether to filter candidates based on required capabilities (tools, vision, JSON schema) */
  enforceCapabilityFiltering?: boolean;
}

/**
 * Triggers that initiate fallback logic.
 */
export type FallbackTrigger =
  | "rate_limit"
  | "circuit_breaker_open"
  | "upstream_error"
  | "timeout"
  | "context_overflow";

export const FALLBACK_TRIGGERS: readonly FallbackTrigger[] = [
  "rate_limit",
  "circuit_breaker_open",
  "upstream_error",
  "timeout",
  "context_overflow",
] as const;

/**
 * Configuration for automatic fallback strategies across models and providers.
 */
export interface FallbackConfig {
  /** Whether automated fallback routing is enabled */
  enabled: boolean;
  /** Maximum number of fallback attempts per request */
  maxRetries: number;
  /** Explicit model fallback chains, e.g. { "gpt-4o": ["claude-3-5-sonnet", "gemini-2.0-flash"] } */
  fallbackChains?: Record<string, string[]>;
  /** Provider-level fallback order */
  providerFallbackOrder?: ModelProvider[];
  /** Backoff delay in milliseconds before attempting next fallback */
  backoffMs?: number;
  /** List of triggers that should activate fallback */
  triggers?: FallbackTrigger[];
}

/**
 * RPM (requests per minute) and RPD (requests per day) threshold configuration per provider.
 */
export interface RateLimitConfig {
  /** Default tenant-wide RPM limit across all providers */
  defaultRpmLimit: number;
  /** Optional tenant-wide RPD limit across all providers */
  defaultRpdLimit?: number;
  /** Provider-specific RPM threshold overrides */
  providerRpmLimits?: Partial<Record<ModelProvider, number>>;
  /** Sliding window duration in seconds (defaults to 60) */
  windowSizeSeconds?: number;
}

/**
 * Circuit breaker thresholds and cooldown settings.
 * In accordance with LLD 1.3: DEFAULT_CIRCUIT_BREAKER_THRESHOLD consecutive failures.
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before tripping the circuit breaker */
  failureThreshold: number;
  /** Cooldown duration in seconds before testing half-open state */
  cooldownSeconds: number;
  /** Number of successful probe requests in half-open state before closing */
  halfOpenSuccessThreshold?: number;
  /** HTTP status codes that count toward tripping the circuit (e.g. [429, 500, 502, 503, 504]) */
  trippingStatusCodes?: number[];
}

/**
 * Financial budget configuration for a tenant.
 * Uses fixed-point microdollars (int64) to strictly prohibit floating point math.
 */
export interface TenantBudgetConfig<TCost = bigint> {
  /** Maximum allowed spend in microdollars */
  maxBudgetMicrodollars: TCost;
  /** Current spend in microdollars */
  spentMicrodollars: TCost;
  /** Policy when budget is exhausted: "block" (reject with 429) or "warn" (emit telemetry) */
  onExhaustion?: "block" | "warn";
  /** Budget consumption percentage (0-100) at which warning alerts fire */
  alertThresholdPercent?: number;
}

/**
 * TenantConfig specifies key routing, fallback strategies, and RPM thresholds per model provider.
 * As defined in LLD 2.3:
 * "TenantConfig: Configuration specifying key routing, fallback strategies, and RPM thresholds per model provider."
 */
export interface TenantConfig<TCost = bigint> {
  /** Unique tenant identifier */
  tenantId: string;
  /** Optional human-readable tenant name */
  tenantName?: string;
  /** Whether the tenant account is active */
  isActive: boolean;
  /** Key routing configuration */
  routing: KeyRoutingConfig;
  /** Fallback strategies */
  fallback: FallbackConfig;
  /** RPM thresholds globally and per model provider */
  rateLimits: RateLimitConfig;
  /** Circuit breaker thresholds and cooldown */
  circuitBreaker: CircuitBreakerConfig;
  /** Optional financial budget cap in microdollars */
  budget?: TenantBudgetConfig<TCost>;
  /** Optional tenant metadata or tags */
  metadata?: Record<string, string>;
  /** Timestamp when configuration was created */
  createdAt?: number | string;
  /** Timestamp when configuration was last updated */
  updatedAt?: number | string;
}

/**
 * Input options for creating or updating a TenantConfig.
 * Permits partial defaults for routing, fallback, rateLimits, and circuitBreaker.
 */
export interface TenantConfigOptions<TCost = bigint> {
  tenantName?: string;
  isActive?: boolean;
  routing?: Partial<KeyRoutingConfig>;
  fallback?: Partial<FallbackConfig>;
  rateLimits?: Partial<RateLimitConfig>;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  budget?: TenantBudgetConfig<TCost>;
  metadata?: Record<string, string>;
  createdAt?: number | string;
  updatedAt?: number | string;
}

/**
 * Default routing configuration.
 */
export const DEFAULT_KEY_ROUTING_CONFIG: KeyRoutingConfig = {
  strategy: "cost-optimal",
  enforceCapabilityFiltering: true,
};

/**
 * Default fallback configuration.
 */
export const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  enabled: true,
  maxRetries: 3,
  backoffMs: 250,
  triggers: ["rate_limit", "circuit_breaker_open", "upstream_error", "timeout"],
};

/**
 * Default rate limit configuration.
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  defaultRpmLimit: 60,
  defaultRpdLimit: 1500,
  windowSizeSeconds: 60,
  providerRpmLimits: {},
};

/**
 * Default circuit breaker configuration.
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownSeconds: 60,
  halfOpenSuccessThreshold: 1,
  trippingStatusCodes: [429, 500, 502, 503, 504],
};

/**
 * Factory to create a TenantConfig with sensible production defaults.
 */
export function createTenantConfig<TCost = bigint>(
  tenantId: string,
  options?: TenantConfigOptions<TCost>
): TenantConfig<TCost> {
  return {
    tenantId,
    tenantName: options?.tenantName,
    isActive: options?.isActive ?? true,
    routing: {
      ...DEFAULT_KEY_ROUTING_CONFIG,
      ...options?.routing,
    },
    fallback: {
      ...DEFAULT_FALLBACK_CONFIG,
      ...options?.fallback,
    },
    rateLimits: {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      ...options?.rateLimits,
      providerRpmLimits: {
        ...DEFAULT_RATE_LIMIT_CONFIG.providerRpmLimits,
        ...options?.rateLimits?.providerRpmLimits,
      },
    },
    circuitBreaker: {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      ...options?.circuitBreaker,
    },
    budget: options?.budget,
    metadata: options?.metadata,
    createdAt: options?.createdAt ?? Date.now(),
    updatedAt: options?.updatedAt ?? Date.now(),
  };
}

/**
 * Type guard for RoutingStrategy.
 */
export function isRoutingStrategy(value: unknown): value is RoutingStrategy {
  return (
    typeof value === "string" &&
    (ROUTING_STRATEGIES as readonly string[]).includes(value)
  );
}

/**
 * Type guard for FallbackTrigger.
 */
export function isFallbackTrigger(value: unknown): value is FallbackTrigger {
  return (
    typeof value === "string" &&
    (FALLBACK_TRIGGERS as readonly string[]).includes(value)
  );
}

/**
 * Type guard for CircuitBreakerConfig.
 */
export function isCircuitBreakerConfig(value: unknown): value is CircuitBreakerConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.failureThreshold === "number" &&
    typeof candidate.cooldownSeconds === "number"
  );
}

/**
 * Type guard for RateLimitConfig.
 */
export function isRateLimitConfig(value: unknown): value is RateLimitConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.defaultRpmLimit === "number";
}

/**
 * Type guard for TenantConfig.
 */
export function isTenantConfig<TCost = bigint>(value: unknown): value is TenantConfig<TCost> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.tenantId !== "string" ||
    typeof candidate.isActive !== "boolean" ||
    typeof candidate.routing !== "object" ||
    candidate.routing === null ||
    typeof candidate.fallback !== "object" ||
    candidate.fallback === null ||
    typeof candidate.rateLimits !== "object" ||
    candidate.rateLimits === null ||
    typeof candidate.circuitBreaker !== "object" ||
    candidate.circuitBreaker === null
  ) {
    return false;
  }

  const routing = candidate.routing as Record<string, unknown>;
  const fallback = candidate.fallback as Record<string, unknown>;

  return (
    isRoutingStrategy(routing.strategy) &&
    typeof fallback.enabled === "boolean" &&
    typeof fallback.maxRetries === "number" &&
    isRateLimitConfig(candidate.rateLimits) &&
    isCircuitBreakerConfig(candidate.circuitBreaker)
  );
}
