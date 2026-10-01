import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { LeaseOrchestrator } from "../../src/router/leases/orchestrator";
import { addProviderKey, createUser } from "../helpers/world";

function setClock(
  stub: unknown,
  ms: number
): Promise<void> {
  const s = stub as { setClockForTest(ms: number): Promise<void> };
  return s.setClockForTest(ms);
}

describe("LeaseOrchestrator (WP-4.1 T-4.1.4)", () => {
  const t0 = Date.UTC(2030, 1, 10, 12, 0, 0);

  it("acquires keys in order: own PRIVATE -> own COMMUNITY (no debt) -> other COMMUNITY (borrowed with debt)", async () => {
    const tenantT = await createUser({ github: true, eligible: true });
    const tenantU = await createUser({ github: true, eligible: true });
    const provider = "groq";

    const privKeyT = await addProviderKey(tenantT, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_orch_t_private_key_01",
      rpmLimit: 1,
      rpdLimit: 100,
    });
    const commKeyT = await addProviderKey(tenantT, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_orch_t_comm_key_02",
      rpmLimit: 1,
      rpdLimit: 100,
    });
    const commKeyU = await addProviderKey(tenantU, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_orch_u_comm_key_03",
      rpmLimit: 2,
      rpdLimit: 100,
    });

    const poolStubT = env.KEY_POOL.get(env.KEY_POOL.idFromName(tenantT.id)) as unknown as {
      reconcile(tenantId: string): Promise<{ loaded: number; removed: number }>;
    };
    await setClock(poolStubT, t0);
    await poolStubT.reconcile(tenantT.id);

    const coordStub = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:groq")
    ) as unknown as {
      upsertKey(input: {
        keyId: string;
        owner: string;
        provider: string;
        status: "ACTIVE";
        rpmLimit: number;
        rpdLimit: number;
      }): Promise<{ registered: boolean }>;
      removeKey(keyId: string): Promise<boolean>;
    };
    await setClock(coordStub, t0);

    await coordStub.upsertKey({
      keyId: commKeyT.id,
      owner: tenantT.id,
      provider,
      status: "ACTIVE",
      rpmLimit: 1,
      rpdLimit: 100,
    });
    await coordStub.upsertKey({
      keyId: commKeyU.id,
      owner: tenantU.id,
      provider,
      status: "ACTIVE",
      rpmLimit: 2,
      rpdLimit: 100,
    });

    const orchestrator = new LeaseOrchestrator();
    const ctx = {
      tenantId: tenantT.id,
      env: env as unknown as Record<string, unknown>,
      estimateCu: 25,
    };

    // 1st lease -> own PRIVATE key
    const lease1 = await orchestrator.acquire(provider, ctx);
    expect(lease1).not.toBeNull();
    expect(lease1!.source).toBe("private");
    expect(lease1!.keyId).toBe(privKeyT.id);
    expect(lease1!.ownerTenantId).toBe(tenantT.id);
    await orchestrator.settle(lease1!, "ok", ctx, 25n);

    // 2nd lease (PRIVATE hit RPM=1) -> own COMMUNITY key (no debt)
    const lease2 = await orchestrator.acquire(provider, ctx);
    expect(lease2).not.toBeNull();
    expect(lease2!.source).toBe("own_community");
    expect(lease2!.keyId).toBe(commKeyT.id);
    expect(lease2!.ownerTenantId).toBe(tenantT.id);
    await orchestrator.settle(lease2!, "ok", ctx, 30n);

    const quotaT = env.TENANT_QUOTA.get(env.TENANT_QUOTA.idFromName(tenantT.id)) as unknown as {
      getDebtState(): Promise<{ communityDebtCu: string; dailyContributedCu: string }>;
    };
    await setClock(quotaT, t0);
    const debtAfterOwn = await quotaT.getDebtState();
    expect(debtAfterOwn.communityDebtCu).toBe("0");

    // 3rd lease (own COMMUNITY hit RPM=1) -> U's COMMUNITY key (borrowed, accrues debt & credits U)
    const lease3 = await orchestrator.acquire(provider, ctx);
    expect(lease3).not.toBeNull();
    expect(lease3!.source).toBe("borrowed");
    expect(lease3!.keyId).toBe(commKeyU.id);
    expect(lease3!.ownerTenantId).toBe(tenantU.id);

    const settleRes1 = await orchestrator.settle(lease3!, "ok", ctx, 40n);
    expect(settleRes1.settled).toBe(true);
    expect(settleRes1.duplicate).toBe(false);

    // Calling settle a second time with the same leaseId is idempotent (does not double-charge debt)
    const settleRes2 = await orchestrator.settle(lease3!, "ok", ctx, 40n);
    expect(settleRes2.duplicate).toBe(true);

    const debtAfterBorrowed = await quotaT.getDebtState();
    expect(debtAfterBorrowed.communityDebtCu).toBe("40");

    const quotaU = env.TENANT_QUOTA.get(env.TENANT_QUOTA.idFromName(tenantU.id)) as unknown as {
      getDebtState(): Promise<{ communityDebtCu: string; dailyContributedCu: string }>;
    };
    await setClock(quotaU, t0);
    const uState = await quotaU.getDebtState();
    expect(uState.dailyContributedCu).toBe("40");

    await coordStub.removeKey(commKeyT.id);
    await coordStub.removeKey(commKeyU.id);
  });

  it("refuses step 3 (borrowed keys) when caller lacks communityPool rights", async () => {
    const googleOnlyCaller = await createUser({ github: false, eligible: false });
    const lender = await createUser({ github: true, eligible: true });
    const provider = "google-orch-rights";

    const coordStub = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName(`pool:${provider}`)
    ) as unknown as {
      upsertKey(input: {
        keyId: string;
        owner: string;
        provider: string;
        status: "ACTIVE";
        rpmLimit: number;
        rpdLimit: number;
      }): Promise<{ registered: boolean }>;
    };
    await setClock(coordStub, t0);
    await coordStub.upsertKey({
      keyId: "key_orch_lender_comm",
      owner: lender.id,
      provider,
      status: "ACTIVE",
      rpmLimit: 10,
      rpdLimit: 100,
    });

    const orchestrator = new LeaseOrchestrator();
    const lease = await orchestrator.acquire(provider, {
      tenantId: googleOnlyCaller.id,
      env: env as unknown as Record<string, unknown>,
      estimateCu: 10,
    });
    expect(lease).toBeNull();
  });

  it("prioritizes debtor's COMMUNITY key at lease time when TenantQuotaDO pushes owner debt", async () => {
    const borrower = await createUser({ github: true, eligible: true });
    const lenderClean = await createUser({ github: true, eligible: true });
    const lenderDebtor = await createUser({ github: true, eligible: true });
    const provider = "google";

    const coordStub = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:google")
    ) as unknown as {
      upsertKey(input: {
        keyId: string;
        owner: string;
        provider: string;
        status: "ACTIVE";
        rpmLimit: number;
        rpdLimit: number;
      }): Promise<{ registered: boolean }>;
      removeKey(keyId: string): Promise<boolean>;
    };
    await setClock(coordStub, t0);

    await coordStub.upsertKey({
      keyId: "key_debt_a_clean",
      owner: lenderClean.id,
      provider: "google",
      status: "ACTIVE",
      rpmLimit: 10,
      rpdLimit: 1000,
    });
    await coordStub.upsertKey({
      keyId: "key_debt_b_debtor",
      owner: lenderDebtor.id,
      provider: "google",
      status: "ACTIVE",
      rpmLimit: 10,
      rpdLimit: 1000,
    });

    // Accrue 500 CU of debt on lenderDebtor's TenantQuotaDO -> pushes owner debt to coordinator
    const debtorQuota = env.TENANT_QUOTA.get(
      env.TENANT_QUOTA.idFromName(lenderDebtor.id)
    ) as unknown as {
      accrueDebt(cu: bigint, leaseId?: string, tenantId?: string): Promise<void>;
    };
    await setClock(debtorQuota, t0);
    await debtorQuota.accrueDebt(500n, "seed_debt_lease", lenderDebtor.id);

    const orchestrator = new LeaseOrchestrator();
    const lease = await orchestrator.acquire("google", {
      tenantId: borrower.id,
      env: env as unknown as Record<string, unknown>,
      estimateCu: 10,
    });
    expect(lease).not.toBeNull();
    expect(lease!.keyId).toBe("key_debt_b_debtor");

    // Clean up shared pool:google keys so other tests aren't affected
    await coordStub.removeKey("key_debt_a_clean");
    await coordStub.removeKey("key_debt_b_debtor");
  });
});
