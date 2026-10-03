export interface TelemetryEvent {
    traceId: string;
    tenantId: string;
    timestamp: number;
    eventType: string;
    latencyMs: number;
    costCu?: bigint;
    cu?: bigint;
    metadata: Record<string, string>;
}

export interface TelemetryContract {
    emit(event: TelemetryEvent): void;
}
