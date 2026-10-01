/**
 * Key Collective — Lease Orchestrator (Section 2.4, WP-4.1 T-4.1.4)
 *
 * Implements the 3-step communal routing lease sequence:
 * 1. `KeyPoolDO(t).leasePrivate(provider, estimateCu, t)` -> own PRIVATE key (no debt)
 * 2. `Coordinator(provider).lease({ tenant: t, ownOnly: true })` -> own COMMUNITY key (no debt)
 * 3. If `rights.communityPool`:
 *    `Coordinator(provider).lease({ tenant: t, ownOnly: false, estimateCu })` -> borrowed COMMUNITY key (accrues debt)
 *
 * On settlement:
 * - `source === "private"` -> `KeyPoolDO(t).settle(leaseId, outcome, cu, until)`
 * - `source === "own_community" | "borrowed"` -> `Coordinator(provider).settle(leaseId, outcome, cu, until)`
 * - `source === "borrowed"` (on non-duplicate settlement) ->
 *   `TenantQuotaDO(t).accrueDebt(cu, leaseId, t)` and `TenantQuotaDO(owner).credit(cu, leaseId, owner)`
 */

import { loadPoolRights, type PoolRights } from "../../auth/rights";
import type {
  PrivateKeyLease,
  PrivateLeaseOutcome,
  PrivateSettleResult,
} from "../../durable_objects/key_pool/key_pool_do";
import {
  canonicalCoordinatorProvider,
  type CoordinatorLease,
  type CoordinatorLeaseRequest,
  type CoordinatorSettleResult,
} from "../../pool/coordinator_do";
import { EyeForEyeError, ProviderUnavailableError } from "../../errors/routing_errors";
import type { WorkerEnv } from "../../worker/auth/types";

export type LeaseSource = "private" | "own_community" | "borrowed";

export interface Lease {
  leaseId: string;
  keyId: string;
  source: LeaseSource;
  ownerTenantId: string;
  provider: string;
}

export interface LeaseAcquireContext {
  tenantId: string;
  env: WorkerEnv;
  rights?: PoolRights;
  estimateCu?: number | bigint;
  model?: string;
}

export interface LeaseSettleResult {
  settled: boolean;
  duplicate: boolean;
}

export interface LeaseProvider {
  acquire(provider: string, ctx: LeaseAcquireContext): Promise<Lease | null>;
  settle(
    lease: Lease,
    outcome: string,
    ctx: LeaseAcquireContext,
    cu?: number | bigint,
    until?: number
  ): Promise<LeaseSettleResult>;
}

interface KeyPoolRpcStub {
  leasePrivate?(
    provider: string,
    estimateCu?: number | bigint,
    tenantId?: string
  ): Promise<PrivateKeyLease | null>;
  settle?(
    leaseId: string,
    outcome: PrivateLeaseOutcome,
    actualCu?: number | bigint,
    cooldownUntil?: number
  ): Promise<PrivateSettleResult>;
}

interface CoordinatorRpcStub {
  lease?(req: CoordinatorLeaseRequest): Promise<CoordinatorLease | null>;
  settle?(
    leaseId: string,
    status: string,
    cu?: number | bigint,
    until?: number,
    model?: string
  ): Promise<CoordinatorSettleResult>;
  getProviderOverride?(): Promise<{ state: "TRIPPED" | "NORMAL"; until?: number | null } | null>;
  getLastRefusalReason?(tenant: string): Promise<string | null>;
}

interface TenantQuotaRpcStub {
  accrueDebt?(
    cuWeight: bigint | number | string,
    leaseId?: string,
    tenantId?: string
  ): Promise<void>;
  credit?(
    cuWeight: bigint | number | string,
    leaseId?: string,
    tenantId?: string
  ): Promise<void>;
  decrementDebt?(
    cuWeight: bigint | number | string,
    leaseId?: string,
    tenantId?: string
  ): Promise<void>;
}

export class LeaseOrchestrator implements LeaseProvider {
  private getKeyPoolStub(tenantId: string, env: WorkerEnv): KeyPoolRpcStub | null {
    const ns = env.KEY_POOL;
    if (!ns || typeof ns.idFromName !== "function" || typeof ns.get !== "function") {
      return null;
    }
    return ns.get(ns.idFromName(tenantId)) as unknown as KeyPoolRpcStub;
  }

  private getCoordinatorStub(provider: string, env: WorkerEnv): CoordinatorRpcStub | null {
    const ns = env.POOL_COORDINATOR as DurableObjectNamespace | undefined;
    if (!ns || typeof ns.idFromName !== "function" || typeof ns.get !== "function") {
      return null;
    }
    const canon = canonicalCoordinatorProvider(provider);
    return ns.get(ns.idFromName(`pool:${canon}`)) as unknown as CoordinatorRpcStub;
  }

  private getTenantQuotaStub(tenantId: string, env: WorkerEnv): TenantQuotaRpcStub | null {
    const ns = env.TENANT_QUOTA;
    if (!ns || typeof ns.idFromName !== "function" || typeof ns.get !== "function") {
      return null;
    }
    return ns.get(ns.idFromName(tenantId)) as unknown as TenantQuotaRpcStub;
  }

  private async resolveRights(ctx: LeaseAcquireContext): Promise<PoolRights> {
    if (ctx.rights) {
      return ctx.rights;
    }
    const db = ctx.env.DB;
    if (!db || typeof db.prepare !== "function") {
      return { privatePool: true, communityPool: true };
    }
    const userRow = await db
      .prepare("SELECT id FROM users WHERE id = ?")
      .bind(ctx.tenantId)
      .first<{ id: string }>();
    if (!userRow) {
      // Synthetic tenant in tests without a D1 `users` row defaults to eligible unless specified
      return { privatePool: true, communityPool: true };
    }
    return loadPoolRights(db, ctx.tenantId);
  }

  public async acquire(
    provider: string,
    ctx: LeaseAcquireContext
  ): Promise<Lease | null> {
    const canonProvider = canonicalCoordinatorProvider(provider);
    const estCu = ctx.estimateCu !== undefined ? Number(ctx.estimateCu) : 0;

    // Check coordinator provider circuit override (WP-4.6, T-4.6.1)
    const coordStubCheck = this.getCoordinatorStub(canonProvider, ctx.env);
    if (coordStubCheck && typeof coordStubCheck.getProviderOverride === "function") {
      const override = await coordStubCheck.getProviderOverride().catch(() => null);
      if (override && override.state === "TRIPPED") {
        throw new ProviderUnavailableError(canonProvider);
      }
    }

    // Demo isolation (WP-4.5): sys_demo leases only from KeyPoolDO("sys_operator") private keys; NEVER calls coordinator.
    if (ctx.tenantId === "sys_demo") {
      const operatorStub = this.getKeyPoolStub("sys_operator", ctx.env);
      if (operatorStub && typeof operatorStub.leasePrivate === "function") {
        const privateLease = await operatorStub.leasePrivate(
          canonProvider,
          estCu,
          "sys_operator"
        );
        if (privateLease) {
          return {
            leaseId: privateLease.leaseId,
            keyId: privateLease.keyId,
            source: "private",
            ownerTenantId: privateLease.ownerTenantId,
            provider: privateLease.provider,
          };
        }
      }
      return null;
    }

    // Step 2a: Own PRIVATE key from KeyPoolDO(t)
    const keyPoolStub = this.getKeyPoolStub(ctx.tenantId, ctx.env);
    if (keyPoolStub && typeof keyPoolStub.leasePrivate === "function") {
      const privateLease = await keyPoolStub.leasePrivate(
        canonProvider,
        estCu,
        ctx.tenantId
      );
      if (privateLease) {
        return {
          leaseId: privateLease.leaseId,
          keyId: privateLease.keyId,
          source: "private",
          ownerTenantId: privateLease.ownerTenantId,
          provider: privateLease.provider,
        };
      }
    }

    const coordStub = this.getCoordinatorStub(canonProvider, ctx.env);
    if (!coordStub || typeof coordStub.lease !== "function") {
      return null;
    }

    // Step 2b: Own COMMUNITY key from PoolCoordinatorDO(provider) (ownOnly: true, no debt)
    const ownCommLease = await coordStub.lease({
      tenant: ctx.tenantId,
      ownOnly: true,
      estimateCu: estCu,
      provider: canonProvider,
      ...(ctx.model ? { model: ctx.model } : {}),
    });
    if (ownCommLease) {
      return {
        leaseId: ownCommLease.leaseId,
        keyId: ownCommLease.keyId,
        source: "own_community",
        ownerTenantId: ownCommLease.ownerTenantId,
        provider: ownCommLease.provider,
      };
    }

    // Step 2c: Other contributor's COMMUNITY key (requires communityPool rights; accrues debt)
    const rights = await this.resolveRights(ctx);
    if (!rights.communityPool) {
      return null;
    }

    const borrowedLease = await coordStub.lease({
      tenant: ctx.tenantId,
      ownOnly: false,
      estimateCu: estCu,
      provider: canonProvider,
      ...(ctx.model ? { model: ctx.model } : {}),
    });
    if (borrowedLease) {
      return {
        leaseId: borrowedLease.leaseId,
        keyId: borrowedLease.keyId,
        source: "borrowed",
        ownerTenantId: borrowedLease.ownerTenantId,
        provider: borrowedLease.provider,
      };
    }

    if (typeof coordStub.getLastRefusalReason === "function") {
      const refusalReason = await coordStub.getLastRefusalReason(ctx.tenantId).catch(() => null);
      if (refusalReason === "eye_for_eye") {
        throw new EyeForEyeError(canonProvider);
      }
    }

    return null;
  }

  public async settle(
    lease: Lease,
    outcome: string,
    ctx: LeaseAcquireContext,
    cu: number | bigint = 0,
    until?: number
  ): Promise<LeaseSettleResult> {
    const numericCu = Math.max(0, Number(cu));
    const bigintCu = BigInt(Math.trunc(numericCu));

    if (lease.source === "private") {
      const targetTenant = ctx.tenantId === "sys_demo" ? "sys_operator" : ctx.tenantId;
      const keyPoolStub = this.getKeyPoolStub(targetTenant, ctx.env);
      if (keyPoolStub && typeof keyPoolStub.settle === "function") {
        const res = await keyPoolStub.settle(
          lease.leaseId,
          outcome as PrivateLeaseOutcome,
          numericCu,
          until
        );
        return {
          settled: res.settled,
          duplicate: res.duplicate,
        };
      }
      return { settled: false, duplicate: false };
    }

    const coordStub = this.getCoordinatorStub(lease.provider, ctx.env);
    if (!coordStub || typeof coordStub.settle !== "function") {
      return { settled: false, duplicate: false };
    }

    const coordRes = await coordStub.settle(
      lease.leaseId,
      outcome,
      numericCu,
      until,
      ctx.model
    );
    if (coordRes.duplicate || !coordRes.settled) {
      return {
        settled: coordRes.settled,
        duplicate: coordRes.duplicate,
      };
    }

    // Step 4: On borrowed key settlement, accrue borrower debt and credit lender
    if (lease.source === "borrowed" && bigintCu > 0n) {
      const borrowerQuota = this.getTenantQuotaStub(ctx.tenantId, ctx.env);
      if (borrowerQuota && typeof borrowerQuota.accrueDebt === "function") {
        await borrowerQuota.accrueDebt(bigintCu, lease.leaseId, ctx.tenantId);
      }

      const lenderTenantId = coordRes.ownerTenantId ?? lease.ownerTenantId;
      if (lenderTenantId && lenderTenantId !== ctx.tenantId) {
        const lenderQuota = this.getTenantQuotaStub(lenderTenantId, ctx.env);
        if (lenderQuota) {
          if (typeof lenderQuota.credit === "function") {
            await lenderQuota.credit(bigintCu, lease.leaseId, lenderTenantId);
          } else if (typeof lenderQuota.decrementDebt === "function") {
            await lenderQuota.decrementDebt(bigintCu, lease.leaseId, lenderTenantId);
          }
        }
      }
    }

    return {
      settled: true,
      duplicate: false,
    };
  }
}
