/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Routing and Upstream Provider Errors
 *
 * Conforms to LLD 3.2:
 * - CircuitBreakerTrippedError (HTTP 503): Thrown when provider is degraded and circuit breaker is open.
 * - ProviderRoutingError (HTTP 502/504): Thrown when underlying provider fails to process request.
 * Also includes routing resolution, capabilities, and fallback errors:
 * - ModelNotFoundError (HTTP 404)
 * - UnknownModelAliasError (HTTP 400)
 * - NoAvailableProviderError (HTTP 503)
 * - ProviderTimeoutError (HTTP 504)
 * - CapabilityMismatchError (HTTP 400)
 * - FallbackExhaustedError (HTTP 502)
 */

import { DomainError, DomainErrorOptions } from "./domain_error";

export interface CircuitBreakerTrippedErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  provider: string;
  modelId?: string;
  consecutiveFailures?: number;
  circuitOpenUntil?: string;
  retryAfterSeconds?: number;
}

/**
 * CircuitBreakerTrippedError (HTTP 503)
 * Thrown when an upstream provider is degraded and its circuit breaker is currently open.
 * Prevents cascaded failures and respects provider cooldown windows.
 */
export class CircuitBreakerTrippedError extends DomainError {
  public override readonly name = "CircuitBreakerTrippedError";
  public readonly provider: string;
  public readonly modelId?: string;
  public readonly consecutiveFailures?: number;
  public readonly circuitOpenUntil?: string;
  public readonly retryAfterSeconds: number;

  constructor(
    provider: string,
    message?: string,
    options: Omit<CircuitBreakerTrippedErrorOptions, "provider"> = {}
  ) {
    const retryAfter = options.retryAfterSeconds ?? 60;
    const msg =
      message ??
      `Circuit breaker open for provider '${provider}': service temporarily degraded`;
    super(msg, {
      ...options,
      statusCode: 503,
      code: "CIRCUIT_BREAKER_OPEN",
      details: {
        provider,
        ...(options.modelId ? { modelId: options.modelId } : {}),
        ...(options.consecutiveFailures !== undefined
          ? { consecutiveFailures: options.consecutiveFailures }
          : {}),
        ...(options.circuitOpenUntil ? { circuitOpenUntil: options.circuitOpenUntil } : {}),
        retryAfterSeconds: retryAfter,
        ...options.details,
      },
    });
    this.provider = provider;
    this.modelId = options.modelId;
    this.consecutiveFailures = options.consecutiveFailures;
    this.circuitOpenUntil = options.circuitOpenUntil;
    this.retryAfterSeconds = retryAfter;
    Object.setPrototypeOf(this, CircuitBreakerTrippedError.prototype);
  }

  public override toResponse(headers?: HeadersInit): Response {
    return super.toResponse({
      "retry-after": String(this.retryAfterSeconds),
      ...headers,
    });
  }
}

export interface ProviderRoutingErrorOptions
  extends Omit<DomainErrorOptions, "code"> {
  provider: string;
  modelId?: string;
  upstreamStatusCode?: number;
  upstreamResponseText?: string;
  statusCode?: 502 | 504;
}

/**
 * ProviderRoutingError (HTTP 502/504)
 * Thrown when an underlying provider fails to process the request (e.g. upstream 5xx,
 * network failure, connection refused, or upstream error response).
 */
export class ProviderRoutingError extends DomainError {
  public override readonly name = "ProviderRoutingError";
  public readonly provider: string;
  public readonly modelId?: string;
  public readonly upstreamStatusCode?: number;
  public readonly upstreamResponseText?: string;

  constructor(
    provider: string,
    message?: string,
    options: Omit<ProviderRoutingErrorOptions, "provider"> = {}
  ) {
    const status = options.statusCode ?? 502;
    const msg =
      message ??
      `Upstream provider '${provider}' failed to process request (HTTP ${options.upstreamStatusCode ?? status})`;
    super(msg, {
      ...options,
      statusCode: status,
      code: status === 504 ? "GATEWAY_TIMEOUT" : "BAD_GATEWAY",
      details: {
        provider,
        ...(options.modelId ? { modelId: options.modelId } : {}),
        ...(options.upstreamStatusCode !== undefined
          ? { upstreamStatusCode: options.upstreamStatusCode }
          : {}),
        ...(options.upstreamResponseText
          ? { upstreamResponseText: options.upstreamResponseText }
          : {}),
        ...options.details,
      },
    });
    this.provider = provider;
    this.modelId = options.modelId;
    this.upstreamStatusCode = options.upstreamStatusCode;
    this.upstreamResponseText = options.upstreamResponseText;
    Object.setPrototypeOf(this, ProviderRoutingError.prototype);
  }
}

export interface ModelNotFoundErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  modelIdOrAlias: string;
  availableModels?: readonly string[];
}

/**
 * ModelNotFoundError (HTTP 404)
 * Thrown when a requested model ID or alias does not exist in the model registry.
 */
export class ModelNotFoundError extends DomainError {
  public override readonly name = "ModelNotFoundError";
  public readonly modelIdOrAlias: string;
  public readonly availableModels?: readonly string[];

  constructor(
    modelIdOrAlias: string,
    message?: string,
    options: Omit<ModelNotFoundErrorOptions, "modelIdOrAlias"> = {}
  ) {
    const msg = message ?? `Model or alias '${modelIdOrAlias}' not found in registry`;
    super(msg, {
      ...options,
      statusCode: 404,
      code: "MODEL_NOT_FOUND",
      details: {
        modelIdOrAlias,
        ...(options.availableModels ? { availableModels: [...options.availableModels] } : {}),
        ...options.details,
      },
    });
    this.modelIdOrAlias = modelIdOrAlias;
    this.availableModels = options.availableModels;
    Object.setPrototypeOf(this, ModelNotFoundError.prototype);
  }
}

export interface UnknownModelAliasErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  alias: string;
  configuredAliases?: readonly string[];
}

/**
 * UnknownModelAliasError (HTTP 400)
 * Thrown when a requested abstract alias cannot be resolved to an active model definition.
 */
export class UnknownModelAliasError extends DomainError {
  public override readonly name = "UnknownModelAliasError";
  public readonly alias: string;
  public readonly configuredAliases?: readonly string[];

  constructor(
    alias: string,
    message?: string,
    options: Omit<UnknownModelAliasErrorOptions, "alias"> = {}
  ) {
    const msg = message ?? `Unknown model alias '${alias}'. No target model mapped.`;
    super(msg, {
      ...options,
      statusCode: 400,
      code: "UNKNOWN_MODEL_ALIAS",
      details: {
        alias,
        ...(options.configuredAliases
          ? { configuredAliases: [...options.configuredAliases] }
          : {}),
        ...options.details,
      },
    });
    this.alias = alias;
    this.configuredAliases = options.configuredAliases;
    Object.setPrototypeOf(this, UnknownModelAliasError.prototype);
  }
}

export interface NoAvailableProviderErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  requestedModel?: string;
  candidateCount?: number;
  reason?: string;
}

/**
 * NoAvailableProviderError (HTTP 503)
 * Thrown when no upstream provider candidates can fulfill the request
 * (e.g. all available providers circuit-tripped or disabled).
 */
export class NoAvailableProviderError extends DomainError {
  public override readonly name = "NoAvailableProviderError";
  public readonly requestedModel?: string;
  public readonly candidateCount: number;

  constructor(
    message = "No available provider could satisfy the routing request",
    options: NoAvailableProviderErrorOptions = {}
  ) {
    super(message, {
      ...options,
      statusCode: 503,
      code: "NO_AVAILABLE_PROVIDER",
      details: {
        ...(options.requestedModel ? { requestedModel: options.requestedModel } : {}),
        candidateCount: options.candidateCount ?? 0,
        ...(options.reason ? { reason: options.reason } : {}),
        ...options.details,
      },
    });
    this.requestedModel = options.requestedModel;
    this.candidateCount = options.candidateCount ?? 0;
    Object.setPrototypeOf(this, NoAvailableProviderError.prototype);
  }
}

export interface ProviderTimeoutErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  provider: string;
  modelId?: string;
  timeoutMs?: number;
}

/**
 * ProviderTimeoutError (HTTP 504)
 * Thrown when an upstream provider fails to respond within the configured timeout threshold.
 */
export class ProviderTimeoutError extends DomainError {
  public override readonly name = "ProviderTimeoutError";
  public readonly provider: string;
  public readonly modelId?: string;
  public readonly timeoutMs?: number;

  constructor(
    provider: string,
    message?: string,
    options: Omit<ProviderTimeoutErrorOptions, "provider"> = {}
  ) {
    const msg =
      message ??
      `Upstream provider '${provider}' timed out after ${options.timeoutMs ?? 30000}ms`;
    super(msg, {
      ...options,
      statusCode: 504,
      code: "GATEWAY_TIMEOUT",
      details: {
        provider,
        ...(options.modelId ? { modelId: options.modelId } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...options.details,
      },
    });
    this.provider = provider;
    this.modelId = options.modelId;
    this.timeoutMs = options.timeoutMs;
    Object.setPrototypeOf(this, ProviderTimeoutError.prototype);
  }
}

export interface CapabilityMismatchErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  requiredCapabilities: readonly string[];
  candidateModel?: string;
}

/**
 * CapabilityMismatchError (HTTP 400)
 * Thrown when a request requires specific model capabilities (e.g. tools, vision, JSON schema)
 * that cannot be satisfied by the selected model or candidate pool.
 */
export class CapabilityMismatchError extends DomainError {
  public override readonly name = "CapabilityMismatchError";
  public readonly requiredCapabilities: readonly string[];
  public readonly candidateModel?: string;

  constructor(
    requiredCapabilities: readonly string[],
    message?: string,
    options: Omit<CapabilityMismatchErrorOptions, "requiredCapabilities"> = {}
  ) {
    const msg =
      message ??
      `No configured provider supports required capabilities: [${requiredCapabilities.join(", ")}]`;
    super(msg, {
      ...options,
      statusCode: 400,
      code: "CAPABILITY_MISMATCH",
      details: {
        requiredCapabilities: [...requiredCapabilities],
        ...(options.candidateModel ? { candidateModel: options.candidateModel } : {}),
        ...options.details,
      },
    });
    this.requiredCapabilities = [...requiredCapabilities];
    this.candidateModel = options.candidateModel;
    Object.setPrototypeOf(this, CapabilityMismatchError.prototype);
  }
}

export interface FallbackAttempt {
  provider: string;
  modelId: string;
  error: string;
}

export interface FallbackExhaustedErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  attemptedRoutes: readonly FallbackAttempt[];
}

/**
 * FallbackExhaustedError (HTTP 502)
 * Thrown when the primary route and all configured fallback routes have been tried and failed.
 */
export class FallbackExhaustedError extends DomainError {
  public override readonly name = "FallbackExhaustedError";
  public readonly attemptedRoutes: readonly FallbackAttempt[];

  constructor(
    attemptedRoutes: readonly FallbackAttempt[],
    message?: string,
    options: Omit<FallbackExhaustedErrorOptions, "attemptedRoutes"> = {}
  ) {
    const msg =
      message ??
      `Primary route and all ${attemptedRoutes.length} fallback routes exhausted without success`;
    super(msg, {
      ...options,
      statusCode: 502,
      code: "FALLBACK_EXHAUSTED",
      details: {
        attemptedRoutes: [...attemptedRoutes],
        ...options.details,
      },
    });
    this.attemptedRoutes = [...attemptedRoutes];
    Object.setPrototypeOf(this, FallbackExhaustedError.prototype);
  }
}

// Type Guards
export function isCircuitBreakerTrippedError(value: unknown): value is CircuitBreakerTrippedError {
  return (
    value instanceof CircuitBreakerTrippedError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "CircuitBreakerTrippedError")
  );
}

export function isProviderRoutingError(value: unknown): value is ProviderRoutingError {
  return (
    value instanceof ProviderRoutingError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "ProviderRoutingError")
  );
}

export function isModelNotFoundError(value: unknown): value is ModelNotFoundError {
  return (
    value instanceof ModelNotFoundError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "ModelNotFoundError")
  );
}

export function isUnknownModelAliasError(value: unknown): value is UnknownModelAliasError {
  return (
    value instanceof UnknownModelAliasError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "UnknownModelAliasError")
  );
}

export function isNoAvailableProviderError(value: unknown): value is NoAvailableProviderError {
  return (
    value instanceof NoAvailableProviderError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "NoAvailableProviderError")
  );
}

export function isProviderTimeoutError(value: unknown): value is ProviderTimeoutError {
  return (
    value instanceof ProviderTimeoutError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "ProviderTimeoutError")
  );
}

export function isCapabilityMismatchError(value: unknown): value is CapabilityMismatchError {
  return (
    value instanceof CapabilityMismatchError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "CapabilityMismatchError")
  );
}

export function isFallbackExhaustedError(value: unknown): value is FallbackExhaustedError {
  return (
    value instanceof FallbackExhaustedError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "FallbackExhaustedError")
  );
}
