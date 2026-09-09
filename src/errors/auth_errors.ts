/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Authentication and Tenant Isolation Errors
 *
 * Conforms to LLD 3.1:
 * - AuthenticationError (HTTP 401): Thrown when bearerToken fails validation or is expired.
 * - TenantIsolationError (HTTP 403): Thrown on any cross-tenant state violation.
 */

import { DomainError, DomainErrorOptions } from "./domain_error";

export interface AuthenticationErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  reason?: "missing_token" | "invalid_token" | "expired_token" | "malformed_header" | string;
  bearerTokenPrefix?: string;
}

/**
 * AuthenticationError (HTTP 401)
 * Thrown when the bearerToken fails validation, is malformed, or is expired.
 */
export class AuthenticationError extends DomainError {
  public override readonly name = "AuthenticationError";
  public readonly reason?: string;
  public readonly bearerTokenPrefix?: string;

  constructor(
    message = "Authentication failed: invalid or expired bearer token",
    options: AuthenticationErrorOptions = {}
  ) {
    super(message, {
      ...options,
      statusCode: 401,
      code: "AUTHENTICATION_FAILED",
      details: {
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.bearerTokenPrefix ? { bearerTokenPrefix: options.bearerTokenPrefix } : {}),
        ...options.details,
      },
    });
    this.reason = options.reason;
    this.bearerTokenPrefix = options.bearerTokenPrefix;
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }

  public override toResponse(headers?: HeadersInit): Response {
    return super.toResponse({
      "www-authenticate": 'Bearer realm="Key Collective API"',
      ...headers,
    });
  }
}

export interface TenantIsolationErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  tenantId?: string;
  attemptedTenantId?: string;
  resourceId?: string;
}

/**
 * TenantIsolationError (HTTP 403)
 * Non-negotiable architectural invariant: Zero cross-tenant state.
 * Thrown whenever an operation attempts to access or mutate state belonging to another tenant.
 */
export class TenantIsolationError extends DomainError {
  public override readonly name = "TenantIsolationError";
  public readonly tenantId?: string;
  public readonly attemptedTenantId?: string;
  public readonly resourceId?: string;

  constructor(
    message = "Tenant isolation violation: cross-tenant access is forbidden",
    options: TenantIsolationErrorOptions = {}
  ) {
    super(message, {
      ...options,
      statusCode: 403,
      code: "TENANT_ISOLATION_VIOLATION",
      details: {
        ...(options.tenantId ? { tenantId: options.tenantId } : {}),
        ...(options.attemptedTenantId ? { attemptedTenantId: options.attemptedTenantId } : {}),
        ...(options.resourceId ? { resourceId: options.resourceId } : {}),
        ...options.details,
      },
    });
    this.tenantId = options.tenantId;
    this.attemptedTenantId = options.attemptedTenantId;
    this.resourceId = options.resourceId;
    Object.setPrototypeOf(this, TenantIsolationError.prototype);
  }
}

export function isAuthenticationError(value: unknown): value is AuthenticationError {
  return (
    value instanceof AuthenticationError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "AuthenticationError")
  );
}

export function isTenantIsolationError(value: unknown): value is TenantIsolationError {
  return (
    value instanceof TenantIsolationError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "TenantIsolationError")
  );
}
