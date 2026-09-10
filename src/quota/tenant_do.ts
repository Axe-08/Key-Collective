/**
 * Key Collective v3 — Multi-Project, Anti-Sybil & Tiered Developer Platform
 * TenantQuotaDO — Per-Tenant Stateful Durable Object for Quota Enforcement
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * 1. No Plaintext Keys: AES-256-GCM encryption with 12-byte CSPRNG nonces.
 * 2. Per-Tenant DO Isolation: Isolated via Durable Objects (`idFromName(tenantId)`). Zero cross-tenant state.
 * 3. Fixed-Point Microdollars: All financial tracking in int64/bigint microdollars (1 USD = 1,000,000 µ$). Zero floating-point math.
 * 4. DO Transactional Storage for Hot State: In-memory sliding counters sync to `this.ctx.storage` (survives eviction).
 * 5. Strict TypeScript: Strict mode, no `any`, full runtime assertion guards.
 */

import {
  TIER_LIMITS_MAP,
  TierLimits,
  UserTier,
} from "../contracts/v3_types";
import { TenantIsolationError } from "../errors/auth_errors";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "../errors/key_errors";
import { calculateProjectQuota, getTierLimits } from "./limits";
import type { DurableObjectStorageLike } from "../durable_objects/circuit_breaker";

export type { DurableObjectStorageLike } from "../durable_objects/circuit_breaker";

/**
 * Minimal interface for Cloudflare DurableObjectState.
 */
export interface DurableObjectStateLike {
  readonly id: {
    toString(): string;
    readonly name?: string;
  };
  readonly storage: DurableObjectStorageLike;
  waitUntil?(promise: Promise<unknown>): void;
  blockConcurrencyWhile?<T>(callback: () => Promise<T>): Promise<T>;
}

/**
 * Base DurableObject class compliant with Cloudflare Workers runtime
 * and test environments without cloudflare:workers package imports.
 */
export class DurableObject {
  protected readonly ctx: DurableObjectStateLike;
  protected readonly env: unknown;

  constructor(
    ctx: DurableObjectState | DurableObjectStateLike,
    env?: unknown
  ) {
    this.ctx = ctx as DurableObjectStateLike;
    this.env = env;
  }
}

/**
 * Individual timestamped counter entry in the sliding window.
 * Serializes costMicrodollars as string for safe JSON storage in DO transactional storage.
 */
export interface QuotaEntry {
  readonly timestamp: number;
  readonly count: number;
  readonly costMicrodollars: string;
  readonly projectId?: string;
}

/**
 * Persisted snapshot of TenantQuotaDO in DO transactional storage.
 */
export interface TenantQuotaData {
  readonly tenantId: string;
  readonly tier: UserTier;
  readonly entries: QuotaEntry[];
  readonly totalCostMicrodollars: string;
  readonly lastUpdated: number;
}

/**
 * Request payload for consuming quota.
 */
export interface ConsumeQuotaRequest {
  readonly tenantId?: string;
  readonly projectId?: string;
  readonly tier?: UserTier;
  readonly projectMaxSubCap?: number | null;
  readonly costMicrodollars?: bigint | number | string;
  readonly count?: number;
  readonly checkOnly?: boolean;
}

/**
 * Structured diagnostic result from a quota consumption evaluation.
 */
export interface ConsumeQuotaResult {
  readonly allowed: boolean;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly tier: UserTier;
  readonly currentRpm: number;
  readonly rpmLimit: number;
  readonly currentRpd: number;
  readonly rpdLimit: number;
  readonly currentProjectRpm?: number;
  readonly projectRpmLimit?: number;
  readonly totalCostMicrodollars: string;
  readonly remainingRpm: number;
  readonly remainingRpd: number;
  readonly retryAfterSeconds?: number;
  readonly retry_after_seconds?: number;
  readonly error?: string;
  readonly errorCode?: string;
  readonly error_code?: string;
}

/**
 * Configuration options for TenantQuotaDO initialization or testing.
 */
export interface TenantQuotaDOOptions {
  /** Explicit tenant ID override */
  readonly tenantId?: string;
  /** Default tier override (defaults to 'builder') */
  readonly initialTier?: UserTier;
  /** Sliding window duration in milliseconds for RPM (defaults to 60,000) */
  readonly rpmWindowMs?: number;
  /** Daily window duration in milliseconds for RPD (defaults to 86,400,000) */
  readonly rpdWindowMs?: number;
  /** Injectable time provider for deterministic testing */
  readonly timeProvider?: () => number;
}

/**
 * Safely converts an unknown cost representation to a bigint in int64 microdollars.
 * Guarantees zero floating-point math.
 */
export function toMicrodollars(cost: unknown): bigint {
  if (typeof cost === "bigint") {
    return cost;
  }
  if (typeof cost === "number") {
    return BigInt(Math.trunc(cost));
  }
  if (typeof cost === "string") {
    const trimmed = cost.trim();
    if (trimmed.length === 0) {
      return 0n;
    }
    try {
      return BigInt(trimmed);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

/**
 * TenantQuotaDO — Per-Tenant Stateful Durable Object.
 * Enforces hierarchical RPM & RPD limits, sub-caps, and cost tracking with DO storage survival.
 */
export class TenantQuotaDO extends DurableObject {
  public tenantId: string;
  private tier: UserTier = "builder";
  private entries: QuotaEntry[] = [];
  private totalCostMicrodollars: bigint = 0n;
  private isLoaded = false;

  private readonly rpmWindowMs: number;
  private readonly rpdWindowMs: number;
  private readonly timeProvider: () => number;
  private readonly storagePrefix = "quota:";

  constructor(
    ctx: DurableObjectState | DurableObjectStateLike,
    env?: unknown,
    options?: TenantQuotaDOOptions
  ) {
    super(ctx, env);
    this.timeProvider = options?.timeProvider ?? (() => Date.now());
    this.rpmWindowMs = options?.rpmWindowMs ?? 60_000;
    this.rpdWindowMs = options?.rpdWindowMs ?? 86_400_000;

    if (options?.initialTier) {
      this.tier = options.initialTier;
    }

    // Strict Tenant ID resolution:
    // 1. Explicit in options
    // 2. From ctx.id.name (Cloudflare idFromName(tenantId))
    // 3. Fallback to ctx.id.toString()
    const resolvedTenant =
      options?.tenantId ??
      this.ctx.id.name ??
      (typeof this.ctx.id.toString === "function" ? this.ctx.id.toString() : "");

    if (!resolvedTenant || resolvedTenant.trim().length === 0) {
      throw new TenantIsolationError("TenantQuotaDO requires a non-empty tenantId");
    }
    this.tenantId = resolvedTenant;
  }

  /**
   * Current timestamp in milliseconds via injectable time provider.
   */
  private now(): number {
    return this.timeProvider();
  }

  // =========================================================================
  // Per-Tenant Compute Isolation Assertion (GEMINI.md Invariant)
  // =========================================================================

  /**
   * Asserts that an incoming target tenant ID strictly matches this DO instance.
   * Throws TenantIsolationError if there is any mismatch.
   */
  public assertTenant(targetTenantId?: string): void {
    if (!targetTenantId) {
      return;
    }
    if (targetTenantId !== this.tenantId) {
      throw new TenantIsolationError(
        "Tenant isolation violation: attempt to access/mutate tenant '" +
          targetTenantId +
          "' in TenantQuotaDO for tenant '" +
          this.tenantId +
          "'",
        {
          tenantId: this.tenantId,
          attemptedTenantId: targetTenantId,
        }
      );
    }
  }

  // =========================================================================
  // DO Transactional Storage Persistence & Eviction Survival
  // =========================================================================

  private getStorageKey(): string {
    return this.storagePrefix + "data";
  }

  /**
   * Prunes entries older than the daily window (24 hours).
   */
  private pruneEntries(now = this.now()): void {
    const cutoff = now - this.rpdWindowMs;
    this.entries = this.entries.filter((e) => e.timestamp > cutoff);
  }

  /**
   * Persists the current hot state to DO transactional storage.
   */
  private async persist(): Promise<void> {
    this.pruneEntries();
    const data: TenantQuotaData = {
      tenantId: this.tenantId,
      tier: this.tier,
      entries: [...this.entries],
      totalCostMicrodollars: this.totalCostMicrodollars.toString(),
      lastUpdated: this.now(),
    };
    await this.ctx.storage.put<TenantQuotaData>(this.getStorageKey(), data);
  }

  /**
   * Loads state from DO transactional storage on initial access.
   */
  public async ensureLoaded(): Promise<void> {
    if (this.isLoaded) {
      return;
    }

    const stored = await this.ctx.storage.get<TenantQuotaData>(this.getStorageKey());
    if (stored && typeof stored === "object") {
      if (stored.tenantId) {
        this.tenantId = stored.tenantId;
      }
      if (stored.tier) {
        this.tier = stored.tier;
      }
      if (Array.isArray(stored.entries)) {
        this.entries = [...stored.entries];
      }
      if (typeof stored.totalCostMicrodollars === "string") {
        this.totalCostMicrodollars = toMicrodollars(stored.totalCostMicrodollars);
      }
    }

    this.pruneEntries();
    this.isLoaded = true;
  }

  /**
   * Clears in-memory cache to simulate DO eviction.
   * State is preserved in DO transactional storage.
   */
  public clearMemoryCache(): void {
    this.entries = [];
    this.totalCostMicrodollars = 0n;
    this.isLoaded = false;
  }

  // =========================================================================
  // In-Memory Quota & Rate Limit Counters
  // =========================================================================

  /**
   * Returns the currently configured UserTier.
   */
  public getTier(): UserTier {
    return this.tier;
  }

  /**
   * Updates the configured UserTier and persists to storage.
   */
  public async setTier(tier: UserTier): Promise<void> {
    await this.ensureLoaded();
    this.tier = tier;
    await this.persist();
  }

  /**
   * Calculates current RPM within the sliding window for root tenant or specific project.
   */
  public getRpm(projectId?: string): number {
    const now = this.now();
    const cutoff = now - this.rpmWindowMs;
    let count = 0;
    for (const e of this.entries) {
      if (e.timestamp > cutoff) {
        if (!projectId || e.projectId === projectId) {
          count += e.count;
        }
      }
    }
    return count;
  }

  /**
   * Calculates current RPD within the sliding 24-hour window for root tenant or specific project.
   */
  public getRpd(projectId?: string): number {
    const now = this.now();
    const cutoff = now - this.rpdWindowMs;
    let count = 0;
    for (const e of this.entries) {
      if (e.timestamp > cutoff) {
        if (!projectId || e.projectId === projectId) {
          count += e.count;
        }
      }
    }
    return count;
  }

  /**
   * Returns total accumulated cost in fixed-point microdollars (int64/bigint).
   */
  public getTotalCostMicrodollars(): bigint {
    return this.totalCostMicrodollars;
  }

  /**
   * Calculates seconds remaining until the current RPM window has capacity.
   */
  private getRpmRetryAfterSeconds(): number {
    const now = this.now();
    const cutoff = now - this.rpmWindowMs;
    for (const e of this.entries) {
      if (e.timestamp > cutoff) {
        const expiresAt = e.timestamp + this.rpmWindowMs;
        const diffMs = expiresAt - now;
        return Math.max(1, Math.ceil(diffMs / 1000));
      }
    }
    return 60;
  }

  // =========================================================================
  // Core Quota Consumption Logic (consumeQuota)
  // =========================================================================

  /**
   * Evaluates quota availability and consumes quota if within configured limits.
   * Responds with HTTP 429 semantics if limits are exceeded.
   *
   * @param request - Quota consumption request parameters.
   * @returns Structured ConsumeQuotaResult with status, limits, and retry metadata.
   */
  public async consumeQuota(
    request: ConsumeQuotaRequest = {}
  ): Promise<ConsumeQuotaResult> {
    this.assertTenant(request.tenantId);
    await this.ensureLoaded();

    const now = this.now();
    this.pruneEntries(now);

    const effectiveTier = request.tier ?? this.tier;
    const requestedCount = request.count !== undefined && request.count > 0 ? request.count : 1;
    const incomingCost = toMicrodollars(request.costMicrodollars);

    const tierLimits = getTierLimits(effectiveTier);
    const rootRpmLimit = tierLimits.rpmLimit;
    const rootRpdLimit = tierLimits.rpdLimit;

    // Calculate current usage
    const currentRootRpm = this.getRpm();
    const currentRootRpd = this.getRpd();

    // Check 1: Root Tenant RPM Limit (e.g. 20 RPM for Builder tier)
    if (rootRpmLimit !== Infinity && currentRootRpm + requestedCount > rootRpmLimit) {
      const retryAfterSeconds = this.getRpmRetryAfterSeconds();
      return {
        allowed: false,
        tenantId: this.tenantId,
        projectId: request.projectId,
        tier: effectiveTier,
        currentRpm: currentRootRpm,
        rpmLimit: rootRpmLimit,
        currentRpd: currentRootRpd,
        rpdLimit: rootRpdLimit,
        totalCostMicrodollars: this.totalCostMicrodollars.toString(),
        remainingRpm: Math.max(0, rootRpmLimit - currentRootRpm),
        remainingRpd: Math.max(0, rootRpdLimit - currentRootRpd),
        retryAfterSeconds,
        retry_after_seconds: retryAfterSeconds,
        error: "User quota ceiling exceeded",
        errorCode: "USER_QUOTA_EXHAUSTED",
        error_code: "USER_QUOTA_EXHAUSTED",
      };
    }

    // Check 2: Root Tenant RPD Limit (e.g. 2,000 RPD for Builder tier)
    if (rootRpdLimit !== Infinity && currentRootRpd + requestedCount > rootRpdLimit) {
      const retryAfterSeconds = 86_400;
      return {
        allowed: false,
        tenantId: this.tenantId,
        projectId: request.projectId,
        tier: effectiveTier,
        currentRpm: currentRootRpm,
        rpmLimit: rootRpmLimit,
        currentRpd: currentRootRpd,
        rpdLimit: rootRpdLimit,
        totalCostMicrodollars: this.totalCostMicrodollars.toString(),
        remainingRpm: Math.max(0, rootRpmLimit - currentRootRpm),
        remainingRpd: Math.max(0, rootRpdLimit - currentRootRpd),
        retryAfterSeconds,
        retry_after_seconds: retryAfterSeconds,
        error: "User daily quota ceiling exceeded",
        errorCode: "USER_DAILY_QUOTA_EXHAUSTED",
        error_code: "USER_DAILY_QUOTA_EXHAUSTED",
      };
    }

    // Check 3: Project-Level Sub-Cap Enforcement (e.g. Project A sub-cap 5 RPM)
    let projectRpmLimit: number | undefined;
    let currentProjectRpm: number | undefined;
    if (request.projectId) {
      projectRpmLimit = calculateProjectQuota(effectiveTier, request.projectMaxSubCap);
      currentProjectRpm = this.getRpm(request.projectId);

      if (projectRpmLimit !== Infinity && currentProjectRpm + requestedCount > projectRpmLimit) {
        const retryAfterSeconds = this.getRpmRetryAfterSeconds();
        return {
          allowed: false,
          tenantId: this.tenantId,
          projectId: request.projectId,
          tier: effectiveTier,
          currentRpm: currentRootRpm,
          rpmLimit: rootRpmLimit,
          currentRpd: currentRootRpd,
          rpdLimit: rootRpdLimit,
          currentProjectRpm,
          projectRpmLimit,
          totalCostMicrodollars: this.totalCostMicrodollars.toString(),
          remainingRpm: Math.max(0, rootRpmLimit - currentRootRpm),
          remainingRpd: Math.max(0, rootRpdLimit - currentRootRpd),
          retryAfterSeconds,
          retry_after_seconds: retryAfterSeconds,
          error: "Project sub-cap exceeded",
          errorCode: "PROJECT_SUB_CAP_EXCEEDED",
          error_code: "PROJECT_SUB_CAP_EXCEEDED",
        };
      }
    }

    // If dry-run / check-only requested, return allowed status without incrementing
    if (request.checkOnly) {
      return {
        allowed: true,
        tenantId: this.tenantId,
        projectId: request.projectId,
        tier: effectiveTier,
        currentRpm: currentRootRpm,
        rpmLimit: rootRpmLimit,
        currentRpd: currentRootRpd,
        rpdLimit: rootRpdLimit,
        currentProjectRpm,
        projectRpmLimit,
        totalCostMicrodollars: this.totalCostMicrodollars.toString(),
        remainingRpm: Math.max(0, rootRpmLimit - currentRootRpm),
        remainingRpd: Math.max(0, rootRpdLimit - currentRootRpd),
      };
    }

    // Commit consumption to in-memory counters
    const newEntry: QuotaEntry = {
      timestamp: now,
      count: requestedCount,
      costMicrodollars: incomingCost.toString(),
      ...(request.projectId ? { projectId: request.projectId } : {}),
    };
    this.entries.push(newEntry);
    this.totalCostMicrodollars += incomingCost;

    // Sync to DO transactional storage (survives eviction)
    await this.persist();

    const updatedRootRpm = currentRootRpm + requestedCount;
    const updatedRootRpd = currentRootRpd + requestedCount;

    return {
      allowed: true,
      tenantId: this.tenantId,
      projectId: request.projectId,
      tier: effectiveTier,
      currentRpm: updatedRootRpm,
      rpmLimit: rootRpmLimit,
      currentRpd: updatedRootRpd,
      rpdLimit: rootRpdLimit,
      currentProjectRpm: currentProjectRpm !== undefined ? currentProjectRpm + requestedCount : undefined,
      projectRpmLimit,
      totalCostMicrodollars: this.totalCostMicrodollars.toString(),
      remainingRpm: rootRpmLimit === Infinity ? Infinity : Math.max(0, rootRpmLimit - updatedRootRpm),
      remainingRpd: rootRpdLimit === Infinity ? Infinity : Math.max(0, rootRpdLimit - updatedRootRpd),
    };
  }

  /**
   * Resets all sliding window counters and cost tracking.
   */
  public async reset(): Promise<void> {
    await this.ensureLoaded();
    this.entries = [];
    this.totalCostMicrodollars = 0n;
    await this.persist();
  }

  // =========================================================================
  // Cloudflare DO Fetch Interface (HTTP RPC)
  // =========================================================================

  /**
   * Handles incoming HTTP requests to TenantQuotaDO.
   * Evaluates consumeQuota requests and responds with HTTP 429 if quota exceeded.
   */
  public async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();

      // Tenant isolation validation via header
      const headerTenant = request.headers.get("x-tenant-id");
      if (headerTenant) {
        this.assertTenant(headerTenant);
      }

      // 1. Health check: GET /health
      if (method === "GET" && url.pathname === "/health") {
        await this.ensureLoaded();
        return Response.json({
          status: "healthy",
          do: true,
          tenantId: this.tenantId,
          tier: this.tier,
          currentRpm: this.getRpm(),
          currentRpd: this.getRpd(),
          timestamp: new Date(this.now()).toISOString(),
        });
      }

      // 2. Consume Quota: POST /consume, POST /consumeQuota, POST /quota/consume, or POST /
      if (
        method === "POST" &&
        (url.pathname === "/consume" ||
          url.pathname === "/consumeQuota" ||
          url.pathname === "/consume-quota" ||
          url.pathname === "/quota/consume" ||
          url.pathname === "/")
      ) {
        const body = (await request.json().catch(() => ({}))) as ConsumeQuotaRequest;
        const result = await this.consumeQuota(body);

        if (!result.allowed) {
          const retryAfter = String(result.retryAfterSeconds ?? 60);
          return Response.json(result, {
            status: 429,
            headers: {
              "Retry-After": retryAfter,
              "Content-Type": "application/json",
            },
          });
        }

        return Response.json(result, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 3. Inspect Quota: GET /quota or GET /status or GET /metrics
      if (
        method === "GET" &&
        (url.pathname === "/quota" ||
          url.pathname === "/status" ||
          url.pathname === "/metrics")
      ) {
        await this.ensureLoaded();
        const projectId = url.searchParams.get("projectId") ?? undefined;
        const tierParam = url.searchParams.get("tier") as UserTier | null;
        const effectiveTier = tierParam ?? this.tier;
        const tierLimits = getTierLimits(effectiveTier);

        const currentRpm = this.getRpm();
        const currentRpd = this.getRpd();
        const currentProjectRpm = projectId ? this.getRpm(projectId) : undefined;

        return Response.json({
          tenantId: this.tenantId,
          tier: effectiveTier,
          currentRpm,
          rpmLimit: tierLimits.rpmLimit,
          currentRpd,
          rpdLimit: tierLimits.rpdLimit,
          currentProjectRpm,
          totalCostMicrodollars: this.totalCostMicrodollars.toString(),
          remainingRpm:
            tierLimits.rpmLimit === Infinity
              ? Infinity
              : Math.max(0, tierLimits.rpmLimit - currentRpm),
          remainingRpd:
            tierLimits.rpdLimit === Infinity
              ? Infinity
              : Math.max(0, tierLimits.rpdLimit - currentRpd),
        });
      }

      // 4. Update Tier: POST /tier or PUT /tier
      if ((method === "POST" || method === "PUT") && url.pathname === "/tier") {
        const body = (await request.json()) as { tier?: UserTier; tenantId?: string };
        if (body.tenantId) {
          this.assertTenant(body.tenantId);
        }
        if (!body.tier || !TIER_LIMITS_MAP[body.tier]) {
          return Response.json(
            { error: "Invalid tier parameter", code: "INVALID_TIER" },
            { status: 400 }
          );
        }
        await this.setTier(body.tier);
        return Response.json({ success: true, tier: this.tier, tenantId: this.tenantId });
      }

      // 5. Reset Counters: POST /reset
      if (method === "POST" && url.pathname === "/reset") {
        await this.reset();
        return Response.json({ success: true, tenantId: this.tenantId });
      }

      return new Response("Not Found", { status: 404 });
    } catch (err: unknown) {
      if (err instanceof TenantIsolationError) {
        return Response.json(
          {
            error: err.message,
            code: "TENANT_ISOLATION_VIOLATION",
            error_code: "TENANT_ISOLATION_VIOLATION",
            details: err.details,
          },
          { status: 403 }
        );
      }
      if (err instanceof RateLimitExceededError || err instanceof QuotaExceededError) {
        return err.toResponse();
      }
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message, code: "INTERNAL_ERROR" }, { status: 500 });
    }
  }
}
