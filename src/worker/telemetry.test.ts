import { describe, it, expect, vi } from "vitest";
import { AnalyticsEmitter } from "./telemetry";
import type { TelemetryEvent } from "../contracts/telemetry";
import type { WorkerEnv } from "./env";

describe("AnalyticsEmitter", () => {
  it("writes a formatted data point to the Analytics Engine dataset when emit is called", () => {
    const writeDataPoint = vi.fn();
    const mockEnv = {
      ANALYTICS: {
        writeDataPoint,
      },
    } as unknown as WorkerEnv;

    const emitter = new AnalyticsEmitter(mockEnv);

    const event: TelemetryEvent = {
      traceId: "trace-xyz-123",
      tenantId: "tenant-abc-789",
      timestamp: 1726000000000,
      eventType: "chat_completion",
      latencyMs: 145,
      costMicrodollars: 2500n,
      metadata: {
        model: "gpt-4o",
      },
    };

    emitter.emit(event);

    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ["tenant-abc-789", "chat_completion", "trace-xyz-123"],
      doubles: [145, 2500],
    });
  });

  it("handles zero values for latency and costMicrodollars correctly", () => {
    const writeDataPoint = vi.fn();
    const mockEnv = {
      ANALYTICS: {
        writeDataPoint,
      },
    } as unknown as WorkerEnv;

    const emitter = new AnalyticsEmitter(mockEnv);

    const event: TelemetryEvent = {
      traceId: "trace-zero-1",
      tenantId: "tenant-zero",
      timestamp: 1726000000000,
      eventType: "ping",
      latencyMs: 0,
      costMicrodollars: 0n,
      metadata: {},
    };

    emitter.emit(event);

    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ["tenant-zero", "ping", "trace-zero-1"],
      doubles: [0, 0],
    });
  });
});
