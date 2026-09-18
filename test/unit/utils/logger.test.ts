import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "../../../src/utils/logger";

describe("Logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("instantiates correctly with traceId and tenantId", () => {
    const logger = new Logger({ traceId: "trace-123", tenantId: "tenant-abc" });
    expect(logger).toBeInstanceOf(Logger);
  });

  it("logs info message with structured JSON to console.log", () => {
    const logger = new Logger({ traceId: "trace-123", tenantId: "tenant-abc" });
    logger.info("System ready", { status: "OK", count: 42 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0][0]);

    expect(payload.level).toBe("info");
    expect(payload.message).toBe("System ready");
    expect(payload.traceId).toBe("trace-123");
    expect(payload.tenantId).toBe("tenant-abc");
    expect(payload.status).toBe("OK");
    expect(payload.count).toBe(42);
    expect(typeof payload.timestamp).toBe("string");
  });

  it("logs warn message to console.warn", () => {
    const logger = new Logger({ traceId: "trace-123", tenantId: "tenant-abc" });
    logger.warn("High memory usage", { usagePercent: 85 });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0][0]);

    expect(payload.level).toBe("warn");
    expect(payload.message).toBe("High memory usage");
    expect(payload.usagePercent).toBe(85);
  });

  it("logs error message to console.error", () => {
    const logger = new Logger({ traceId: "trace-123", tenantId: "tenant-abc" });
    logger.error("Database connection failed", { code: "ECONNREFUSED" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(errorSpy.mock.calls[0][0]);

    expect(payload.level).toBe("error");
    expect(payload.message).toBe("Database connection failed");
    expect(payload.code).toBe("ECONNREFUSED");
  });

  it("handles empty meta gracefully", () => {
    const logger = new Logger({ traceId: "trace-123", tenantId: "tenant-abc" });
    logger.info("Heartbeat");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0][0]);

    expect(payload.level).toBe("info");
    expect(payload.message).toBe("Heartbeat");
    expect(payload.traceId).toBe("trace-123");
    expect(payload.tenantId).toBe("tenant-abc");
  });

  it("conforms to the exact specified signature interface", () => {
    interface ExpectedLoggerInterface {
      info(msg: string, meta?: any): void;
      warn(msg: string, meta?: any): void;
      error(msg: string, meta?: any): void;
    }

    const logger = new Logger({ traceId: "t-1", tenantId: "t-2" });
    const typedLogger: ExpectedLoggerInterface = logger;
    expect(typeof typedLogger.info).toBe("function");
    expect(typeof typedLogger.warn).toBe("function");
    expect(typeof typedLogger.error).toBe("function");
  });
});
