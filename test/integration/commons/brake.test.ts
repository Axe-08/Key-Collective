import { describe, expect, it, beforeEach } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { PoolCoordinatorDO } from "../../../src/pool/coordinator_do";
import {
  clearWouldDenyEventsForTest,
  getWouldDenyStats,
} from "../../../src/pool/enforcement";

function getCoordinatorStub(name: string): DurableObjectStub {
  return env.POOL_COORDINATOR.get(env.POOL_COORDINATOR.idFromName(name));
}

describe("Surge brake in PoolCoordinatorDO (WP-5.6 T-5.6.2)", () => {
  beforeEach(() => {
    clearWouldDenyEventsForTest();
  });

  it("never brakes a single borrower sending 1,000 CU in 5 minutes", async () => {
    const stub = getCoordinatorStub("test-brake-single-borrower");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      const t0 = Date.UTC(2030, 4, 1, 12, 0, 0);
      coord.setClockForTest(t0);
      coord.setEnvForTest({ COMMONS_ENFORCEMENT: "enforce" });

      await coord.upsertKey({
        keyId: "key_lender_1",
        owner: "lender_1",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 5000,
      });

      const l1 = await coord.lease({
        tenant: "solo_borrower",
        ownOnly: false,
        estimateCu: 1000,
      });
      expect(l1).not.toBeNull();
      await coord.settle(l1!.leaseId, "ok", 1000);

      // Next borrowed lease is still granted (pool_cu < 2000 and active_borrowers < 3)
      const l2 = await coord.lease({
        tenant: "solo_borrower",
        ownOnly: false,
        estimateCu: 100,
      });
      expect(l2).not.toBeNull();
    });
  });

  it("brakes the 60% borrower for 60s when 3 borrowers have 60/20/20 shares over minimum, still serves own keys, and unbrakes at +61s; survives eviction", async () => {
    const stub = getCoordinatorStub("test-brake-60-20-20-enforce");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      const t0 = Date.UTC(2030, 4, 1, 12, 0, 0);
      coord.setClockForTest(t0);
      coord.setEnvForTest({ COMMONS_ENFORCEMENT: "enforce" });

      // Pool lender key + borrower_heavy's own key
      await coord.upsertKey({
        keyId: "key_pool_lender",
        owner: "lender_main",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 5000,
      });
      await coord.upsertKey({
        keyId: "key_heavy_own",
        owner: "borrower_heavy",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 5000,
      });

      // Total pool CU in 5m = 3000 (>= 2000), 3 active borrowers:
      // borrower_heavy: 1800 CU (60%)
      // borrower_b: 600 CU (20%)
      // borrower_c: 600 CU (20%)
      const lHeavy = await coord.lease({ tenant: "borrower_heavy", ownOnly: false });
      await coord.settle(lHeavy!.leaseId, "ok", 1800);

      const lB = await coord.lease({ tenant: "borrower_b", ownOnly: false });
      await coord.settle(lB!.leaseId, "ok", 600);

      const lC = await coord.lease({ tenant: "borrower_c", ownOnly: false });
      await coord.settle(lC!.leaseId, "ok", 600);

      // Next borrowed lease for borrower_heavy triggers brake (60% > 35%) and returns null
      const blocked = await coord.lease({ tenant: "borrower_heavy", ownOnly: false });
      expect(blocked).toBeNull();

      // Simulate coordinator eviction -> brake state in SQLite survives
      coord.clearMemoryCache();

      // At +30s, borrower_heavy is still braked on borrowed keys
      coord.setClockForTest(t0 + 30_000);
      const stillBlocked = await coord.lease({ tenant: "borrower_heavy", ownOnly: false });
      expect(stillBlocked).toBeNull();

      // Own keys (ownOnly=true) are NEVER braked
      const ownLease = await coord.lease({ tenant: "borrower_heavy", ownOnly: true });
      expect(ownLease).not.toBeNull();
      expect(ownLease?.keyId).toBe("key_heavy_own");

      // Other borrowers (20% share <= 35%) are not braked
      const bLease = await coord.lease({ tenant: "borrower_b", ownOnly: false });
      expect(bLease).not.toBeNull();

      // At +61s after the 5-minute window rolls past the initial spike (or after brake expires when share drops),
      // verify that at +61s the 60s brake entry has expired; if 5-minute window is cleared or share is below 35%, unbraked:
      // Let's also add borrower_b volume at +61s so heavy is no longer >35%, or advance past the 60s brake:
      const lB2 = await coord.lease({ tenant: "borrower_b", ownOnly: false });
      await coord.settle(lB2!.leaseId, "ok", 2000);
      const lC2 = await coord.lease({ tenant: "borrower_c", ownOnly: false });
      await coord.settle(lC2!.leaseId, "ok", 2000);

      // At +59s, still braked because the 60s brake lock in `brakes` table hasn't expired yet!
      coord.setClockForTest(t0 + 59_000);
      const lockedAt59s = await coord.lease({ tenant: "borrower_heavy", ownOnly: false });
      expect(lockedAt59s).toBeNull();

      // At +61s, the 60s brake lock has expired and borrower_heavy is unbraked!
      coord.setClockForTest(t0 + 61_000);
      const unbrakedAt61s = await coord.lease({ tenant: "borrower_heavy", ownOnly: false });
      expect(unbrakedAt61s).not.toBeNull();
    });
  });

  it("in observe mode serves the 60% tenant from borrowed keys and records exactly one would_deny event for brake", async () => {
    const stub = getCoordinatorStub("test-brake-60-20-20-observe");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      clearWouldDenyEventsForTest();
      const t0 = Date.UTC(2030, 4, 2, 12, 0, 0);
      coord.setClockForTest(t0);
      coord.setEnvForTest({ COMMONS_ENFORCEMENT: "observe" });

      await coord.upsertKey({
        keyId: "key_pool_lender_obs",
        owner: "lender_obs",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 5000,
      });

      const lHeavy = await coord.lease({ tenant: "borrower_heavy_obs", ownOnly: false });
      await coord.settle(lHeavy!.leaseId, "ok", 1800);

      const lB = await coord.lease({ tenant: "borrower_b_obs", ownOnly: false });
      await coord.settle(lB!.leaseId, "ok", 600);

      const lC = await coord.lease({ tenant: "borrower_c_obs", ownOnly: false });
      await coord.settle(lC!.leaseId, "ok", 600);

      // In observe mode, the 60% tenant is still granted a borrowed lease
      const observedLease = await coord.lease({ tenant: "borrower_heavy_obs", ownOnly: false });
      expect(observedLease).not.toBeNull();
      expect(observedLease?.source).toBe("borrowed");

      const stats = getWouldDenyStats(24);
      expect(stats.rules.brake).toBe(1);
      expect(stats.total).toBe(1);
    });
  });
});
