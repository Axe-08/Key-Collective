import { describe, expect, it, beforeEach, vi } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { PoolCoordinatorDO } from "../../../src/pool/coordinator_do";
import { computeOwnerShareCapPct } from "../../../src/constants/commons";
import {
  getWouldDenyStats,
} from "../../../src/pool/enforcement";

async function clearWouldDenyStats(): Promise<void> {
  await env.DB.prepare("DELETE FROM would_deny_hourly").run();
}

function getCoordinatorStub(name: string): DurableObjectStub {
  return env.POOL_COORDINATOR.get(env.POOL_COORDINATOR.idFromName(name));
}

describe("Cold-start share cap (FR-12, WP-5.7 T-5.7.2)", () => {
  beforeEach(async () => {
    await clearWouldDenyStats();
  });

  it("computes cap = 40% for N <= 5 and max(20%, floor(200/N)%) for N > 5", () => {
    expect(computeOwnerShareCapPct(4)).toBe(40);
    expect(computeOwnerShareCapPct(5)).toBe(40);
    expect(computeOwnerShareCapPct(6)).toBe(33);
    expect(computeOwnerShareCapPct(8)).toBe(25);
    expect(computeOwnerShareCapPct(10)).toBe(20);
    expect(computeOwnerShareCapPct(20)).toBe(20);
  });

  it("AC-14: with N = 4 owners and skewed priority, no owner exceeds 40% of served CU over 1,000 simulated leases", async () => {
    const stub = getCoordinatorStub("test-share-cap-n4-1000");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      const t0 = Date.UTC(2030, 5, 1, 12, 0, 0);
      coord.setClockForTest(t0);
      coord.setEnvForTest({
        COMMONS_ENFORCEMENT: "enforce",
        COMMONS_ENFORCE_RULES: "share_cap",
      });

      // Register N = 4 owners with ACTIVE keys; owner_0 has extreme priorityBoost = 5000
      for (let i = 0; i < 4; i++) {
        await coord.upsertKey({
          keyId: `key_owner_${i}`,
          owner: `owner_${i}`,
          provider: "google",
          status: "ACTIVE",
          rpmLimit: 10_000,
          rpdLimit: 10_000,
          priorityBoost: i === 0 ? 5000 : 0,
        });
      }

      const servedByOwner = new Map<string, number>();
      let totalServedCu = 0;

      for (let step = 0; step < 1000; step++) {
        const lease = await coord.lease({
          tenant: "borrower_sim",
          ownOnly: false,
          estimateCu: 10,
        });
        expect(lease).not.toBeNull();
        await coord.settle(lease!.leaseId, "ok", 10);

        servedByOwner.set(
          lease!.ownerTenantId,
          (servedByOwner.get(lease!.ownerTenantId) ?? 0) + 10
        );
        totalServedCu += 10;
      }

      expect(totalServedCu).toBe(10_000);
      for (let i = 0; i < 4; i++) {
        const ownerCu = servedByOwner.get(`owner_${i}`) ?? 0;
        const sharePct = (ownerCu * 100) / totalServedCu;
        expect(sharePct).toBeLessThanOrEqual(40);
      }
      // Skewed priority owner_0 reaches the 40% cap (4,000 CU) but never exceeds it
      expect(servedByOwner.get("owner_0")).toBe(4000);
    });
  });

  it("with N = 10 owners and skewed priority, caps each owner at 20% of served CU; in observe mode records would_deny and keeps candidate", async () => {
    const stub = getCoordinatorStub("test-share-cap-n10");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      const t0 = Date.UTC(2030, 5, 2, 12, 0, 0);
      coord.setClockForTest(t0);
      coord.setEnvForTest({
        COMMONS_ENFORCEMENT: "enforce",
        COMMONS_ENFORCE_RULES: "share_cap",
      });

      for (let i = 0; i < 10; i++) {
        await coord.upsertKey({
          keyId: `key_n10_${i}`,
          owner: `owner_n10_${i}`,
          provider: "google",
          status: "ACTIVE",
          rpmLimit: 10_000,
          rpdLimit: 10_000,
          priorityBoost: i === 0 ? 5000 : 0,
        });
      }

      const servedByOwner = new Map<string, number>();
      let totalServedCu = 0;

      for (let step = 0; step < 200; step++) {
        const lease = await coord.lease({
          tenant: "borrower_n10",
          ownOnly: false,
          estimateCu: 10,
        });
        expect(lease).not.toBeNull();
        await coord.settle(lease!.leaseId, "ok", 10);

        servedByOwner.set(
          lease!.ownerTenantId,
          (servedByOwner.get(lease!.ownerTenantId) ?? 0) + 10
        );
        totalServedCu += 10;
      }

      expect(totalServedCu).toBe(2000);
      for (let i = 0; i < 10; i++) {
        const ownerCu = servedByOwner.get(`owner_n10_${i}`) ?? 0;
        const sharePct = (ownerCu * 100) / totalServedCu;
        expect(sharePct).toBeLessThanOrEqual(20);
      }
      expect(servedByOwner.get("owner_n10_0")).toBe(400);

      // Switch to observe mode: owner_n10_0 is at 20% cap, so next lease selects owner_n10_0 (highest priority) and records would_deny for share_cap
      await clearWouldDenyStats();
      coord.setEnvForTest({
        COMMONS_ENFORCEMENT: "observe",
        COMMONS_ENFORCE_RULES: "",
      });
      const obsLease = await coord.lease({
        tenant: "borrower_n10",
        ownOnly: false,
        estimateCu: 10,
      });
      expect(obsLease).not.toBeNull();
      expect(obsLease?.ownerTenantId).toBe("owner_n10_0");

      await vi.waitFor(async () => {
        const stats = await getWouldDenyStats(env.DB, 24);
        expect(stats.rules.share_cap).toBe(1);
      });
    });
  });
});
