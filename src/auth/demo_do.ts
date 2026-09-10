/**
 * Key Collective v3 — Ephemeral Demo Tier State Machine & DO Alarm Engine
 * DemoDO — Autonomous Singleton Demo Durable Object
 *
 * Conforms to:
 * - docs/system_design_v3.md (Section 3: Ephemeral Demo Tier State Machine & DO Alarm Engine)
 * - docs/adr/003-multi-project-tiered-architecture.md (Section 3: Global Demo Pool)
 * - docs/architecture/lld_pod-auth-sybil.md (Section 4.3: Demo Durable Object)
 *
 * Invariants (GEMINI.md):
 * - TypeScript (strict mode, zero `any`).
 * - Per-Tenant DO Isolation: State isolated in global_demo_pool DO instance.
 * - Ephemeral State: Operates on 15-minute token rotation alarm via this.ctx.storage.setAlarm.
 * - Sliding Window Rate Limiting: 3 RPM / IP, 25 RPD / IP, 20 RPM shared global pool.
 * - Zero Floating-Point Math for financial/rate-limit metrics.
 */

/**
 * Default intervals and rate limits for Demo Tier.
 */
export const DEFAULT_ROTATION_INTERVAL_MS = 15 * 60 * 1000; // 15 Minutes (900,000 ms)
export const DEFAULT_IP_RPM_LIMIT = 3; // 3 requests per minute per IP
export const DEFAULT_IP_RPD_LIMIT = 25; // 25 requests per day per IP
export const DEFAULT_GLOBAL_RPM_LIMIT = 20; // 20 requests per minute global playground ceiling
export const DEFAULT_STALE_PRUNE_MS = 60 * 60 * 1000; // 1 hour (3,600,000 ms)

export const STORAGE_KEY_TOKEN = "demo:token";
export const STORAGE_KEY_EXPIRY = "demo:expiry";

/**
 * Storage contract for DemoDO Durable Object storage.
 * Compatible with Cloudflare Workers DurableObjectStorage.
 */
export interface DemoDOStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  put<T>(entries: Record<string, T>): Promise<void>;
  delete?(key: string): Promise<boolean>;
  delete?(keys: string[]): Promise<number>;
  deleteAll?(): Promise<void>;
  list?<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  getAlarm?(): Promise<number | null>;
  deleteAlarm?(): Promise<void>;
}

/**
 * Minimal state contract for Cloudflare DurableObjectState.
 */
export interface DurableObjectStateLike {
  readonly id: {
    toString(): string;
    readonly name?: string;
  };
  readonly storage: DemoDOStorageLike;
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile?<T>(callback: () => Promise<T>): Promise<T>;
}

/**
 * Sliding window record for an individual client IP.
 */
export interface IpWindowData {
  /** Total requests recorded in active window (for compatibility with system design v3) */
  requests: number;
  /** Timestamp marking start or last activity of window (for 1-hour pruning) */
  windowStart: number;
  /** Array of request timestamps in ms */
  timestamps: number[];
  /** Timestamp marking current minute window start */
  minuteWindowStart?: number;
  /** Number of requests in current minute window */
  minuteRequests?: number;
  /** Timestamp marking current 24-hour day window start */
  dayWindowStart?: number;
  /** Number of requests in current 24-hour day window */
  dayRequests?: number;
}

/**
 * Diagnostic result of checking or recording demo rate limits.
 */
export interface DemoRateLimitResult {
  allowed: boolean;
  currentRpm: number;
  rpmLimit: number;
  currentRpd: number;
  rpdLimit: number;
  globalRpm: number;
  globalRpmLimit: number;
  retryAfterSeconds?: number;
  reason?: "ip_rpm_exceeded" | "ip_rpd_exceeded" | "global_rpm_exceeded";
}

/**
 * Configuration options for DemoDO.
 */
export interface DemoDOOptions {
  /** Rotation interval in milliseconds (defaults to 15 minutes) */
  rotationIntervalMs?: number;
  /** Requests per minute limit per IP (defaults to 3) */
  ipRpmLimit?: number;
  /** Requests per day limit per IP (defaults to 25) */
  ipRpdLimit?: number;
  /** Global shared demo pool requests per minute ceiling (defaults to 20) */
  globalRpmLimit?: number;
  /** Inactivity duration before pruning stale IP windows (defaults to 1 hour) */
  stalePruneMs?: number;
  /** Injectable time provider for deterministic testing (defaults to Date.now) */
  timeProvider?: () => number;
}

/**
 * DemoDO — Autonomous Singleton Demo Durable Object.
 * Manages 15-minute rotating ephemeral playground tokens and per-IP sliding windows.
 */
export class DemoDO implements DurableObject {
  private currentToken: string = "";
  private tokenExpiresAt: number = 0;
  private readonly rotationIntervalMs: number;
  private readonly ipRpmLimit: number;
  private readonly ipRpdLimit: number;
  private readonly globalRpmLimit: number;
  private readonly stalePruneMs: number;
  private readonly timeProvider: () => number;

  private readonly ipSlidingWindows: Map<string, IpWindowData> = new Map();
  private globalTimestamps: number[] = [];

  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(
    private readonly ctx: DurableObjectStateLike,
    private readonly env?: unknown,
    options?: DemoDOOptions
  ) {
    this.rotationIntervalMs =
      options?.rotationIntervalMs ?? DEFAULT_ROTATION_INTERVAL_MS;
    this.ipRpmLimit = options?.ipRpmLimit ?? DEFAULT_IP_RPM_LIMIT;
    this.ipRpdLimit = options?.ipRpdLimit ?? DEFAULT_IP_RPD_LIMIT;
    this.globalRpmLimit = options?.globalRpmLimit ?? DEFAULT_GLOBAL_RPM_LIMIT;
    this.stalePruneMs = options?.stalePruneMs ?? DEFAULT_STALE_PRUNE_MS;
    this.timeProvider = options?.timeProvider ?? (() => Date.now());

    if (this.ctx.blockConcurrencyWhile) {
      this.initializationPromise = this.ctx.blockConcurrencyWhile(async () => {
        await this.ensureInitialized();
      });
    } else {
      this.initializationPromise = this.ensureInitialized();
    }
  }

  /**
   * Returns the current timestamp from timeProvider.
   */
  private now(): number {
    return this.timeProvider();
  }

  /**
   * Guarantees that asynchronous initialization has finished before servicing requests.
   */
  private async ensureReady(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
    if (!this.initialized) {
      await this.ensureInitialized();
    }
  }

  /**
   * Initializes or restores active demo token from transactional DO storage.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const savedToken = await this.ctx.storage.get<string>(STORAGE_KEY_TOKEN);
    const savedExpiry = await this.ctx.storage.get<number>(STORAGE_KEY_EXPIRY);
    const now = this.now();

    if (savedToken && savedExpiry && savedExpiry > now) {
      this.currentToken = savedToken;
      this.tokenExpiresAt = savedExpiry;
      // Reschedule alarm for remaining token lifetime
      await this.ctx.storage.setAlarm(this.tokenExpiresAt);
    } else {
      await this.rotateToken();
    }

    this.initialized = true;
  }

  /**
   * Scheduled 15-minute rotation fired by Cloudflare DO runtime.
   */
  public async alarm(): Promise<void> {
    await this.ensureReady();
    await this.rotateToken();
  }

  /**
   * Rotates the active demo token, persists to storage, prunes stale IP state,
   * and schedules the next DO alarm.
   */
  public async rotateToken(): Promise<void> {
    const webCrypto =
      typeof crypto !== "undefined"
        ? crypto
        : (globalThis as unknown as { crypto: Crypto }).crypto;

    const randomBytes = webCrypto.getRandomValues(new Uint8Array(16));
    const tokenSuffix = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);
    const now = this.now();

    this.tokenExpiresAt = now + this.rotationIntervalMs;
    this.currentToken = `kc_demo_${Math.floor(now / 1000)}_${tokenSuffix}`;

    await this.ctx.storage.put(STORAGE_KEY_TOKEN, this.currentToken);
    await this.ctx.storage.put(STORAGE_KEY_EXPIRY, this.tokenExpiresAt);

    // Prune stale IP rate-limiting windows (inactive for >= stalePruneMs)
    const pruneThreshold = now - this.stalePruneMs;
    for (const [ip, data] of this.ipSlidingWindows.entries()) {
      if (data.windowStart < pruneThreshold) {
        this.ipSlidingWindows.delete(ip);
      }
    }

    // Reschedule next rotation alarm
    await this.ctx.storage.setAlarm(this.tokenExpiresAt);
  }

  /**
   * Returns the active ephemeral demo token and expiration timestamp.
   */
  public async getActiveDemoToken(): Promise<{
    token: string;
    expiresAt: number;
  }> {
    await this.ensureReady();
    return { token: this.currentToken, expiresAt: this.tokenExpiresAt };
  }

  /**
   * Synchronously inspects the active token string.
   */
  public getCurrentToken(): string {
    return this.currentToken;
  }

  /**
   * Synchronously inspects the active token expiration timestamp.
   */
  public getTokenExpiresAt(): number {
    return this.tokenExpiresAt;
  }

  /**
   * Validates a candidate demo token against the active token and expiration.
   */
  public async validateToken(
    token: string
  ): Promise<{ valid: boolean; reason?: string }> {
    await this.ensureReady();

    if (!token || typeof token !== "string") {
      return { valid: false, reason: "Missing or invalid token format" };
    }

    if (!token.startsWith("kc_demo_")) {
      return { valid: false, reason: "Invalid token prefix: expected kc_demo_" };
    }

    const now = this.now();

    if (token !== this.currentToken) {
      return {
        valid: false,
        reason: "Demo token is invalid or has rotated",
      };
    }

    if (now >= this.tokenExpiresAt) {
      return { valid: false, reason: "Demo token has expired" };
    }

    return { valid: true };
  }

  /**
   * Evaluates rate limits for a given IP and the global demo pool without recording a request.
   */
  public async checkRateLimit(ip: string): Promise<DemoRateLimitResult> {
    await this.ensureReady();
    const now = this.now();
    const oneMinuteAgo = now - 60_000;
    const oneDayAgo = now - 86_400_000;

    // Filter global timestamps in 1-minute window
    const activeGlobal = this.globalTimestamps.filter((t) => t > oneMinuteAgo);
    const globalRpm = activeGlobal.length;

    // Filter IP timestamps in 24-hour window
    const ipData = this.ipSlidingWindows.get(ip);
    const ipTimestamps = ipData
      ? ipData.timestamps.filter((t) => t > oneDayAgo)
      : [];
    const ipMinuteTimestamps = ipTimestamps.filter((t) => t > oneMinuteAgo);
    const ipRpm = ipMinuteTimestamps.length;
    const ipRpd = ipTimestamps.length;

    // 1. IP RPM check (3 RPM)
    if (ipRpm >= this.ipRpmLimit) {
      const oldestInMinute = ipMinuteTimestamps[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldestInMinute + 60_000 - now) / 1000)
      );
      return {
        allowed: false,
        currentRpm: ipRpm,
        rpmLimit: this.ipRpmLimit,
        currentRpd: ipRpd,
        rpdLimit: this.ipRpdLimit,
        globalRpm,
        globalRpmLimit: this.globalRpmLimit,
        retryAfterSeconds,
        reason: "ip_rpm_exceeded",
      };
    }

    // 2. IP RPD check (25 RPD)
    if (ipRpd >= this.ipRpdLimit) {
      const oldestInDay = ipTimestamps[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldestInDay + 86_400_000 - now) / 1000)
      );
      return {
        allowed: false,
        currentRpm: ipRpm,
        rpmLimit: this.ipRpmLimit,
        currentRpd: ipRpd,
        rpdLimit: this.ipRpdLimit,
        globalRpm,
        globalRpmLimit: this.globalRpmLimit,
        retryAfterSeconds,
        reason: "ip_rpd_exceeded",
      };
    }

    // 3. Global pool RPM check (20 RPM)
    if (globalRpm >= this.globalRpmLimit) {
      const oldestGlobal = activeGlobal[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldestGlobal + 60_000 - now) / 1000)
      );
      return {
        allowed: false,
        currentRpm: ipRpm,
        rpmLimit: this.ipRpmLimit,
        currentRpd: ipRpd,
        rpdLimit: this.ipRpdLimit,
        globalRpm,
        globalRpmLimit: this.globalRpmLimit,
        retryAfterSeconds,
        reason: "global_rpm_exceeded",
      };
    }

    return {
      allowed: true,
      currentRpm: ipRpm,
      rpmLimit: this.ipRpmLimit,
      currentRpd: ipRpd,
      rpdLimit: this.ipRpdLimit,
      globalRpm,
      globalRpmLimit: this.globalRpmLimit,
    };
  }

  /**
   * Records a request for a client IP and increments sliding counters.
   * Returns rate limit diagnostic details.
   */
  public async recordRequest(ip: string): Promise<DemoRateLimitResult> {
    await this.ensureReady();
    const check = await this.checkRateLimit(ip);
    if (!check.allowed) {
      return check;
    }

    const now = this.now();
    const oneMinuteAgo = now - 60_000;
    const oneDayAgo = now - 86_400_000;

    // Record global timestamp
    this.globalTimestamps = this.globalTimestamps.filter((t) => t > oneMinuteAgo);
    this.globalTimestamps.push(now);

    // Record IP timestamp
    const existing = this.ipSlidingWindows.get(ip);
    const validTimestamps = existing
      ? existing.timestamps.filter((t) => t > oneDayAgo)
      : [];
    validTimestamps.push(now);

    const ipMinuteTimestamps = validTimestamps.filter((t) => t > oneMinuteAgo);

    const updatedData: IpWindowData = {
      requests: validTimestamps.length,
      windowStart: now,
      timestamps: validTimestamps,
      minuteWindowStart: oneMinuteAgo,
      minuteRequests: ipMinuteTimestamps.length,
      dayWindowStart: oneDayAgo,
      dayRequests: validTimestamps.length,
    };

    this.ipSlidingWindows.set(ip, updatedData);

    return {
      allowed: true,
      currentRpm: ipMinuteTimestamps.length,
      rpmLimit: this.ipRpmLimit,
      currentRpd: validTimestamps.length,
      rpdLimit: this.ipRpdLimit,
      globalRpm: this.globalTimestamps.length,
      globalRpmLimit: this.globalRpmLimit,
    };
  }

  /**
   * Validates token and checks/records IP rate limit in a single atomic operation.
   */
  public async checkAndConsume(
    ip: string,
    token: string
  ): Promise<{
    allowed: boolean;
    status: number;
    message: string;
    retryAfterSeconds?: number;
    rateLimit?: DemoRateLimitResult;
  }> {
    await this.ensureReady();

    const tokenValidation = await this.validateToken(token);
    if (!tokenValidation.valid) {
      return {
        allowed: false,
        status: 401,
        message: tokenValidation.reason ?? "Demo token expired or invalid",
      };
    }

    const rateLimit = await this.recordRequest(ip);
    if (!rateLimit.allowed) {
      const message =
        rateLimit.reason === "global_rpm_exceeded"
          ? "Demo pool saturated: 20 RPM limit. Try again in 30s."
          : `IP demo quota exceeded (${rateLimit.reason === "ip_rpd_exceeded" ? "25 RPD" : "3 RPM"} limit). Please sign in or wait.`;

      return {
        allowed: false,
        status: 429,
        message,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        rateLimit,
      };
    }

    return {
      allowed: true,
      status: 200,
      message: "Request allowed",
      rateLimit,
    };
  }

  /**
   * Returns a read-only snapshot of active IP sliding windows.
   */
  public getIpSlidingWindows(): ReadonlyMap<string, IpWindowData> {
    return this.ipSlidingWindows;
  }

  /**
   * Returns IP window data for a specific IP if present.
   */
  public getIpWindow(ip: string): IpWindowData | undefined {
    return this.ipSlidingWindows.get(ip);
  }

  /**
   * HTTP RPC interface for Worker-to-DO dispatch.
   */
  public async fetch(request: Request): Promise<Response> {
    await this.ensureReady();
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // 1. CORS Preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers":
            "Content-Type, Authorization, x-demo-token, cf-connecting-ip",
          "access-control-max-age": "86400",
        },
      });
    }

    const jsonHeaders = {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    };

    // 2. GET /token or /api/demo/token or /
    if (
      method === "GET" &&
      (url.pathname === "/token" ||
        url.pathname === "/api/demo/token" ||
        url.pathname === "/")
    ) {
      const tokenData = await this.getActiveDemoToken();
      return Response.json(tokenData, { headers: jsonHeaders });
    }

    // 3. GET /limits?ip=...
    if (method === "GET" && url.pathname === "/limits") {
      const ip =
        url.searchParams.get("ip") ??
        request.headers.get("cf-connecting-ip") ??
        "127.0.0.1";
      const result = await this.checkRateLimit(ip);
      return Response.json(result, { headers: jsonHeaders });
    }

    // 4. POST /verify or /validate
    if (
      method === "POST" &&
      (url.pathname === "/verify" || url.pathname === "/validate")
    ) {
      const body = (await request.json().catch(() => ({}))) as {
        token?: string;
        ip?: string;
      };
      if (!body.token) {
        return Response.json(
          { valid: false, error: "Missing token parameter" },
          { status: 400, headers: jsonHeaders }
        );
      }
      const validation = await this.validateToken(body.token);
      if (!validation.valid) {
        return Response.json(
          { valid: false, error: validation.reason },
          { status: 401, headers: jsonHeaders }
        );
      }
      return Response.json(
        { valid: true, expiresAt: this.tokenExpiresAt },
        { headers: jsonHeaders }
      );
    }

    // 5. POST /consume or /check
    if (
      method === "POST" &&
      (url.pathname === "/consume" || url.pathname === "/check")
    ) {
      const body = (await request.json().catch(() => ({}))) as {
        token?: string;
        ip?: string;
      };
      const ip =
        body.ip ?? request.headers.get("cf-connecting-ip") ?? "127.0.0.1";
      if (!body.token) {
        return Response.json(
          { allowed: false, error: "Missing token parameter" },
          { status: 400, headers: jsonHeaders }
        );
      }
      const result = await this.checkAndConsume(ip, body.token);
      const responseHeaders: Record<string, string> = { ...jsonHeaders };
      if (result.retryAfterSeconds) {
        responseHeaders["retry-after"] = String(result.retryAfterSeconds);
      }
      return Response.json(result, {
        status: result.status,
        headers: responseHeaders,
      });
    }

    // 6. POST /rotate (manual administrative / testing rotation)
    if (method === "POST" && url.pathname === "/rotate") {
      await this.rotateToken();
      const tokenData = await this.getActiveDemoToken();
      return Response.json(tokenData, { headers: jsonHeaders });
    }

    return Response.json(
      { error: "Not Found" },
      { status: 404, headers: jsonHeaders }
    );
  }
}
