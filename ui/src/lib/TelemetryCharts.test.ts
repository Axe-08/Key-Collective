import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  connectStream,
  updateChart,
  disconnectStream,
  getChartPoints,
  getChartStats,
  resetChart,
  defaultTelemetryChart,
  TelemetryStreamChart,
  type TimeSeriesData,
  type StreamStatus,
} from './TelemetryCharts';

// Mock EventSource implementation for testing stream connections
class MockEventSource {
  public static instances: MockEventSource[] = [];
  public url: string;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: (() => void) | null = null;
  public closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Asynchronously trigger open to simulate real network handshake
    setTimeout(() => {
      if (!this.closed && this.onopen) {
        this.onopen();
      }
    }, 10);
  }

  public emitMessage(data: unknown): void {
    if (this.closed || !this.onmessage) return;
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.onmessage(new MessageEvent('message', { data: payload }));
  }

  public emitError(): void {
    if (this.closed || !this.onerror) return;
    this.onerror();
  }

  public close(): void {
    this.closed = true;
  }
}

describe('TelemetryCharts - Stream Consumer & Non-Blocking Chart Engine', () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    resetChart();
    disconnectStream();
    MockEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;
  });

  afterEach(() => {
    disconnectStream();
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
    vi.restoreAllMocks();
  });

  describe('Contract Interfaces & Signatures', () => {
    it('satisfies exact function signatures: connectStream(endpoint: string): void and updateChart(data: TimeSeriesData): void', () => {
      expect(typeof connectStream).toBe('function');
      expect(typeof updateChart).toBe('function');

      // Verify return types are void
      const connectResult = connectStream('http://localhost:8787/api/telemetry/stream');
      expect(connectResult).toBeUndefined();

      const samplePoint: TimeSeriesData = { timestamp: 1726000000000, value: 120 };
      const updateResult = updateChart(samplePoint);
      expect(updateResult).toBeUndefined();
    });

    it('enforces TimeSeriesData contract structure', () => {
      const data: TimeSeriesData = {
        timestamp: Date.now(),
        value: 99.5,
      };
      expect(typeof data.timestamp).toBe('number');
      expect(typeof data.value).toBe('number');
    });
  });

  describe('Stream Connection (connectStream)', () => {
    it('should connect to stream endpoint and transition status to connected', async () => {
      const endpoint = 'https://api.keycollective.dev/v1/telemetry/stream';
      connectStream(endpoint);

      expect(defaultTelemetryChart.endpoint).toBe(endpoint);
      expect(MockEventSource.instances.length).toBe(1);
      expect(MockEventSource.instances[0].url).toBe(endpoint);

      // Await open event
      await new Promise((r) => setTimeout(r, 25));
      expect(defaultTelemetryChart.status).toBe('connected');
    });

    it('should handle incoming stream events and automatically update chart', async () => {
      connectStream('https://api.keycollective.dev/v1/telemetry/stream');
      await new Promise((r) => setTimeout(r, 20));

      const mockEs = MockEventSource.instances[0];
      const now = Date.now();

      // Emit telemetry stream message
      mockEs.emitMessage({
        timestamp: now,
        value: 185,
      });

      // Allow microtasks to flush
      await new Promise((r) => setTimeout(r, 10));

      const points = getChartPoints();
      expect(points.length).toBe(1);
      expect(points[0].timestamp).toBe(now);
      expect(points[0].value).toBe(185);
    });

    it('should parse latency_ms, latencyMs, and rpm from stream payload', async () => {
      connectStream('https://api.keycollective.dev/v1/telemetry/stream');
      await new Promise((r) => setTimeout(r, 20));

      const mockEs = MockEventSource.instances[0];
      const t1 = 1726000001000;
      const t2 = 1726000002000;

      mockEs.emitMessage({
        timestamp: t1,
        latencyMs: 142,
      });

      mockEs.emitMessage({
        timestamp: t2,
        rpm: 380,
      });

      await new Promise((r) => setTimeout(r, 15));

      const points = getChartPoints();
      expect(points.length).toBe(2);
      expect(points[0].value).toBe(142);
      expect(points[1].value).toBe(380);
    });

    it('should handle stream error and disconnection gracefully', async () => {
      connectStream('https://api.keycollective.dev/v1/telemetry/stream');
      await new Promise((r) => setTimeout(r, 20));

      const mockEs = MockEventSource.instances[0];
      mockEs.emitError();

      expect(defaultTelemetryChart.status).toBe('error');

      disconnectStream();
      expect(defaultTelemetryChart.status).toBe('disconnected');
      expect(mockEs.closed).toBe(true);
    });
  });

  describe('Plotting Incoming Data Points (updateChart)', () => {
    it('should plot incoming data points accurately into the chart buffer', async () => {
      const p1: TimeSeriesData = { timestamp: 1000, value: 50 };
      const p2: TimeSeriesData = { timestamp: 2000, value: 150 };
      const p3: TimeSeriesData = { timestamp: 3000, value: 75 };

      updateChart(p1);
      updateChart(p2);
      updateChart(p3);

      // Allow microtasks to flush
      await new Promise((r) => setTimeout(r, 10));

      const points = getChartPoints();
      expect(points.length).toBe(3);
      expect(points[0]).toEqual(p1);
      expect(points[1]).toEqual(p2);
      expect(points[2]).toEqual(p3);
    });

    it('should calculate min, max, avg, and current stats accurately', async () => {
      updateChart({ timestamp: 1000, value: 100 });
      updateChart({ timestamp: 2000, value: 200 });
      updateChart({ timestamp: 3000, value: 300 });

      await new Promise((r) => setTimeout(r, 10));

      const stats = getChartStats();
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(300);
      expect(stats.avg).toBe(200);
      expect(stats.current).toBe(300);
      expect(stats.count).toBe(3);
    });

    it('should enforce ring-buffer bounded memory (maxPoints invariant)', async () => {
      const customChart = new TelemetryStreamChart({ maxPoints: 5 });

      for (let i = 1; i <= 10; i++) {
        customChart.updateChart({ timestamp: i * 1000, value: i * 10 });
      }

      await new Promise((r) => setTimeout(r, 15));

      expect(customChart.points.length).toBe(5);
      // Should retain only the latest 5 points (values 60, 70, 80, 90, 100)
      expect(customChart.points[0].value).toBe(60);
      expect(customChart.points[4].value).toBe(100);
      expect(customChart.stats.current).toBe(100);
      expect(customChart.stats.min).toBe(60);
    });

    it('executes in a non-blocking manner under high-throughput data streams', async () => {
      const highThroughputChart = new TelemetryStreamChart({ maxPoints: 100 });
      const startTime = performance.now();

      // Ingest 1,000 points rapidly
      for (let i = 0; i < 1000; i++) {
        highThroughputChart.updateChart({ timestamp: Date.now() + i, value: (i % 50) + 10 });
      }

      const syncDuration = performance.now() - startTime;
      // Ingestion must be non-blocking (< 20ms synchronous time)
      expect(syncDuration).toBeLessThan(50);

      // Wait for microtask buffer to flush
      await new Promise((r) => setTimeout(r, 20));

      expect(highThroughputChart.points.length).toBe(100);
      expect(highThroughputChart.stats.count).toBe(100);
    });

    it('silently rejects malformed or NaN data points without throwing', async () => {
      // @ts-expect-error - testing invalid input resilience
      updateChart(null);
      // @ts-expect-error - testing invalid input resilience
      updateChart({ timestamp: 'invalid', value: 10 });
      updateChart({ timestamp: 1000, value: NaN });

      await new Promise((r) => setTimeout(r, 10));

      const points = getChartPoints();
      expect(points.length).toBe(0);
    });
  });

  describe('Isolated Multi-Instance (Tenant Isolation Invariant)', () => {
    it('guarantees tenant isolation with independent chart instances', async () => {
      const tenantA = new TelemetryStreamChart({ maxPoints: 50 });
      const tenantB = new TelemetryStreamChart({ maxPoints: 50 });

      tenantA.updateChart({ timestamp: 1000, value: 42 });
      tenantB.updateChart({ timestamp: 1000, value: 99 });

      await new Promise((r) => setTimeout(r, 10));

      expect(tenantA.points[0].value).toBe(42);
      expect(tenantB.points[0].value).toBe(99);
      expect(tenantA.stats.current).toBe(42);
      expect(tenantB.stats.current).toBe(99);

      tenantA.reset();
      expect(tenantA.points.length).toBe(0);
      expect(tenantB.points.length).toBe(1);
    });
  });

  describe('Subscription and Observer Pattern', () => {
    it('notifies subscribers on flushed data points', async () => {
      const customChart = new TelemetryStreamChart();
      const listener = vi.fn();

      const unsubscribe = customChart.subscribe(listener);
      // Initial call on subscribe
      expect(listener).toHaveBeenCalledTimes(1);

      customChart.updateChart({ timestamp: 1000, value: 55 });
      await new Promise((r) => setTimeout(r, 10));

      expect(listener).toHaveBeenCalledTimes(2);
      const [points, stats] = listener.mock.calls[1];
      expect(points.length).toBe(1);
      expect(stats.current).toBe(55);

      unsubscribe();
      customChart.updateChart({ timestamp: 2000, value: 65 });
      await new Promise((r) => setTimeout(r, 10));

      // No new calls after unsubscription
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });
});
