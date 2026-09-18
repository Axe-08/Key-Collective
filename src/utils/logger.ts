export interface LoggerContext {
  traceId: string;
  tenantId: string;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  traceId: string;
  tenantId: string;
  [key: string]: unknown;
}

export class Logger {
  private readonly ctx: LoggerContext;

  constructor(ctx: { traceId: string; tenantId: string }) {
    this.ctx = ctx;
  }

  private log(level: LogLevel, msg: string, meta?: Record<string, unknown> | unknown): void {
    const entry: LogEntry = {
      level,
      message: msg,
      timestamp: new Date().toISOString(),
      traceId: this.ctx.traceId,
      tenantId: this.ctx.tenantId,
      ...(meta && typeof meta === 'object' && !Array.isArray(meta)
        ? (meta as Record<string, unknown>)
        : meta !== undefined
          ? { meta }
          : {}),
    };

    const serialized = JSON.stringify(entry);
    if (level === 'error') {
      console.error(serialized);
    } else if (level === 'warn') {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }

  info(msg: string, meta?: Record<string, unknown> | unknown): void {
    this.log('info', msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown> | unknown): void {
    this.log('warn', msg, meta);
  }

  error(msg: string, meta?: Record<string, unknown> | unknown): void {
    this.log('error', msg, meta);
  }
}
