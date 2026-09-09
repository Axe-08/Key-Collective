/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Telemetry and Analytics Errors
 *
 * Invariants:
 * - Non-Blocking Telemetry: High-frequency telemetry streams to Workers Analytics Engine.
 * - Errors provide structured diagnostic codes and details for non-blocking logging.
 */

import { DomainError, DomainErrorOptions } from "./domain_error";

export interface TelemetryEmissionErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  traceId?: string;
  eventType?: string;
  reason?: string;
}

/**
 * TelemetryEmissionError (HTTP 500 / internal)
 * Thrown or logged when emission to Workers Analytics Engine fails.
 */
export class TelemetryEmissionError extends DomainError {
  public override readonly name = "TelemetryEmissionError";
  public readonly traceId?: string;
  public readonly eventType?: string;
  public readonly reason?: string;

  constructor(
    message = "Non-blocking telemetry emission to Workers Analytics Engine failed",
    options: TelemetryEmissionErrorOptions = {}
  ) {
    super(message, {
      ...options,
      statusCode: 500,
      code: "TELEMETRY_EMISSION_FAILED",
      details: {
        ...(options.traceId ? { traceId: options.traceId } : {}),
        ...(options.eventType ? { eventType: options.eventType } : {}),
        ...(options.reason ? { reason: options.reason } : {}),
        ...options.details,
      },
    });
    this.traceId = options.traceId;
    this.eventType = options.eventType;
    this.reason = options.reason;
    Object.setPrototypeOf(this, TelemetryEmissionError.prototype);
  }
}

export interface InvalidTelemetryEventErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  validationErrors?: readonly string[];
}

/**
 * InvalidTelemetryEventError (HTTP 400)
 * Thrown when a telemetry event payload fails schema validation or missing required trace/tenant IDs.
 */
export class InvalidTelemetryEventError extends DomainError {
  public override readonly name = "InvalidTelemetryEventError";
  public readonly validationErrors: readonly string[];

  constructor(
    message = "Invalid telemetry event payload: schema validation failed",
    options: InvalidTelemetryEventErrorOptions = {}
  ) {
    super(message, {
      ...options,
      statusCode: 400,
      code: "INVALID_TELEMETRY_EVENT",
      details: {
        ...(options.validationErrors ? { validationErrors: [...options.validationErrors] } : {}),
        ...options.details,
      },
    });
    this.validationErrors = options.validationErrors ? [...options.validationErrors] : [];
    Object.setPrototypeOf(this, InvalidTelemetryEventError.prototype);
  }
}

// Type Guards
export function isTelemetryEmissionError(value: unknown): value is TelemetryEmissionError {
  return (
    value instanceof TelemetryEmissionError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "TelemetryEmissionError")
  );
}

export function isInvalidTelemetryEventError(value: unknown): value is InvalidTelemetryEventError {
  return (
    value instanceof InvalidTelemetryEventError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "InvalidTelemetryEventError")
  );
}
