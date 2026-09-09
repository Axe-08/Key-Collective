/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Key Management Errors
 *
 * Conforms to LLD 3.2:
 * - DecryptionError (HTTP 500): Thrown if AES-GCM decryption of a provider key fails.
 * - RateLimitExceededError (HTTP 429): Thrown when a tenant exceeds allocated RPM.
 * Also includes key lifecycle, cryptographic, and pool quota errors:
 * - EncryptionError (HTTP 500)
 * - KeyNotFoundError (HTTP 404)
 * - KeyExhaustedError (HTTP 429)
 * - InvalidKeyError (HTTP 400)
 * - QuotaExceededError (HTTP 429)
 */

import { DomainError, DomainErrorOptions } from "./domain_error";

export interface DecryptionErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  keyId?: string;
  provider?: string;
  algorithm?: string;
  nonceLengthBytes?: number;
}

/**
 * DecryptionError (HTTP 500)
 * Thrown if AES-256-GCM decryption of a provider key fails (Web Crypto API integrity tag mismatch,
 * bad nonce, or corrupted ciphertext).
 */
export class DecryptionError extends DomainError {
  public override readonly name = "DecryptionError";
  public readonly keyId?: string;
  public readonly provider?: string;
  public readonly algorithm: string;

  constructor(
    message = "AES-GCM decryption failed: invalid ciphertext or corrupted nonce tag",
    options: DecryptionErrorOptions = {}
  ) {
    super(message, {
      ...options,
      statusCode: 500,
      code: "DECRYPTION_FAILED",
      details: {
        ...(options.keyId ? { keyId: options.keyId } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
        algorithm: options.algorithm ?? "AES-GCM",
        ...(options.nonceLengthBytes !== undefined ? { nonceLengthBytes: options.nonceLengthBytes } : {}),
        ...options.details,
      },
    });
    this.keyId = options.keyId;
    this.provider = options.provider;
    this.algorithm = options.algorithm ?? "AES-GCM";
    Object.setPrototypeOf(this, DecryptionError.prototype);
  }
}

export interface EncryptionErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  provider?: string;
  algorithm?: string;
}

/**
 * EncryptionError (HTTP 500)
 * Thrown if AES-256-GCM encryption of a provider key fails during key provisioning.
 */
export class EncryptionError extends DomainError {
  public override readonly name = "EncryptionError";
  public readonly provider?: string;
  public readonly algorithm: string;

  constructor(
    message = "AES-256-GCM encryption failed: Web Crypto operation unsuccessful",
    options: EncryptionErrorOptions = {}
  ) {
    super(message, {
      ...options,
      statusCode: 500,
      code: "ENCRYPTION_FAILED",
      details: {
        ...(options.provider ? { provider: options.provider } : {}),
        algorithm: options.algorithm ?? "AES-GCM",
        ...options.details,
      },
    });
    this.provider = options.provider;
    this.algorithm = options.algorithm ?? "AES-GCM";
    Object.setPrototypeOf(this, EncryptionError.prototype);
  }
}

export interface RateLimitExceededErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  tenantId?: string;
  provider?: string;
  keyId?: string;
  rpmLimit?: number;
  currentRpm?: number;
  retryAfterSeconds?: number;
}

/**
 * RateLimitExceededError (HTTP 429)
 * Thrown when a tenant exceeds their allocated requests-per-minute (RPM) rate limit,
 * or when an upstream provider key hits 429 rate limits.
 */
export class RateLimitExceededError extends DomainError {
  public override readonly name = "RateLimitExceededError";
  public readonly tenantId?: string;
  public readonly provider?: string;
  public readonly keyId?: string;
  public readonly rpmLimit?: number;
  public readonly currentRpm?: number;
  public readonly retryAfterSeconds: number;

  constructor(
    message = "Rate limit exceeded: tenant RPM limit reached",
    options: RateLimitExceededErrorOptions = {}
  ) {
    const retryAfter = options.retryAfterSeconds ?? 60;
    super(message, {
      ...options,
      statusCode: 429,
      code: "RATE_LIMIT_EXCEEDED",
      details: {
        ...(options.tenantId ? { tenantId: options.tenantId } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.keyId ? { keyId: options.keyId } : {}),
        ...(options.rpmLimit !== undefined ? { rpmLimit: options.rpmLimit } : {}),
        ...(options.currentRpm !== undefined ? { currentRpm: options.currentRpm } : {}),
        retryAfterSeconds: retryAfter,
        ...options.details,
      },
    });
    this.tenantId = options.tenantId;
    this.provider = options.provider;
    this.keyId = options.keyId;
    this.rpmLimit = options.rpmLimit;
    this.currentRpm = options.currentRpm;
    this.retryAfterSeconds = retryAfter;
    Object.setPrototypeOf(this, RateLimitExceededError.prototype);
  }

  public override toResponse(headers?: HeadersInit): Response {
    return super.toResponse({
      "retry-after": String(this.retryAfterSeconds),
      ...headers,
    });
  }
}

export interface KeyNotFoundErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  keyId: string;
  tenantId?: string;
  provider?: string;
}

/**
 * KeyNotFoundError (HTTP 404)
 * Thrown when a specific API key ID does not exist in the tenant's key pool.
 */
export class KeyNotFoundError extends DomainError {
  public override readonly name = "KeyNotFoundError";
  public readonly keyId: string;
  public readonly tenantId?: string;
  public readonly provider?: string;

  constructor(
    keyId: string,
    message?: string,
    options: Omit<KeyNotFoundErrorOptions, "keyId"> = {}
  ) {
    const msg = message ?? `Key '${keyId}' not found in pool`;
    super(msg, {
      ...options,
      statusCode: 404,
      code: "KEY_NOT_FOUND",
      details: {
        keyId,
        ...(options.tenantId ? { tenantId: options.tenantId } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
        ...options.details,
      },
    });
    this.keyId = keyId;
    this.tenantId = options.tenantId;
    this.provider = options.provider;
    Object.setPrototypeOf(this, KeyNotFoundError.prototype);
  }
}

export interface KeyExhaustedErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  provider?: string;
  tenantId?: string;
  totalKeys?: number;
  retryAfterSeconds?: number;
}

/**
 * KeyExhaustedError (HTTP 429)
 * Thrown when all keys for a requested provider are exhausted, rate-limited, or disabled.
 */
export class KeyExhaustedError extends DomainError {
  public override readonly name = "KeyExhaustedError";
  public readonly provider?: string;
  public readonly tenantId?: string;
  public readonly totalKeys?: number;
  public readonly retryAfterSeconds?: number;

  constructor(
    message = "All provider keys are currently exhausted, rate limited, or disabled",
    options: KeyExhaustedErrorOptions = {}
  ) {
    super(message, {
      ...options,
      statusCode: 429,
      code: "ALL_KEYS_EXHAUSTED",
      details: {
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.tenantId ? { tenantId: options.tenantId } : {}),
        ...(options.totalKeys !== undefined ? { totalKeys: options.totalKeys } : {}),
        ...(options.retryAfterSeconds !== undefined ? { retryAfterSeconds: options.retryAfterSeconds } : {}),
        ...options.details,
      },
    });
    this.provider = options.provider;
    this.tenantId = options.tenantId;
    this.totalKeys = options.totalKeys;
    this.retryAfterSeconds = options.retryAfterSeconds;
    Object.setPrototypeOf(this, KeyExhaustedError.prototype);
  }

  public override toResponse(headers?: HeadersInit): Response {
    return super.toResponse({
      ...(this.retryAfterSeconds ? { "retry-after": String(this.retryAfterSeconds) } : {}),
      ...headers,
    });
  }
}

export interface InvalidKeyErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  provider?: string;
  reason?: string;
}

/**
 * InvalidKeyError (HTTP 400)
 * Thrown when a key is malformed or fails provider format validation.
 */
export class InvalidKeyError extends DomainError {
  public override readonly name = "InvalidKeyError";
  public readonly provider?: string;
  public readonly reason?: string;

  constructor(
    message = "Invalid API key format or rejected by provider validation",
    options: InvalidKeyErrorOptions = {}
  ) {
    super(message, {
      ...options,
      statusCode: 400,
      code: "INVALID_KEY",
      details: {
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.reason ? { reason: options.reason } : {}),
        ...options.details,
      },
    });
    this.provider = options.provider;
    this.reason = options.reason;
    Object.setPrototypeOf(this, InvalidKeyError.prototype);
  }
}

export interface QuotaExceededErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  tenantId: string;
  quotaType?: "rpm" | "rpd" | "spend_limit";
  limit?: bigint | number;
  consumed?: bigint | number;
}

/**
 * QuotaExceededError (HTTP 429)
 * Thrown when a tenant hits their configured daily quota (RPD) or spend ceiling.
 */
export class QuotaExceededError extends DomainError {
  public override readonly name = "QuotaExceededError";
  public readonly tenantId: string;
  public readonly quotaType: "rpm" | "rpd" | "spend_limit";
  public readonly limit?: bigint | number;
  public readonly consumed?: bigint | number;

  constructor(
    message = "Tenant quota ceiling reached",
    options: QuotaExceededErrorOptions
  ) {
    super(message, {
      ...options,
      statusCode: 429,
      code: "QUOTA_EXCEEDED",
      details: {
        tenantId: options.tenantId,
        quotaType: options.quotaType ?? "spend_limit",
        ...(options.limit !== undefined
          ? { limit: typeof options.limit === "bigint" ? options.limit.toString() : options.limit }
          : {}),
        ...(options.consumed !== undefined
          ? { consumed: typeof options.consumed === "bigint" ? options.consumed.toString() : options.consumed }
          : {}),
        ...options.details,
      },
    });
    this.tenantId = options.tenantId;
    this.quotaType = options.quotaType ?? "spend_limit";
    this.limit = options.limit;
    this.consumed = options.consumed;
    Object.setPrototypeOf(this, QuotaExceededError.prototype);
  }
}

// Type Guards
export function isDecryptionError(value: unknown): value is DecryptionError {
  return (
    value instanceof DecryptionError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "DecryptionError")
  );
}

export function isEncryptionError(value: unknown): value is EncryptionError {
  return (
    value instanceof EncryptionError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "EncryptionError")
  );
}

export function isRateLimitExceededError(value: unknown): value is RateLimitExceededError {
  return (
    value instanceof RateLimitExceededError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "RateLimitExceededError")
  );
}

export function isKeyNotFoundError(value: unknown): value is KeyNotFoundError {
  return (
    value instanceof KeyNotFoundError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "KeyNotFoundError")
  );
}

export function isKeyExhaustedError(value: unknown): value is KeyExhaustedError {
  return (
    value instanceof KeyExhaustedError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "KeyExhaustedError")
  );
}

export function isInvalidKeyError(value: unknown): value is InvalidKeyError {
  return (
    value instanceof InvalidKeyError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "InvalidKeyError")
  );
}

export function isQuotaExceededError(value: unknown): value is QuotaExceededError {
  return (
    value instanceof QuotaExceededError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "QuotaExceededError")
  );
}
