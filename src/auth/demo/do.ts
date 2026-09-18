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

import {
  DEFAULT_GLOBAL_RPM_LIMIT,
  DEFAULT_IP_RPD_LIMIT,
  DEFAULT_IP_RPM_LIMIT,
  DEFAULT_ROTATION_INTERVAL_MS,
  DEFAULT_STALE_PRUNE_MS,
} from "./constants";
import { DemoSandbox, generateDemoToken, validateDemoToken } from "./sandbox";
import { DemoStorage } from "./storage";
import type {
  ActiveDemoToken,
  CheckAndConsumeResult,
  DemoDOOptions,
  DemoRateLimitResult,
  DurableObjectStateLike,
  IpWindowData,
  TokenValidationResult,
} from "./types";

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

  private readonly storageManager: DemoStorage;
  private readonly sandbox: DemoSandbox;

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

    this.storageManager = new DemoStorage(this.ctx.storage);
    this.sandbox = new DemoSandbox({
      ipRpmLimit: this.ipRpmLimit,
      ipRpdLimit: this.ipRpdLimit,
      globalRpmLimit: this.globalRpmLimit,
      stalePruneMs: this.stalePruneMs,
    });

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

    const { token: savedToken, expiresAt: savedExpiry } =
      await this.storageManager.loadTokenData();
    const now = this.now();

    if (savedToken && savedExpiry && savedExpiry > now) {
      this.currentToken = savedToken;
      this.tokenExpiresAt = savedExpiry;
      // Reschedule alarm for remaining token lifetime
      await this.storageManager.scheduleAlarm(this.tokenExpiresAt);
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
    const now = this.now();
    this.tokenExpiresAt = now + this.rotationIntervalMs;
    this.currentToken = generateDemoToken(now);

    await this.storageManager.persistTokenData(
      this.currentToken,
      this.tokenExpiresAt
    );

    // Prune stale IP rate-limiting windows (inactive for >= stalePruneMs)
    this.sandbox.pruneStaleWindows(now);

    // Reschedule next rotation alarm
    await this.storageManager.scheduleAlarm(this.tokenExpiresAt);
  }

  /**
   * Returns the active ephemeral demo token and expiration timestamp.
   */
  public async getActiveDemoToken(): Promise<ActiveDemoToken> {
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
  public async validateToken(token: string): Promise<TokenValidationResult> {
    await this.ensureReady();
    return validateDemoToken(
      token,
      this.currentToken,
      this.tokenExpiresAt,
      this.now()
    );
  }

  /**
   * Evaluates rate limits for a given IP and the global demo pool without recording a request.
   */
  public async checkRateLimit(ip: string): Promise<DemoRateLimitResult> {
    await this.ensureReady();
    return this.sandbox.checkRateLimit(ip, this.now());
  }

  /**
   * Records a request for a client IP and increments sliding counters.
   * Returns rate limit diagnostic details.
   */
  public async recordRequest(ip: string): Promise<DemoRateLimitResult> {
    await this.ensureReady();
    return this.sandbox.recordRequest(ip, this.now());
  }

  /**
   * Validates token and checks/records IP rate limit in a single atomic operation.
   */
  public async checkAndConsume(
    ip: string,
    token: string
  ): Promise<CheckAndConsumeResult> {
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
          ? "Demo pool saturated: 5 RPM global limit. Try again in 30s."
          : rateLimit.reason === "global_rpd_exceeded"
          ? "Demo pool saturated: 20 RPD global limit reached today. Please sign in or wait."
          : `IP demo quota exceeded (${rateLimit.reason === "ip_rpd_exceeded" ? "5 RPD" : "1 RPM"} limit). Please sign in or wait.`;

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
    return this.sandbox.getIpSlidingWindows();
  }

  /**
   * Returns IP window data for a specific IP if present.
   */
  public getIpWindow(ip: string): IpWindowData | undefined {
    return this.sandbox.getIpWindow(ip);
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

    // 2. GET or POST /token or /api/demo/token or /
    if (
      (method === "GET" || method === "POST") &&
      (url.pathname === "/token" ||
        url.pathname === "/api/demo/token" ||
        url.pathname === "/")
    ) {
      const tokenData = await this.getActiveDemoToken();
      const expiresInSeconds = Math.max(
        0,
        Math.floor((tokenData.expiresAt - this.now()) / 1000)
      );
      return Response.json(
        { ...tokenData, expiresInSeconds },
        { headers: jsonHeaders }
      );
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
