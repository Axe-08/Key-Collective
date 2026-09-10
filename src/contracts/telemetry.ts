export interface TelemetryEvent {
    traceId: string;
    tenantId: string;
    timestamp: number;
    eventType: string;
    latencyMs: number;
    costMicrodollars: bigint;
    metadata: Record<string, string>;
}

export interface TelemetryContract {
    emit(event: TelemetryEvent): void;
}
