/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Tenant, Rate Limiting, and Circuit Breaker Constants
 *
 * Invariants:
 * - Strict tenant compute & memory isolation.
 * - Conforms to LLD 1.3:
 *   - DEFAULT_CIRCUIT_BREAKER_THRESHOLD: Consecutive failures before tripping circuit breaker.
 *   - DEFAULT_RPM_LIMIT: Tenant specific default requests-per-minute limit.
 */

/**
 * Default number of consecutive failures before tripping a provider's circuit breaker to OPEN state.
 * As defined in LLD 1.3.
 */
export const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 3 as const;

/**
 * Default tenant requests-per-minute (RPM) rate limit.
 * As defined in LLD 1.3.
 */
export const DEFAULT_RPM_LIMIT = 60 as const;

/**
 * Default tenant requests-per-day (RPD) quota limit.
 */
export const DEFAULT_RPD_LIMIT = 1500 as const;

/**
 * Sliding window duration in seconds for RPM calculations.
 */
export const DEFAULT_WINDOW_SIZE_SECONDS = 60 as const;

/**
 * Cooldown duration in seconds before testing half-open state after circuit breaker opens.
 */
export const DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SECONDS = 60 as const;

/**
 * Number of consecutive successful probe requests in half-open state required to close the circuit.
 */
export const DEFAULT_CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD = 1 as const;

/**
 * HTTP status codes from upstream providers that count toward tripping the circuit breaker.
 */
export const DEFAULT_CIRCUIT_BREAKER_TRIPPING_STATUS_CODES: readonly number[] = [
  429, // Too Many Requests / Rate Limited
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable / Capacity Overload
  504, // Gateway Timeout
] as const;

/**
 * Default cooldown / retry-after header value in seconds when a rate limit is exceeded.
 */
export const DEFAULT_RETRY_AFTER_SECONDS = 60 as const;

/**
 * Maximum allowable requests per minute for a single tenant or key.
 */
export const MAX_RPM_LIMIT = 100_000 as const;

/**
 * Minimum allowable requests per minute for a configured tenant.
 */
export const MIN_RPM_LIMIT = 1 as const;

/**
 * Default maximum number of fallback retry attempts across candidate routes.
 */
export const DEFAULT_MAX_FALLBACK_RETRIES = 3 as const;

/**
 * Default backoff delay in milliseconds before attempting next fallback route.
 */
export const DEFAULT_FALLBACK_BACKOFF_MS = 250 as const;

/**
 * Validates if an RPM limit falls within valid bounds [MIN_RPM_LIMIT, MAX_RPM_LIMIT].
 */
export function isValidRpmLimit(rpm: unknown): rpm is number {
  return (
    typeof rpm === "number" &&
    Number.isInteger(rpm) &&
    rpm >= MIN_RPM_LIMIT &&
    rpm <= MAX_RPM_LIMIT
  );
}

/**
 * Validates if a circuit breaker failure threshold is a positive integer.
 */
export function isValidCircuitBreakerThreshold(threshold: unknown): threshold is number {
  return (
    typeof threshold === "number" &&
    Number.isInteger(threshold) &&
    threshold >= 1
  );
}
