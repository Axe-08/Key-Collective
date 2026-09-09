/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * TelemetryEmitter: Non-blocking Workers Analytics Engine integration
 *
 * Invariants:
 * - Non-Blocking Telemetry: High-frequency telemetry streams to Workers Analytics Engine.
 *   Never block the proxy hot path on D1 writes or external sinks.
 * - Strict Typing: Strict mode, zero `any`.
 * - Fixed-Point Microdollars: All costs in `int64` microdollars (`bigint`).
 */

import { TelemetryContract, TelemetryEvent } from "../contracts/telemetry";
import {
  InvalidTelemetryEventError,
  TelemetryEmissionError,
} from "../errors/telemetry_errors";

/**
 * Structural interface matching Cloudflare Worker ExecutionContext.
 * Allows using both Cloudflare native ExecutionContext and mock objects in unit tests.
 */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

/**
 * Options for configuring TelemetryEmitter.
 */
export interface TelemetryEmitterOptions {
  /** Cloudflare Workers Analytics Engine dataset binding */
  dataset?: AnalyticsEngineDataset | null;
  /** Cloudflare Worker ExecutionContext for non-blocking waitUntil lifecycle management */
  ctx?: ExecutionContextLike;
  /** Fallback or secondary TelemetryContract (e.g. in-memory logger, mock, or secondary sink) */
  fallbackEmitter?: TelemetryContract;
  /** Custom mapper from TelemetryEvent to Cloudflare AnalyticsEngineDataPoint */
  mapper?: (event: TelemetryEvent) => AnalyticsEngineDataPoint;
  /**
   * Whether to throw on validation or emission failure.
   * Default: `false` (enforces the non-blocking hot path invariant).
   */
  strict?: boolean;
  /** Custom error handler callback for emission or validation failures */
  onError?: (error: unknown, event?: TelemetryEvent) => void;
}

/**
 * Parameters for creating a TelemetryEvent with convenient defaults.
 */
export interface CreateTelemetryEventParams {
  traceId?: string;
  tenantId: string;
  timestamp?: number;
  eventType: string;
  latencyMs?: number;
  costMicrodollars?: bigint;
  metadata?: Record<string, string>;
}

/**
 * Safely parses a string value into a finite number, defaulting to 0 if NaN or infinite.
 */
function safeParseDouble(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Default mapper from TelemetryEvent to Cloudflare AnalyticsEngineDataPoint.
 *
 * Layout:
 * - indexes: [tenantId] (for tenant-isolated sampling and query partitioning)
 * - blobs:
 *     0: tenantId
 *     1: traceId
 *     2: eventType
 *     3: model / modelAlias
 *     4: provider
 *     5: keyId
 *     6: statusCode / status
 *     7: serialized metadata JSON
 * - doubles:
 *     0: latencyMs
 *     1: costMicrodollars (as floating-point number for aggregation)
 *     2: timestamp
 *     3: promptTokens
 *     4: completionTokens
 *     5: totalTokens
 */
export function defaultDataPointMapper(
  event: TelemetryEvent
): AnalyticsEngineDataPoint {
  const model =
    event.metadata["model"] ?? event.metadata["modelAlias"] ?? "";
  const provider = event.metadata["provider"] ?? "";
  const keyId = event.metadata["keyId"] ?? "";
  const statusCode =
    event.metadata["statusCode"] ?? event.metadata["status"] ?? "";

  const promptTokens = safeParseDouble(event.metadata["promptTokens"]);
  const completionTokens = safeParseDouble(event.metadata["completionTokens"]);
  const totalTokens = safeParseDouble(event.metadata["totalTokens"]);

  return {
    indexes: [event.tenantId],
    blobs: [
      event.tenantId,
      event.traceId,
      event.eventType,
      model,
      provider,
      keyId,
      statusCode,
      JSON.stringify(event.metadata),
    ],
    doubles: [
      event.latencyMs,
      Number(event.costMicrodollars),
      event.timestamp,
      promptTokens,
      completionTokens,
      totalTokens,
    ],
  };
}

/**
 * Validates whether a candidate value conforms to the TelemetryEvent schema.
 */
export function validateTelemetryEvent(event: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return {
      valid: false,
      errors: ["Telemetry event must be a non-null object"],
    };
  }

  const candidate = event as Record<string, unknown>;

  if (
    typeof candidate.traceId !== "string" ||
    candidate.traceId.trim().length === 0
  ) {
    errors.push("traceId must be a non-empty string");
  }

  if (
    typeof candidate.tenantId !== "string" ||
    candidate.tenantId.trim().length === 0
  ) {
    errors.push("tenantId must be a non-empty string");
  }

  if (
    typeof candidate.eventType !== "string" ||
    candidate.eventType.trim().length === 0
  ) {
    errors.push("eventType must be a non-empty string");
  }

  if (
    typeof candidate.timestamp !== "number" ||
    !Number.isFinite(candidate.timestamp) ||
    candidate.timestamp <= 0
  ) {
    errors.push("timestamp must be a positive finite number");
  }

  if (
    typeof candidate.latencyMs !== "number" ||
    !Number.isFinite(candidate.latencyMs) ||
    candidate.latencyMs < 0
  ) {
    errors.push("latencyMs must be a non-negative finite number");
  }

  if (typeof candidate.costMicrodollars !== "bigint") {
    errors.push("costMicrodollars must be a bigint");
  } else if (candidate.costMicrodollars < 0n) {
    errors.push("costMicrodollars cannot be negative");
  }

  if (
    !candidate.metadata ||
    typeof candidate.metadata !== "object" ||
    Array.isArray(candidate.metadata)
  ) {
    errors.push("metadata must be a record/object");
  } else {
    for (const [key, value] of Object.entries(
      candidate.metadata as Record<string, unknown>
    )) {
      if (typeof value !== "string") {
        errors.push(`metadata key '${key}' must have a string value`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * TelemetryEmitter: High-performance non-blocking telemetry emitter
 * for Cloudflare Workers Analytics Engine.
 *
 * Implements `TelemetryContract`.
 */
export class TelemetryEmitter implements TelemetryContract {
  private readonly options: TelemetryEmitterOptions;
  private readonly mapper: (event: TelemetryEvent) => AnalyticsEngineDataPoint;

  constructor(options?: TelemetryEmitterOptions);
  constructor(
    dataset?: AnalyticsEngineDataset | null,
    ctx?: ExecutionContextLike
  );
  constructor(
    optionsOrDataset?: TelemetryEmitterOptions | AnalyticsEngineDataset | null,
    ctx?: ExecutionContextLike
  ) {
    if (
      optionsOrDataset &&
      typeof (optionsOrDataset as AnalyticsEngineDataset).writeDataPoint ===
        "function"
    ) {
      this.options = {
        dataset: optionsOrDataset as AnalyticsEngineDataset,
        ctx,
      };
    } else if (optionsOrDataset && typeof optionsOrDataset === "object") {
      this.options = { ...(optionsOrDataset as TelemetryEmitterOptions) };
      if (ctx && !this.options.ctx) {
        this.options.ctx = ctx;
      }
    } else {
      this.options = {
        dataset:
          (optionsOrDataset as AnalyticsEngineDataset | null) ?? undefined,
        ctx,
      };
    }

    this.mapper = this.options.mapper ?? defaultDataPointMapper;
  }

  /**
   * Helper to construct a fully formed TelemetryEvent with defaults.
   */
  public createEvent(params: CreateTelemetryEventParams): TelemetryEvent {
    return {
      traceId: params.traceId ?? crypto.randomUUID(),
      tenantId: params.tenantId,
      timestamp: params.timestamp ?? Date.now(),
      eventType: params.eventType,
      latencyMs: params.latencyMs ?? 0,
      costMicrodollars: params.costMicrodollars ?? 0n,
      metadata: params.metadata ? { ...params.metadata } : {},
    };
  }

  /**
   * Helper to create and immediately emit an event.
   */
  public emitEvent(
    params: CreateTelemetryEventParams,
    ctx?: ExecutionContextLike
  ): TelemetryEvent {
    const event = this.createEvent(params);
    this.emit(event, ctx);
    return event;
  }

  /**
   * Dispatches data point to configured sinks. Throws TelemetryEmissionError on failure.
   */
  private dispatchSinks(event: TelemetryEvent): void {
    if (
      this.options.dataset &&
      typeof this.options.dataset.writeDataPoint === "function"
    ) {
      try {
        const point = this.mapper(event);
        this.options.dataset.writeDataPoint(point);
      } catch (cause) {
        throw new TelemetryEmissionError(
          `Failed to write data point to Workers Analytics Engine: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          {
            traceId: event.traceId,
            eventType: event.eventType,
            reason: cause instanceof Error ? cause.message : String(cause),
            cause: cause instanceof Error ? cause : undefined,
          }
        );
      }
    }

    if (
      this.options.fallbackEmitter &&
      typeof this.options.fallbackEmitter.emit === "function"
    ) {
      try {
        this.options.fallbackEmitter.emit(event);
      } catch (cause) {
        throw new TelemetryEmissionError(
          `Failed to emit to fallback TelemetryContract: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          {
            traceId: event.traceId,
            eventType: event.eventType,
            reason: cause instanceof Error ? cause.message : String(cause),
            cause: cause instanceof Error ? cause : undefined,
          }
        );
      }
    }
  }

  /**
   * Asynchronously emits a telemetry event.
   */
  public async emitAsync(event: TelemetryEvent): Promise<void> {
    const { valid, errors } = validateTelemetryEvent(event);
    if (!valid) {
      const error = new InvalidTelemetryEventError(
        `Invalid telemetry event payload: ${errors.join("; ")}`,
        { validationErrors: errors }
      );
      this.handleError(error, event);
      if (this.options.strict) {
        throw error;
      }
      return;
    }

    try {
      this.dispatchSinks(event);
    } catch (error) {
      this.handleError(error, event);
      if (this.options.strict) {
        throw error;
      }
    }
  }

  /**
   * Non-blocking emission implementing `TelemetryContract`.
   *
   * Mechanism:
   * 1. Uses `ctx.waitUntil()` if execution context is provided to guarantee delivery
   *    in background without blocking response latency.
   * 2. In default non-blocking mode (`strict: false`), never throws errors on the hot path.
   *    Failures are forwarded to `options.onError` if configured.
   */
  public emit(event: TelemetryEvent, ctx?: ExecutionContextLike): void {
    const activeCtx = ctx ?? this.options.ctx;

    if (activeCtx && typeof activeCtx.waitUntil === "function") {
      activeCtx.waitUntil(
        this.emitAsync(event).catch((err: unknown) => {
          this.handleError(err, event);
        })
      );
      return;
    }

    // In strict mode without ExecutionContext, execute synchronously and propagate errors
    if (this.options.strict) {
      const { valid, errors } = validateTelemetryEvent(event);
      if (!valid) {
        throw new InvalidTelemetryEventError(
          `Invalid telemetry event payload: ${errors.join("; ")}`,
          { validationErrors: errors }
        );
      }
      this.dispatchSinks(event);
      return;
    }

    // Non-blocking fire-and-forget fallback
    void this.emitAsync(event).catch((err: unknown) => {
      this.handleError(err, event);
    });
  }

  private handleError(error: unknown, event?: TelemetryEvent): void {
    if (this.options.onError) {
      try {
        this.options.onError(error, event);
      } catch {
        // Suppress errors within the custom error handler
      }
    }
  }
}

/**
 * Factory helper for Cloudflare Worker environments.
 */
export function createTelemetryEmitter(
  env: { TELEMETRY?: AnalyticsEngineDataset | null },
  ctx?: ExecutionContextLike,
  options?: Omit<TelemetryEmitterOptions, "dataset" | "ctx">
): TelemetryEmitter {
  return new TelemetryEmitter({
    dataset: env.TELEMETRY,
    ctx,
    ...options,
  });
}
