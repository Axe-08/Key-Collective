import { describe, expect, it } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { PoolCoordinatorDO } from "../../../src/pool/coordinator_do";
import { TenantQuotaDO, type DurableObjectStateLike } from "../../../src/quota/tenant";
import type { DurableObjectStorageLike } from "../../../src/durable_objects/circuit_breaker";
import { addProviderKey, createUser } from "../../helpers/world";

class InMemoryStorage implements DurableObjectStorageLike {
  private readonly map = new Map<string, unknown>();
  public async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  public async put<T = unknown>(key: string, value: T): Promise<void> {
    this.map.set(key, JSON.parse(JSON.stringify(value)));
  }
  public async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  public async deleteAll(): Promise<void> {
    this.map.clear();
  }
  public async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const prefix = options?.prefix ?? "";
    for (const [k, v] of this.map.entries()) {
      if (k.startsWith(prefix)) {
        out.set(k, JSON.parse(JSON.stringify(v)) as T);
      }
    }
    return out;
  }
}

function getCoordinatorStub(name: string): DurableObjectStub {
  return env.POOL_COORDINATOR.get(env.POOL_COORDINATOR.idFromName(name));
}

describe("Hero/parasite and drain classification (D-16, WP-5.5 T-5.5.3)", () => {
  it("AC-10: 85% communal with kc_seen_pct >= 50 on RPD exhaustion classifies HERO; owner credit and multiplier unchanged", async () => {
    const owner = await createUser({ github: true, eligible: true });
    const keyRow = await addProviderKey(owner, {
      provider: "google",
      pool: "COMMUNITY",
      plaintext: "AIzaSyHeroClassificationTestKey0000001",
      rpmLimit: 500,
      rpdLimit: 100,
    });

    const storage = new InMemoryStorage();
    const state: DurableObjectStateLike = {
      id: { toString: () => owner.id, name: owner.id },
      storage,
      waitUntil: () => {},
    };
    const quotaDo = new TenantQuotaDO(state, { DB: env.DB }, { tenantId: owner.id });
    await quotaDo.credit(500n, "lease_init_credit", owner.id);
    const beforeStanding = await quotaDo.standing(owner.id);

    const stub = getCoordinatorStub("test-coord-hero-ac10");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      const t0 = Date.UTC(2030, 1, 1, 12, 0, 0);
      coord.setClockForTest(t0);

      await coord.upsertKey({
        keyId: keyRow.id,
        owner: owner.id,
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 100,
      });

      // 60 dispatches on gemini-3.5-flash out of rpdLimit=100 -> kc_seen_pct = 60 >= 50
      // 51 communal, 9 own -> communal_pct = 51 * 100 / 60 = 85% >= 80%
      for (let i = 0; i < 9; i++) {
        const l = await coord.lease({
          tenant: owner.id,
          ownOnly: true,
          model: "gemini-3.5-flash",
          estimateCu: 10,
        });
        await coord.settle(l!.leaseId, "ok", 10, undefined, "gemini-3.5-flash");
      }

      for (let i = 0; i < 50; i++) {
        const l = await coord.lease({
          tenant: `borrower_${i}`,
          ownOnly: false,
          model: "gemini-3.5-flash",
          estimateCu: 10,
        });
        await coord.settle(l!.leaseId, "ok", 10, undefined, "gemini-3.5-flash");
      }

      // 51st communal request hits RPD exhaustion (total 60 dispatches, 51 communal = 85%)
      const lastLease = await coord.lease({
        tenant: "borrower_last",
        ownOnly: false,
        model: "gemini-3.5-flash",
        estimateCu: 10,
      });
      const settleRes = await coord.settle(
        lastLease!.leaseId,
        "rpd_exhausted",
        0,
        t0 + 3600_000,
        "gemini-3.5-flash"
      );

      expect(settleRes.classification).toBeDefined();
      expect(settleRes.classification?.kcSeenPct).toBe(60);
      expect(settleRes.classification?.communalPct).toBe(85);
      expect(settleRes.classification?.result).toBe("HERO");
      expect(settleRes.classification?.drainState).toBe("OK");

      const keyState = await coord.getKeyState(keyRow.id, "gemini-3.5-flash");
      expect(keyState?.classification).toBe("HERO");
      expect(keyState?.drainState).toBe("OK");
    });

    // Owner credit and multiplier are unchanged by HERO classification
    const afterStanding = await quotaDo.standing(owner.id);
    expect(afterStanding.contributedCu24h).toBe(beforeStanding.contributedCu24h);
    expect(afterStanding.multiplierCeiling).toBe(beforeStanding.multiplierCeiling);
  });

  it("records a drained day when kc_seen_pct < 50, stores rolling 7-day median effective_rpd, and caps lending at min(rpd_limit, effective_rpd)", async () => {
    const stub = getCoordinatorStub("test-coord-drained-cap");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      const day1 = Date.UTC(2030, 1, 10, 12, 0, 0);
      coord.setClockForTest(day1);

      await coord.upsertKey({
        keyId: "key_drain_cap",
        owner: "owner_drain_cap",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 100,
      });

      // Only 3 dispatches before rpd_exhausted (kc_seen_pct = 3 < 50) -> drained day, effective_rpd = 3
      for (let i = 0; i < 2; i++) {
        const l = await coord.lease({
          tenant: `b_${i}`,
          ownOnly: false,
          model: "gemini-3.5-flash",
        });
        await coord.settle(l!.leaseId, "ok", 10, undefined, "gemini-3.5-flash");
      }
      const l3 = await coord.lease({
        tenant: "b_2",
        ownOnly: false,
        model: "gemini-3.5-flash",
      });
      const res = await coord.settle(l3!.leaseId, "rpd_exhausted", 0, day1 + 1000, "gemini-3.5-flash");
      expect(res.classification?.kcSeenPct).toBe(3);
      expect(res.classification?.effectiveRpd).toBe(3);

      // Next day: reactivate key and verify lending (ownOnly=false) is capped at effective_rpd = 3
      const day2 = Date.UTC(2030, 1, 11, 12, 0, 0);
      coord.setClockForTest(day2);
      await coord.setStatus("key_drain_cap", "ACTIVE");

      for (let i = 0; i < 3; i++) {
        const l = await coord.lease({
          tenant: `b_next_${i}`,
          ownOnly: false,
          model: "gemini-3.5-flash",
        });
        expect(l).not.toBeNull();
        await coord.settle(l!.leaseId, "ok", 10, undefined, "gemini-3.5-flash");
      }

      // 4th borrowed lease is blocked because effective_rpd = 3 caps lending at min(100, 3) = 3
      const cappedLease = await coord.lease({
        tenant: "b_next_4",
        ownOnly: false,
        model: "gemini-3.5-flash",
      });
      expect(cappedLease).toBeNull();

      // Owner's own use (ownOnly=true) is NOT capped by effective_rpd
      const ownerLease = await coord.lease({
        tenant: "owner_drain_cap",
        ownOnly: true,
        model: "gemini-3.5-flash",
      });
      expect(ownerLease).not.toBeNull();
    });
  });

  it("transitions to DRAINED after 5 drained days in 7 with one notification, and recovers to OK after 3 consecutive clean days with one notification", async () => {
    const owner = await createUser({ github: true, eligible: true });
    const keyRow = await addProviderKey(owner, {
      provider: "google",
      pool: "COMMUNITY",
      plaintext: "AIzaSyDrainedLifecycleTestKey00000002",
      rpmLimit: 500,
      rpdLimit: 100,
    });

    const stub = getCoordinatorStub("test-coord-5of7-recovery");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      await coord.upsertKey({
        keyId: keyRow.id,
        owner: owner.id,
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 100,
      });

      // Days 1..5: each day has a drained exhaustion (kc_seen_pct = 1 < 50)
      for (let d = 1; d <= 5; d++) {
        const t = Date.UTC(2030, 2, d, 12, 0, 0);
        coord.setClockForTest(t);
        await coord.setStatus(keyRow.id, "ACTIVE");

        const l = await coord.lease({
          tenant: owner.id,
          ownOnly: true,
          model: "gemini-3.5-flash",
        });
        expect(l).not.toBeNull();
        await coord.settle(l!.leaseId, "rpd_exhausted", 0, t + 1000, "gemini-3.5-flash");

        const st = await coord.getKeyState(keyRow.id, "gemini-3.5-flash");
        if (d < 5) {
          expect(st?.drainState).toBe("OK");
        } else {
          expect(st?.drainState).toBe("DRAINED");
        }
      }

      // Verify D1 api_keys.drain_state is mirrored to 'DRAINED' and exactly 1 notification was created
      const d1KeyAfterDrain = await env.DB.prepare(
        "SELECT drain_state FROM api_keys WHERE id = ?"
      )
        .bind(keyRow.id)
        .first<{ drain_state: string }>();
      expect(d1KeyAfterDrain?.drain_state).toBe("DRAINED");

      const drainNotifs = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM notifications WHERE tenant_id = ? AND key_id = ? AND type = 'key_drained'"
      )
        .bind(owner.id, keyRow.id)
        .first<{ count: number }>();
      expect(drainNotifs?.count).toBe(1);

      // Days 6, 7, 8: 3 consecutive clean days (kc_seen_pct = 60 >= 50 on exhaustion) -> back to OK
      for (let d = 6; d <= 8; d++) {
        const t = Date.UTC(2030, 2, d, 12, 0, 0);
        coord.setClockForTest(t);
        await coord.setStatus(keyRow.id, "ACTIVE");

        for (let i = 0; i < 59; i++) {
          const l = await coord.lease({
            tenant: owner.id,
            ownOnly: true,
            model: "gemini-3.5-flash",
          });
          await coord.settle(l!.leaseId, "ok", 10, undefined, "gemini-3.5-flash");
        }
        const last = await coord.lease({
          tenant: owner.id,
          ownOnly: true,
          model: "gemini-3.5-flash",
        });
        await coord.settle(last!.leaseId, "rpd_exhausted", 0, t + 1000, "gemini-3.5-flash");

        const st = await coord.getKeyState(keyRow.id, "gemini-3.5-flash");
        if (d < 8) {
          expect(st?.drainState).toBe("DRAINED");
        } else {
          expect(st?.drainState).toBe("OK");
        }
      }

      const d1KeyAfterRecovery = await env.DB.prepare(
        "SELECT drain_state FROM api_keys WHERE id = ?"
      )
        .bind(keyRow.id)
        .first<{ drain_state: string }>();
      expect(d1KeyAfterRecovery?.drain_state).toBe("OK");

      const recoveryNotifs = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM notifications WHERE tenant_id = ? AND key_id = ? AND type = 'key_recovered'"
      )
        .bind(owner.id, keyRow.id)
        .first<{ count: number }>();
      expect(recoveryNotifs?.count).toBe(1);
    });
  });

  it("tracks counters per model and survives coordinator eviction (AC-11)", async () => {
    const stub = getCoordinatorStub("test-coord-per-model-eviction");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      const t0 = Date.UTC(2030, 3, 1, 12, 0, 0);
      coord.setClockForTest(t0);

      await coord.upsertKey({
        keyId: "key_multi_model",
        owner: "owner_multi",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 100,
      });

      // 3 dispatches on gemini-3.5-flash (2 borrowed, 1 own)
      for (let i = 0; i < 2; i++) {
        const l = await coord.lease({
          tenant: `b_flash_${i}`,
          ownOnly: false,
          model: "gemini-3.5-flash",
        });
        await coord.settle(l!.leaseId, "ok", 15, undefined, "gemini-3.5-flash");
      }
      const lOwn = await coord.lease({
        tenant: "owner_multi",
        ownOnly: true,
        model: "gemini-3.5-flash",
      });
      await coord.settle(lOwn!.leaseId, "ok", 10, undefined, "gemini-3.5-flash");

      // 1 dispatch on gemini-3.1-pro-preview that hits rpd_exhausted (kc_seen_pct = 1 < 50 -> drained day for pro)
      const lPro = await coord.lease({
        tenant: "b_pro_1",
        ownOnly: false,
        model: "gemini-3.1-pro-preview",
      });
      await coord.settle(lPro!.leaseId, "rpd_exhausted", 0, t0 + 5000, "gemini-3.1-pro-preview");

      // Simulate coordinator eviction
      coord.clearMemoryCache();

      const flashState = await coord.getKeyState("key_multi_model", "gemini-3.5-flash");
      expect(flashState?.dispatchedToday).toBe(4);
      expect(flashState?.dispatchedCommunal).toBe(3);
      expect(flashState?.modelStats?.dispatchedToday).toBe(3);
      expect(flashState?.modelStats?.dispatchedCommunal).toBe(2);
      expect(flashState?.modelStats?.cuServed).toBe(40);

      const proState = await coord.getKeyState("key_multi_model", "gemini-3.1-pro-preview");
      expect(proState?.modelStats?.dispatchedToday).toBe(1);
      expect(proState?.modelStats?.dispatchedCommunal).toBe(1);
      expect(proState?.effectiveRpd).toBe(1);
    });
  });

  it("flushes per-key daily stats to D1 key_daily_stats and resets coordinator counters on midnight alarm (T-5.5.4)", async () => {
    const owner = await createUser({ github: true, eligible: true });
    const keyRow = await addProviderKey(owner, {
      provider: "google",
      pool: "COMMUNITY",
      plaintext: "AIzaSyMidnightFlushTestKey00000000003",
      rpmLimit: 500,
      rpdLimit: 100,
    });

    const stub = getCoordinatorStub("test-coord-midnight-flush");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      // Day 1: 2030-04-10 23:50:00 UTC
      const day1 = Date.UTC(2030, 3, 10, 23, 50, 0);
      coord.setClockForTest(day1);

      await coord.upsertKey({
        keyId: keyRow.id,
        owner: owner.id,
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 100,
      });

      // 2 borrowed dispatches + 1 own dispatch on gemini-3.5-flash
      for (let i = 0; i < 2; i++) {
        const l = await coord.lease({
          tenant: `borrower_flush_${i}`,
          ownOnly: false,
          model: "gemini-3.5-flash",
        });
        await coord.settle(l!.leaseId, "ok", 25, undefined, "gemini-3.5-flash");
      }
      const ownLease = await coord.lease({
        tenant: owner.id,
        ownOnly: true,
        model: "gemini-3.5-flash",
      });
      await coord.settle(ownLease!.leaseId, "ok", 10, undefined, "gemini-3.5-flash");

      const beforeStats = await coord.stats();
      expect(beforeStats.dispatchedToday).toBe(3);
      expect(beforeStats.dispatchedCommunal).toBe(2);

      // Advance clock past midnight UTC -> 2030-04-11 00:00:05 UTC and run alarm
      const midnight = Date.UTC(2030, 3, 11, 0, 0, 5);
      coord.setClockForTest(midnight);
      await coord.alarm();

      // Coordinator daily counters are reset to 0
      const afterStats = await coord.stats();
      expect(afterStats.dispatchedToday).toBe(0);
      expect(afterStats.dispatchedCommunal).toBe(0);

      const afterKeyState = await coord.getKeyState(keyRow.id, "gemini-3.5-flash");
      expect(afterKeyState?.dispatchedToday).toBe(0);
      expect(afterKeyState?.dispatchedCommunal).toBe(0);
      expect(afterKeyState?.modelStats?.dispatchedToday).toBe(0);
      expect(afterKeyState?.modelStats?.dispatchedCommunal).toBe(0);
      expect(afterKeyState?.modelStats?.cuServed).toBe(0);
    });

    // Verify D1 key_daily_stats has the flushed row for 2030-04-10
    const dailyRow = await env.DB.prepare(
      `SELECT key_id, day, model, dispatched, communal, cu_served, classification
         FROM key_daily_stats
        WHERE key_id = ? AND day = '2030-04-10' AND model = 'gemini-3.5-flash'`
    )
      .bind(keyRow.id)
      .first<{
        key_id: string;
        day: string;
        model: string;
        dispatched: number;
        communal: number;
        cu_served: number;
        classification: string | null;
      }>();

    expect(dailyRow).not.toBeNull();
    expect(dailyRow?.dispatched).toBe(3);
    expect(dailyRow?.communal).toBe(2);
    expect(dailyRow?.cu_served).toBe(60);
  });
});
