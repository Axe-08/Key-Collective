/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Base Domain Error Architecture
 *
 * Invariants:
 * - Strict mode, no `any`.
 * - All domain errors inherit from `DomainError`.
 * - Fixed-point microdollars compatible.
 * - Deterministic serialization to JSON and Web API `Response`.
 */

export interface DomainErrorJson {
  error: string;
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

export interface DomainErrorOptions {
  cause?: unknown;
  details?: Record<string, unknown>;
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
}

/**
 * Base abstract class for all domain errors in Key Collective.
 * Ensures consistent HTTP status codes, structured error payloads, and observability.
 */
export abstract class DomainError extends Error {
  public abstract override readonly name: string;
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(message: string, options: DomainErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? "INTERNAL_DOMAIN_ERROR";
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;

    // Restore prototype chain for instanceof checks across transpilation targets
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Serializes the domain error to a standardized structured JSON object.
   */
  public toJSON(): DomainErrorJson {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
      ...(this.details && Object.keys(this.details).length > 0
        ? { details: this.details }
        : {}),
    };
  }

  /**
   * Converts the domain error into a standard Web API Response.
   */
  public toResponse(headers?: HeadersInit): Response {
    const defaultHeaders: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
    };
    return new Response(JSON.stringify(this.toJSON()), {
      status: this.statusCode,
      headers: { ...defaultHeaders, ...headers },
    });
  }
}

/**
 * Type guard for DomainError.
 */
export function isDomainError(value: unknown): value is DomainError {
  return (
    value instanceof DomainError ||
    (typeof value === "object" &&
      value !== null &&
      "statusCode" in value &&
      "code" in value &&
      "isOperational" in value &&
      typeof (value as Record<string, unknown>).statusCode === "number" &&
      typeof (value as Record<string, unknown>).code === "string")
  );
}
