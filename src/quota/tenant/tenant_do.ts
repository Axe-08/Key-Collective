/**
 * Key Collective v3 — Multi-Project, Anti-Sybil & Tiered Developer Platform
 * TenantQuotaDO — Per-Tenant Stateful Durable Object for Quota Enforcement
 */

import {
  TIER_LIMITS_MAP,
  UserTier,
} from "../../contracts/v3_types";
import { TenantIsolationError } from "../../errors/auth_errors";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "../../errors/key_errors";
import { getTierLimits } from "../limits";
import { Clock, systemClock } from "../../utils/clock";
import {
  calculateMultiplierCeiling,
  determineJailStatus,
  processDailyDebtReset,
} from "./debt";
import {
  calculateUsage,
  evaluateQuota,
} from "./evaluator";
import {
  ConsumeQuotaRequest,
  ConsumeQuotaResult,
  DurableObject,
  DurableObjectStateLike,
  QuotaEntry,
  TenantQuotaData,
  TenantQuotaDOOptions,
  toCu,
  toMicrodollars,
} from "./types";

declare module "./types" {
  interface TenantQuotaDOOptions {
    /** Injectable Clock for deterministic testing */
    clock?: Clock;
  }
}

interface StorageWithAlarm {
  setAlarm?(time: number): Promise<void>;
  getAlarm?(): Promise<number | null>;
}

/**
 * TenantQuotaDO — Per-Tenant Stateful Durable Object.
 * Enforces hierarchical RPM & RPD limits, sub-caps, and cost tracking with DO storage survival.
 */
export class TenantQuotaDO extends DurableObject<unknown> {
  public tenantId: string;
  /**
   * False when the tenant id is only the DO's hex id. In the Workers runtime `ctx.id.name` is not
   * available inside the object, so the DO binds to the tenant named by its first caller (the
   * worker always addresses it with idFromName(tenantId)) and persists that binding.
   */
  private tenantBound = false;
  private tier: UserTier = "builder";
  private entries: QuotaEntry[] = [];
  private totalCostMicrodollars: bigint = 0n;
  private cuUsed24h: bigint = 0n;
  private isLoaded = false;

  private communityDebtCu: bigint = 0n;
  private dailyContributedCu: bigint = 0n;
  private trustedContributor: boolean = false;
  private consecutiveDebtFreeDays: number = 0;
  private multiplierCeiling: number = 150;

  private readonly rpmWindowMs: number;
  private readonly rpdWindowMs: number;
  private clock: Clock;
  private readonly timeProvider: () => number;
  private readonly storagePrefix = "quota:";

  constructor(
    ctx: DurableObjectState | DurableObjectStateLike,
    env?: unknown,
    options?: TenantQuotaDOOptions
  ) {
    super(ctx as DurableObjectState, env);
    this.clock = options?.clock ?? systemClock;
    this.timeProvider = options?.timeProvider ?? (() => this.clock.now());
    this.rpmWindowMs = options?.rpmWindowMs ?? 60_000;
    this.rpdWindowMs = options?.rpdWindowMs ?? 86_400_000;

    if (options?.initialTier) {
      this.tier = options.initialTier;
    }

    const namedTenant = options?.tenantId ?? this.ctx.id.name;
    this.tenantBound = typeof namedTenant === "string" && namedTenant.trim().length > 0;
    const resolvedTenant =
      namedTenant ??
      (typeof this.ctx.id.toString === "function" ? this.ctx.id.toString() : "");

    if (!resolvedTenant || resolvedTenant.trim().length === 0) {
      throw new TenantIsolationError("TenantQuotaDO requires a non-empty tenantId");
    }
    this.tenantId = resolvedTenant;

    const storage = this.ctx.storage as unknown as StorageWithAlarm;
    if (typeof storage?.getAlarm === "function") {
      storage.getAlarm().then((alarm: number | null) => {
        if (!alarm && typeof storage?.setAlarm === "function") {
          const tomorrow = new Date(this.clock.now());
          tomorrow.setUTCHours(24, 0, 0, 0);
          storage.setAlarm(tomorrow.getTime());
        }
      }).catch(() => {});
    }
  }

  private now(): number {
    return this.timeProvider();
  }

  public assertTenant(targetTenantId?: string): void {
    if (!targetTenantId) {
      return;
    }
    if (!this.tenantBound) {
      this.tenantId = targetTenantId;
      this.tenantBound = true;
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

  private getStorageKey(): string {
    return this.storagePrefix + "data";
  }

  private pruneEntries(now = this.now()): void {
    const cutoff = now - this.rpdWindowMs;
    this.entries = this.entries.filter((e) => e.timestamp > cutoff);
    let cuTotal = 0n;
    for (const e of this.entries) {
      if (e.cu !== undefined) {
        cuTotal += BigInt(e.cu);
      } else if (e.costMicrodollars !== undefined) {
        cuTotal += BigInt(e.costMicrodollars);
      }
    }
    this.cuUsed24h = cuTotal;
  }

  private async persist(): Promise<void> {
    this.pruneEntries();
    const data: TenantQuotaData = {
      tenantId: this.tenantId,
      tier: this.tier,
      entries: [...this.entries],
      totalCostMicrodollars: this.totalCostMicrodollars.toString(),

      cuUsed24h: this.cuUsed24h.toString(),
      communityDebtCu: this.communityDebtCu.toString(),
      communityDebtMicroCu: this.communityDebtCu.toString(),
      dailyContributedCu: this.dailyContributedCu.toString(),
      trustedContributor: this.trustedContributor,
      consecutiveDebtFreeDays: this.consecutiveDebtFreeDays,
      multiplierCeiling: this.multiplierCeiling,
      lastUpdated: this.now(),
    };
    await this.ctx.storage.put<TenantQuotaData>(this.getStorageKey(), data);
  }

  public async ensureLoaded(): Promise<void> {
    if (this.isLoaded) {
      return;
    }

    const stored = await this.ctx.storage.get<TenantQuotaData>(this.getStorageKey());
    if (stored && typeof stored === "object") {
      if (stored.tenantId) {
        this.tenantId = stored.tenantId;
        this.tenantBound = true;
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
      if (typeof stored.cuUsed24h === "string") {
        this.cuUsed24h = BigInt(stored.cuUsed24h);
      }
      if (typeof stored.communityDebtCu === "string") {
        this.communityDebtCu = BigInt(stored.communityDebtCu);
      } else if (typeof stored.communityDebtMicroCu === "string") {
        this.communityDebtCu = BigInt(stored.communityDebtMicroCu);
      }
      if (typeof stored.dailyContributedCu === "string") {
        this.dailyContributedCu = BigInt(stored.dailyContributedCu);
      }
      if (typeof stored.trustedContributor === "boolean") {
        this.trustedContributor = stored.trustedContributor;
      }
      if (typeof stored.consecutiveDebtFreeDays === "number") {
        this.consecutiveDebtFreeDays = stored.consecutiveDebtFreeDays;
      }
      if (typeof stored.multiplierCeiling === "number") {
        this.multiplierCeiling = stored.multiplierCeiling;
      }
    }

    this.pruneEntries();
    this.isLoaded = true;
  }

  public clearMemoryCache(): void {
    this.entries = [];
    this.totalCostMicrodollars = 0n;
    this.cuUsed24h = 0n;
    this.isLoaded = false;
  }

  public async accrueDebt(cuWeight: bigint): Promise<void> {
    await this.ensureLoaded();
    this.communityDebtCu += cuWeight;
    this.updateMultiplierCeiling();
    await this.syncDebtState();
  }

  public async decrementDebt(cuWeight: bigint): Promise<void> {
    await this.ensureLoaded();
    this.communityDebtCu = this.communityDebtCu > cuWeight ? this.communityDebtCu - cuWeight : 0n;
    this.dailyContributedCu += cuWeight;
    this.updateMultiplierCeiling();
    await this.syncDebtState();
  }

  public getDebtState() {
    return {
      communityDebtCu: this.communityDebtCu.toString(),
      communityDebtMicroCu: this.communityDebtCu.toString(),
      dailyContributedCu: this.dailyContributedCu.toString(),
      multiplierCeiling: this.multiplierCeiling,
      jailStatus: determineJailStatus(this.communityDebtCu, this.multiplierCeiling),
    };
  }

  public updateMultiplierCeiling(): void {
    this.multiplierCeiling = calculateMultiplierCeiling(
      this.communityDebtCu,
      this.dailyContributedCu,
      this.trustedContributor
    );
  }

  public async syncDebtState(): Promise<void> {
    await this.persist();
  }

  public async alarm(): Promise<void> {
    await this.ensureLoaded();
    const updated = processDailyDebtReset({
      communityDebtCu: this.communityDebtCu,
      dailyContributedCu: this.dailyContributedCu,
      trustedContributor: this.trustedContributor,
      consecutiveDebtFreeDays: this.consecutiveDebtFreeDays,
      multiplierCeiling: this.multiplierCeiling,
    });

    this.communityDebtCu = updated.communityDebtCu;
    this.dailyContributedCu = updated.dailyContributedCu;
    this.trustedContributor = updated.trustedContributor;
    this.consecutiveDebtFreeDays = updated.consecutiveDebtFreeDays;
    this.multiplierCeiling = updated.multiplierCeiling;

    await this.syncDebtState();

    const tomorrow = new Date(this.clock.now());
    tomorrow.setUTCHours(24, 0, 0, 0);
    const storage = this.ctx.storage as unknown as StorageWithAlarm;
    if (typeof storage?.setAlarm === "function") {
      await storage.setAlarm(tomorrow.getTime());
    }
  }

  /**
   * Public RPC accessor for the DO's current clock timestamp.
   */
  public getNow(): number {
    return this.now();
  }

  /**
   * Test-only RPC: switches this DO to a fixed clock. Throws outside the
   * test environment (env.KC_ENV !== "test").
   */
  public setClockForTest(ms: number): void {
    const envRecord = this.env as { KC_ENV?: string } | undefined;
    if (envRecord?.KC_ENV !== "test") {
      throw new Error("setClockForTest is only available when KC_ENV=test");
    }
    this.clock = { now: () => ms };
  }

  public getTier(): UserTier {
    return this.tier;
  }

  public async setTier(tier: UserTier): Promise<void> {
    await this.ensureLoaded();
    this.tier = tier;
    await this.persist();
  }

  public getRpm(projectId?: string): number {
    return calculateUsage(this.entries, this.rpmWindowMs, this.now(), projectId);
  }

  public getRpd(projectId?: string): number {
    return calculateUsage(this.entries, this.rpdWindowMs, this.now(), projectId);
  }

  public getTotalCostMicrodollars(): bigint {
    return this.totalCostMicrodollars;
  }

  public getCuUsed24h(): bigint {
    return this.cuUsed24h;
  }

  public getCommunityDebtCu(): bigint {
    return this.communityDebtCu;
  }

  public async consumeQuota(
    request: ConsumeQuotaRequest = {}
  ): Promise<ConsumeQuotaResult> {
    await this.ensureLoaded();
    this.assertTenant(request.tenantId);

    const now = this.now();
    this.pruneEntries(now);

    const { result, newEntry, incomingCost } = evaluateQuota(request, {
      tenantId: this.tenantId,
      tier: this.tier,
      entries: this.entries,
      totalCostMicrodollars: this.totalCostMicrodollars,
      communityDebtMicroCu: this.communityDebtCu,
      dailyContributedCu: this.dailyContributedCu,
      trustedContributor: this.trustedContributor,
      consecutiveDebtFreeDays: this.consecutiveDebtFreeDays,
      multiplierCeiling: this.multiplierCeiling,
      rpmWindowMs: this.rpmWindowMs,
      rpdWindowMs: this.rpdWindowMs,
      now,
    });

    if (newEntry) {
      const incomingCu = request.cu !== undefined ? toCu(request.cu) : incomingCost;
      const entryWithCu: QuotaEntry = {
        ...newEntry,
        cu: incomingCu.toString(),
      };
      this.entries.push(entryWithCu);
      this.totalCostMicrodollars += incomingCost;
      this.cuUsed24h += incomingCu;
      await this.persist();
    }

    return {
      ...result,
      cuUsed24h: this.cuUsed24h.toString(),
      communityDebtCu: this.communityDebtCu.toString(),
      communityDebtMicroCu: this.communityDebtCu.toString(),
    };
  }

  public async reset(): Promise<void> {
    await this.ensureLoaded();
    this.entries = [];
    this.totalCostMicrodollars = 0n;
    this.cuUsed24h = 0n;
    await this.persist();
  }

  public async fetch(request: Request): Promise<Response> {
    try {
      await this.ensureLoaded();
      const url = new URL(request.url);
      const method = request.method.toUpperCase();

      if (url.pathname === "/__test__/clock") {
        if (method === "POST") {
          const body = (await request.json().catch(() => ({}))) as { ms?: number };
          this.setClockForTest(Number(body.ms));
          return Response.json({ now: this.now() });
        }
        return Response.json({ now: this.now() });
      }

      const headerTenant = request.headers.get("x-tenant-id");
      if (headerTenant) {
        this.assertTenant(headerTenant);
      }

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
          cuUsed24h: this.cuUsed24h.toString(),
          communityDebtCu: this.communityDebtCu.toString(),
          communityDebtMicroCu: this.communityDebtCu.toString(),
          dailyContributedCu: this.dailyContributedCu.toString(),
          trustedContributor: this.trustedContributor,
          consecutiveDebtFreeDays: this.consecutiveDebtFreeDays,
          multiplierCeiling: this.multiplierCeiling,
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
