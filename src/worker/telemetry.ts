/**
 * Key Collective v2 — Telemetry Emitter
 * Implements TelemetryContract to stream events to Workers Analytics Engine.
 */

import type { TelemetryContract, TelemetryEvent } from "../contracts/telemetry";
import type { WorkerEnv } from "./env";

export class AnalyticsEmitter implements TelemetryContract {
  constructor(private env: WorkerEnv) {}

  public emit(event: TelemetryEvent): void {
    this.env.ANALYTICS.writeDataPoint({
      blobs: [event.tenantId, event.eventType, event.traceId],
      doubles: [event.latencyMs, Number(event.costMicrodollars)],
    });
  }
}

export type { TelemetryContract, TelemetryEvent };
