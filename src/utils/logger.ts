export interface LoggerContext {
  traceId: string;
  tenantId: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  traceId: string;
  tenantId: string;
  [key: string]: unknown;
}

/** Errors have no enumerable fields, so spreading one into a log entry loses it. */
function normalizeMeta(meta: unknown): Record<string, unknown> {
  if (meta === undefined) return {};
  if (meta instanceof Error) {
    return { error: meta.message, errorName: meta.name };
  }
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      out[k] = v instanceof Error ? v.message : v;
    }
    return out;
  }
  return { meta };
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
      ...normalizeMeta(meta),
    };

    const serialized = JSON.stringify(entry);
    if (level === 'error') {
      console.error(serialized);
    } else if (level === 'warn') {
      console.warn(serialized);
    } else if (level === 'debug') {
      console.debug(serialized);
    } else {
      console.log(serialized);
    }
  }

  debug(msg: string, meta?: Record<string, unknown> | unknown): void {
    this.log('debug', msg, meta);
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
