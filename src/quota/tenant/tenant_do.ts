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
  toMicrodollars,
} from "./types";

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

  private communityDebtMicroCu: bigint = 0n;
  private dailyContributedCu: bigint = 0n;
  private trustedContributor: boolean = false;
  private consecutiveDebtFreeDays: number = 0;
  private multiplierCeiling: number = 150;

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

    const resolvedTenant =
      options?.tenantId ??
      this.ctx.id.name ??
      (typeof this.ctx.id.toString === "function" ? this.ctx.id.toString() : "");

    if (!resolvedTenant || resolvedTenant.trim().length === 0) {
      throw new TenantIsolationError("TenantQuotaDO requires a non-empty tenantId");
    }
    this.tenantId = resolvedTenant;

    if (typeof (this.ctx.storage as any)?.getAlarm === "function") {
      (this.ctx.storage as any).getAlarm().then((alarm: number | null) => {
        if (!alarm && typeof (this.ctx.storage as any)?.setAlarm === "function") {
          const tomorrow = new Date(Date.now());
          tomorrow.setUTCHours(24, 0, 0, 0);
          (this.ctx.storage as any).setAlarm(tomorrow.getTime());
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
  }

  private async persist(): Promise<void> {
    this.pruneEntries();
    const data: TenantQuotaData = {
      tenantId: this.tenantId,
      tier: this.tier,
      entries: [...this.entries],
      totalCostMicrodollars: this.totalCostMicrodollars.toString(),

      communityDebtMicroCu: this.communityDebtMicroCu.toString(),
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
      if (typeof (stored as any).communityDebtMicroCu === "string") {
        this.communityDebtMicroCu = BigInt((stored as any).communityDebtMicroCu);
      }
      if (typeof (stored as any).dailyContributedCu === "string") {
        this.dailyContributedCu = BigInt((stored as any).dailyContributedCu);
      }
      if (typeof (stored as any).trustedContributor === "boolean") {
        this.trustedContributor = (stored as any).trustedContributor;
      }
      if (typeof (stored as any).consecutiveDebtFreeDays === "number") {
        this.consecutiveDebtFreeDays = (stored as any).consecutiveDebtFreeDays;
      }
      if (typeof (stored as any).multiplierCeiling === "number") {
        this.multiplierCeiling = (stored as any).multiplierCeiling;
      }
    }

    this.pruneEntries();
    this.isLoaded = true;
  }

  public clearMemoryCache(): void {
    this.entries = [];
    this.totalCostMicrodollars = 0n;
    this.isLoaded = false;
  }

  public async accrueDebt(cuWeight: bigint): Promise<void> {
    await this.ensureLoaded();
    this.communityDebtMicroCu += cuWeight;
    this.updateMultiplierCeiling();
    await this.syncDebtState();
  }

  public async decrementDebt(cuWeight: bigint): Promise<void> {
    await this.ensureLoaded();
    this.communityDebtMicroCu = this.communityDebtMicroCu > cuWeight ? this.communityDebtMicroCu - cuWeight : 0n;
    this.dailyContributedCu += cuWeight;
    this.updateMultiplierCeiling();
    await this.syncDebtState();
  }

  public getDebtState() {
    return {
      communityDebtMicroCu: this.communityDebtMicroCu.toString(),
      dailyContributedCu: this.dailyContributedCu.toString(),
      multiplierCeiling: this.multiplierCeiling,
      jailStatus: determineJailStatus(this.communityDebtMicroCu, this.multiplierCeiling),
    };
  }

  public updateMultiplierCeiling(): void {
    this.multiplierCeiling = calculateMultiplierCeiling(
      this.communityDebtMicroCu,
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
      communityDebtMicroCu: this.communityDebtMicroCu,
      dailyContributedCu: this.dailyContributedCu,
      trustedContributor: this.trustedContributor,
      consecutiveDebtFreeDays: this.consecutiveDebtFreeDays,
      multiplierCeiling: this.multiplierCeiling,
    });

    this.communityDebtMicroCu = updated.communityDebtMicroCu;
    this.dailyContributedCu = updated.dailyContributedCu;
    this.trustedContributor = updated.trustedContributor;
    this.consecutiveDebtFreeDays = updated.consecutiveDebtFreeDays;
    this.multiplierCeiling = updated.multiplierCeiling;

    await this.syncDebtState();
    
    const tomorrow = new Date(Date.now());
    tomorrow.setUTCHours(24, 0, 0, 0);
    await (this.ctx.storage as any).setAlarm(tomorrow.getTime());
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

  public async consumeQuota(
    request: ConsumeQuotaRequest = {}
  ): Promise<ConsumeQuotaResult> {
    this.assertTenant(request.tenantId);
    await this.ensureLoaded();

    const now = this.now();
    this.pruneEntries(now);

    const { result, newEntry, incomingCost } = evaluateQuota(request, {
      tenantId: this.tenantId,
      tier: this.tier,
      entries: this.entries,
      totalCostMicrodollars: this.totalCostMicrodollars,
      communityDebtMicroCu: this.communityDebtMicroCu,
      dailyContributedCu: this.dailyContributedCu,
      trustedContributor: this.trustedContributor,
      consecutiveDebtFreeDays: this.consecutiveDebtFreeDays,
      multiplierCeiling: this.multiplierCeiling,
      rpmWindowMs: this.rpmWindowMs,
      rpdWindowMs: this.rpdWindowMs,
      now,
    });

    if (newEntry) {
      this.entries.push(newEntry);
      this.totalCostMicrodollars += incomingCost;
      await this.persist();
    }

    return result;
  }

  public async reset(): Promise<void> {
    await this.ensureLoaded();
    this.entries = [];
    this.totalCostMicrodollars = 0n;
    await this.persist();
  }

  public async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();

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

          communityDebtMicroCu: this.communityDebtMicroCu.toString(),
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
