import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TelemetryEmitter,
  createTelemetryEmitter,
  defaultDataPointMapper,
  validateTelemetryEvent,
  ExecutionContextLike,
} from "../../../src/worker/telemetry_emitter";
import { TelemetryEvent, TelemetryContract } from "../../../src/contracts/telemetry";
import {
  InvalidTelemetryEventError,
  TelemetryEmissionError,
} from "../../../src/errors/telemetry_errors";

describe("TelemetryEmitter & Validation", () => {
  const validEvent: TelemetryEvent = {
    traceId: "trace-test-1234",
    tenantId: "tenant-omega",
    timestamp: 1726000000000,
    eventType: "chat_completion",
    latencyMs: 145,
    costMicrodollars: 2500n,
    metadata: {
      model: "gpt-4o",
      provider: "openai",
      keyId: "key-999",
      statusCode: "200",
      promptTokens: "50",
      completionTokens: "20",
      totalTokens: "70",
    },
  };

  describe("validateTelemetryEvent", () => {
    it("validates a completely valid event", () => {
      const result = validateTelemetryEvent(validEvent);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects non-object or null input", () => {
      expect(validateTelemetryEvent(null).valid).toBe(false);
      expect(validateTelemetryEvent(undefined).valid).toBe(false);
      expect(validateTelemetryEvent("string").valid).toBe(false);
      expect(validateTelemetryEvent([]).valid).toBe(false);
    });

    it("rejects empty or whitespace-only traceId", () => {
      const result1 = validateTelemetryEvent({ ...validEvent, traceId: "" });
      expect(result1.valid).toBe(false);
      expect(result1.errors).toContain("traceId must be a non-empty string");

      const result2 = validateTelemetryEvent({ ...validEvent, traceId: "   " });
      expect(result2.valid).toBe(false);
    });

    it("rejects invalid tenantId", () => {
      const result = validateTelemetryEvent({ ...validEvent, tenantId: "" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("tenantId must be a non-empty string");
    });

    it("rejects invalid eventType", () => {
      const result = validateTelemetryEvent({ ...validEvent, eventType: "" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("eventType must be a non-empty string");
    });

    it("rejects invalid timestamp", () => {
      expect(validateTelemetryEvent({ ...validEvent, timestamp: 0 }).valid).toBe(false);
      expect(validateTelemetryEvent({ ...validEvent, timestamp: -100 }).valid).toBe(false);
      expect(validateTelemetryEvent({ ...validEvent, timestamp: NaN }).valid).toBe(false);
      expect(validateTelemetryEvent({ ...validEvent, timestamp: Infinity }).valid).toBe(false);
    });

    it("rejects invalid latencyMs", () => {
      expect(validateTelemetryEvent({ ...validEvent, latencyMs: -1 }).valid).toBe(false);
      expect(validateTelemetryEvent({ ...validEvent, latencyMs: NaN }).valid).toBe(false);
      expect(validateTelemetryEvent({ ...validEvent, latencyMs: Infinity }).valid).toBe(false);
    });

    it("rejects invalid costMicrodollars (must be non-negative bigint)", () => {
      // number instead of bigint
      expect(validateTelemetryEvent({ ...validEvent, costMicrodollars: 2500 as unknown as bigint }).valid).toBe(false);
      // negative bigint
      expect(validateTelemetryEvent({ ...validEvent, costMicrodollars: -1n }).valid).toBe(false);
    });

    it("rejects invalid metadata", () => {
      expect(validateTelemetryEvent({ ...validEvent, metadata: null as unknown as Record<string, string> }).valid).toBe(false);
      expect(validateTelemetryEvent({ ...validEvent, metadata: [] as unknown as Record<string, string> }).valid).toBe(false);
      // non-string metadata value
      expect(
        validateTelemetryEvent({
          ...validEvent,
          metadata: { validKey: "val", invalidKey: 123 as unknown as string },
        }).valid
      ).toBe(false);
    });
  });

  describe("defaultDataPointMapper", () => {
    it("maps standard TelemetryEvent to AnalyticsEngineDataPoint correctly", () => {
      const point = defaultDataPointMapper(validEvent);

      expect(point.indexes).toEqual(["tenant-omega"]);
      expect(point.blobs?.[0]).toBe("tenant-omega");
      expect(point.blobs?.[1]).toBe("trace-test-1234");
      expect(point.blobs?.[2]).toBe("chat_completion");
      expect(point.blobs?.[3]).toBe("gpt-4o");
      expect(point.blobs?.[4]).toBe("openai");
      expect(point.blobs?.[5]).toBe("key-999");
      expect(point.blobs?.[6]).toBe("200");
      expect(point.blobs?.[7]).toBe(JSON.stringify(validEvent.metadata));

      expect(point.doubles?.[0]).toBe(145);
      expect(point.doubles?.[1]).toBe(2500);
      expect(point.doubles?.[2]).toBe(1726000000000);
      expect(point.doubles?.[3]).toBe(50);
      expect(point.doubles?.[4]).toBe(20);
      expect(point.doubles?.[5]).toBe(70);
    });

    it("falls back to modelAlias if model is not specified", () => {
      const event: TelemetryEvent = {
        ...validEvent,
        metadata: { modelAlias: "claude-fast" },
      };
      const point = defaultDataPointMapper(event);
      expect(point.blobs?.[3]).toBe("claude-fast");
    });

    it("handles missing token metrics gracefully with 0", () => {
      const event: TelemetryEvent = {
        ...validEvent,
        metadata: {},
      };
      const point = defaultDataPointMapper(event);
      expect(point.doubles?.[3]).toBe(0);
      expect(point.doubles?.[4]).toBe(0);
      expect(point.doubles?.[5]).toBe(0);
    });
  });

  describe("TelemetryEmitter constructor and factory", () => {
    it("instantiates with options object", () => {
      const dataset: AnalyticsEngineDataset = { writeDataPoint: vi.fn() };
      const emitter = new TelemetryEmitter({ dataset });
      expect(emitter).toBeInstanceOf(TelemetryEmitter);
    });

    it("instantiates with positional dataset and ctx parameters", () => {
      const dataset: AnalyticsEngineDataset = { writeDataPoint: vi.fn() };
      const ctx: ExecutionContextLike = { waitUntil: vi.fn() };
      const emitter = new TelemetryEmitter(dataset, ctx);
      expect(emitter).toBeInstanceOf(TelemetryEmitter);
    });

    it("instantiates with no parameters", () => {
      const emitter = new TelemetryEmitter();
      expect(emitter).toBeInstanceOf(TelemetryEmitter);
    });

    it("instantiates via createTelemetryEmitter helper", () => {
      const dataset: AnalyticsEngineDataset = { writeDataPoint: vi.fn() };
      const ctx: ExecutionContextLike = { waitUntil: vi.fn() };
      const emitter = createTelemetryEmitter({ TELEMETRY: dataset }, ctx);
      expect(emitter).toBeInstanceOf(TelemetryEmitter);
    });
  });

  describe("createEvent and emitEvent helpers", () => {
    it("creates an event with sensible defaults", () => {
      const emitter = new TelemetryEmitter();
      const before = Date.now();
      const event = emitter.createEvent({
        tenantId: "t-123",
        eventType: "token_auth_success",
      });
      const after = Date.now();

      expect(event.tenantId).toBe("t-123");
      expect(event.eventType).toBe("token_auth_success");
      expect(typeof event.traceId).toBe("string");
      expect(event.traceId.length).toBeGreaterThan(0);
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
      expect(event.latencyMs).toBe(0);
      expect(event.costMicrodollars).toBe(0n);
      expect(event.metadata).toEqual({});
    });

    it("preserves explicit fields in createEvent", () => {
      const emitter = new TelemetryEmitter();
      const event = emitter.createEvent({
        traceId: "custom-trace",
        tenantId: "t-custom",
        timestamp: 1000,
        eventType: "rate_limit_exceeded",
        latencyMs: 12,
        costMicrodollars: 500n,
        metadata: { path: "/v1/chat/completions" },
      });

      expect(event.traceId).toBe("custom-trace");
      expect(event.tenantId).toBe("t-custom");
      expect(event.timestamp).toBe(1000);
      expect(event.latencyMs).toBe(12);
      expect(event.costMicrodollars).toBe(500n);
      expect(event.metadata).toEqual({ path: "/v1/chat/completions" });
    });

    it("emits immediately via emitEvent", () => {
      const writeDataPoint = vi.fn();
      const dataset: AnalyticsEngineDataset = { writeDataPoint };
      const emitter = new TelemetryEmitter({ dataset });

      const event = emitter.emitEvent({
        tenantId: "t-1",
        eventType: "ping",
      });

      expect(event.tenantId).toBe("t-1");
      expect(event.eventType).toBe("ping");
      expect(writeDataPoint).toHaveBeenCalledTimes(1);
    });
  });

  describe("Non-blocking hot path with ExecutionContext (ctx.waitUntil)", () => {
    it("enqueues emission inside ctx.waitUntil without awaiting on hot path", async () => {
      const writeDataPoint = vi.fn();
      const dataset: AnalyticsEngineDataset = { writeDataPoint };
      let enqueuedPromise: Promise<unknown> | null = null;
      const ctx: ExecutionContextLike = {
        waitUntil: vi.fn((p: Promise<unknown>) => {
          enqueuedPromise = p;
        }),
      };

      const emitter = new TelemetryEmitter({ dataset, ctx });
      emitter.emit(validEvent);

      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
      expect(enqueuedPromise).not.toBeNull();

      // Wait for background execution to complete
      await enqueuedPromise;
      expect(writeDataPoint).toHaveBeenCalledTimes(1);
    });

    it("uses ctx passed directly to emit() method", async () => {
      const writeDataPoint = vi.fn();
      const dataset: AnalyticsEngineDataset = { writeDataPoint };
      let enqueuedPromise: Promise<unknown> | null = null;
      const ctx: ExecutionContextLike = {
        waitUntil: vi.fn((p: Promise<unknown>) => {
          enqueuedPromise = p;
        }),
      };

      const emitter = new TelemetryEmitter({ dataset });
      emitter.emit(validEvent, ctx);

      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
      await enqueuedPromise;
      expect(writeDataPoint).toHaveBeenCalledTimes(1);
    });

    it("catches and forwards errors inside ctx.waitUntil to onError without crashing", async () => {
      const writeDataPoint = vi.fn().mockImplementation(() => {
        throw new Error("AnalyticsEngine quota exceeded");
      });
      const dataset: AnalyticsEngineDataset = { writeDataPoint };
      let enqueuedPromise: Promise<unknown> | null = null;
      const ctx: ExecutionContextLike = {
        waitUntil: vi.fn((p: Promise<unknown>) => {
          enqueuedPromise = p;
        }),
      };
      const onError = vi.fn();

      const emitter = new TelemetryEmitter({ dataset, ctx, onError });
      emitter.emit(validEvent);

      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
      // Wait for background task
      await enqueuedPromise;

      expect(onError).toHaveBeenCalledTimes(1);
      const [error, event] = onError.mock.calls[0] as [unknown, TelemetryEvent];
      expect(error).toBeInstanceOf(TelemetryEmissionError);
      expect((error as TelemetryEmissionError).reason).toContain("AnalyticsEngine quota exceeded");
      expect(event).toEqual(validEvent);
    });
  });

  describe("Fallback and Secondary Emitter", () => {
    it("dispatches to fallback TelemetryContract", async () => {
      const writeDataPoint = vi.fn();
      const dataset: AnalyticsEngineDataset = { writeDataPoint };
      const fallbackEvents: TelemetryEvent[] = [];
      const fallbackEmitter: TelemetryContract = {
        emit: vi.fn((event: TelemetryEvent) => {
          fallbackEvents.push(event);
        }),
      };

      const emitter = new TelemetryEmitter({ dataset, fallbackEmitter });
      await emitter.emitAsync(validEvent);

      expect(writeDataPoint).toHaveBeenCalledTimes(1);
      expect(fallbackEmitter.emit).toHaveBeenCalledWith(validEvent);
      expect(fallbackEvents).toHaveLength(1);
    });

    it("handles fallback emitter failure gracefully in non-blocking mode", async () => {
      const fallbackEmitter: TelemetryContract = {
        emit: vi.fn(() => {
          throw new Error("Fallback sink offline");
        }),
      };
      const onError = vi.fn();
      const emitter = new TelemetryEmitter({ fallbackEmitter, onError });

      await emitter.emitAsync(validEvent);

      expect(onError).toHaveBeenCalledTimes(1);
      const [err] = onError.mock.calls[0] as [unknown, TelemetryEvent];
      expect(err).toBeInstanceOf(TelemetryEmissionError);
      expect((err as TelemetryEmissionError).reason).toContain("Fallback sink offline");
    });
  });

  describe("Custom Mapper", () => {
    it("uses custom mapper if provided", async () => {
      const writeDataPoint = vi.fn();
      const dataset: AnalyticsEngineDataset = { writeDataPoint };
      const customMapper = vi.fn((event: TelemetryEvent) => ({
        indexes: [event.traceId],
        blobs: ["custom", event.tenantId],
        doubles: [999],
      }));

      const emitter = new TelemetryEmitter({ dataset, mapper: customMapper });
      await emitter.emitAsync(validEvent);

      expect(customMapper).toHaveBeenCalledWith(validEvent);
      expect(writeDataPoint).toHaveBeenCalledWith({
        indexes: ["trace-test-1234"],
        blobs: ["custom", "tenant-omega"],
        doubles: [999],
      });
    });
  });

  describe("Architectural Invariant: Non-blocking hot path & error suppression", () => {
    it("suppresses validation errors and calls onError in non-blocking mode (default)", async () => {
      const writeDataPoint = vi.fn();
      const dataset: AnalyticsEngineDataset = { writeDataPoint };
      const onError = vi.fn();

      const emitter = new TelemetryEmitter({ dataset, onError });
      const invalid = { ...validEvent, tenantId: "" };

      // emit should not throw
      expect(() => emitter.emit(invalid)).not.toThrow();

      // Give async microtask a moment to settle
      await new Promise((r) => setTimeout(r, 10));

      expect(writeDataPoint).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(InvalidTelemetryEventError);
    });

    it("throws InvalidTelemetryEventError on invalid event in strict mode", () => {
      const emitter = new TelemetryEmitter({ strict: true });
      const invalid = { ...validEvent, tenantId: "" };

      expect(() => emitter.emit(invalid)).toThrow(InvalidTelemetryEventError);
    });

    it("throws TelemetryEmissionError on write failure in strict mode", () => {
      const dataset: AnalyticsEngineDataset = {
        writeDataPoint: () => {
          throw new Error("Disk full");
        },
      };
      const emitter = new TelemetryEmitter({ dataset, strict: true });

      expect(() => emitter.emit(validEvent)).toThrow(TelemetryEmissionError);
    });

    it("safely handles exceptions thrown within user-defined onError", async () => {
      const dataset: AnalyticsEngineDataset = {
        writeDataPoint: () => {
          throw new Error("Sink error");
        },
      };
      const badOnError = vi.fn(() => {
        throw new Error("Exception inside onError handler");
      });

      const emitter = new TelemetryEmitter({ dataset, onError: badOnError });

      // Must never bubble or crash
      await expect(emitter.emitAsync(validEvent)).resolves.toBeUndefined();
      expect(badOnError).toHaveBeenCalledTimes(1);
    });
  });
});
