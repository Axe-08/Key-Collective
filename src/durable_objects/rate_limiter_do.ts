/**
 * Key Collective v3 — Abuse Prevention & Rate Limiting
 * RateLimiterDO — Sliding-window Rate Limiter Durable Object
 *
 * Conforms to:
 * - docs/REMEDIATION_PLAN.md (WP-0.4: Lock down abuse takedown and key listing)
 * - GEMINI.md Constitution:
 *   - Strict TypeScript (no `any`).
 *   - Per-Tenant DO Isolation: Isolated state per DO ID (`abuse:${ip}`).
 *   - DO Transactional Storage: Hot state stored in this.ctx.storage.
 */

/**
 * Result returned by RateLimiterDO rate limit check.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Minimal storage interface contract for RateLimiterDO.
 */
export interface RateLimiterStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete?(key: string): Promise<boolean | void>;
  [key: string]: unknown;
}

/**
 * Minimal state interface for RateLimiterDO constructor.
 */
export interface RateLimiterStateLike {
  storage: RateLimiterStorageLike;
  [key: string]: unknown;
}

export interface RateLimiterDOOptions {
  timeProvider?: () => number;
}

/**
 * RateLimiterDO implements a sliding window rate limiter backed by DO transactional storage.
 */
export class RateLimiterDO implements DurableObject {
  private readonly timeProvider: () => number;

  constructor(
    private readonly ctx: DurableObjectState | RateLimiterStateLike,
    private readonly env?: unknown,
    options?: RateLimiterDOOptions
  ) {
    this.timeProvider = options?.timeProvider ?? (() => Date.now());
  }

  private now(): number {
    return this.timeProvider();
  }

  /**
   * Sliding window rate limit check.
   * Prunes entries older than now - windowMs.
   * If count >= limit, returns allowed=false.
   * Else appends timestamp, persists to this.ctx.storage, and returns allowed=true.
   */
  public async checkLimit(
    limit: number = 5,
    windowMs: number = 3_600_000
  ): Promise<RateLimitResult> {
    const now = this.now();
    const cutoff = now - windowMs;
    const stored = (await this.ctx.storage.get<number[]>("timestamps")) ?? [];

    // Prune entries older than now - windowMs
    const valid = stored.filter((t) => typeof t === "number" && t > cutoff);

    if (valid.length >= limit) {
      if (valid.length !== stored.length) {
        await this.ctx.storage.put("timestamps", valid);
      }
      const resetAt = valid.length > 0 ? valid[0] + windowMs : now + windowMs;
      return {
        allowed: false,
        remaining: 0,
        resetAt,
      };
    }

    valid.push(now);
    await this.ctx.storage.put("timestamps", valid);

    const remaining = Math.max(0, limit - valid.length);
    const resetAt = valid[0] + windowMs;

    return {
      allowed: true,
      remaining,
      resetAt,
    };
  }

  /**
   * HTTP fetch handler for RateLimiterDO.
   */
  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let limit = 5;
    let windowMs = 3_600_000;

    if (request.method === "POST") {
      try {
        const body = (await request.json().catch(() => ({}))) as {
          limit?: number;
          windowMs?: number;
        };
        if (typeof body.limit === "number") limit = body.limit;
        if (typeof body.windowMs === "number") windowMs = body.windowMs;
      } catch {
        // Fall back to query params or defaults
      }
    }

    if (url.searchParams.has("limit")) {
      const qLimit = Number(url.searchParams.get("limit"));
      if (!Number.isNaN(qLimit)) limit = qLimit;
    }
    if (url.searchParams.has("windowMs")) {
      const qWindowMs = Number(url.searchParams.get("windowMs"));
      if (!Number.isNaN(qWindowMs)) windowMs = qWindowMs;
    }

    const result = await this.checkLimit(limit, windowMs);
    const retryAfter = Math.max(0, Math.ceil((result.resetAt - this.now()) / 1000));

    return Response.json(result, {
      status: result.allowed ? 200 : 429,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
        ...(result.allowed ? {} : { "Retry-After": String(retryAfter) }),
      },
    });
  }
}
