import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PoolCoordinatorDO } from "../../../src/pool/coordinator_do";

function getCoordinatorStub(shard: string): DurableObjectStub<PoolCoordinatorDO> {
  const ns = env.POOL_COORDINATOR as DurableObjectNamespace<PoolCoordinatorDO>;
  return ns.get(ns.idFromName(shard));
}

describe("WP-5.10 T-5.10.1 — Coordinator hourly stats", () => {
  it("computes exact integer utilisationPct, p90LatencyMs, and wProviderPct on seeded coordinator", async () => {
    const stub = getCoordinatorStub("pool:telemetry_stats_1");
    const t0 = Date.UTC(2030, 5, 1, 12, 0, 0);

    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(t0);

      // Seed 2 ACTIVE keys (rpdLimit = 100 each => sum rpd_limit = 200), 1 OBSERVATION, 1 QUARANTINED
      await coord.upsertKey({
        keyId: "k_act_1",
        owner: "usr_tel_a",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 100,
        rpdLimit: 100,
      });
      await coord.upsertKey({
        keyId: "k_act_2",
        owner: "usr_tel_b",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 100,
        rpdLimit: 100,
      });
      await coord.upsertKey({
        keyId: "k_obs_1",
        owner: "usr_tel_a",
        provider: "google",
        status: "OBSERVATION",
        rpmLimit: 100,
        rpdLimit: 100,
      });
      await coord.upsertKey({
        keyId: "k_quar_1",
        owner: "usr_tel_b",
        provider: "google",
        status: "QUARANTINED",
        rpmLimit: 100,
        rpdLimit: 100,
      });

      // Dispatch 10 requests on ACTIVE keys with latencies [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] ms
      // -> p90 (9th of 10 sorted) = 900 ms
      // -> sum(day_count) over ACTIVE keys = 10; sum(rpd_limit) over ACTIVE keys = 200 -> utilisationPct = 5
      const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
      for (let i = 0; i < latencies.length; i++) {
        const l = await coord.lease({
          tenant: "usr_tel_a",
          ownOnly: false,
          estimateCu: 10,
          provider: "google",
        });
        expect(l).not.toBeNull();
        await coord.settle(l!.leaseId, "ok", 10, undefined, "gemini-2.5-flash", latencies[i]);
      }

      await coord.alarm();
      const st = await coord.stats();

      expect(st.activeKeys).toBe(2);
      expect(st.observationKeys).toBe(1);
      expect(st.quarantinedKeys).toBe(1);
      expect(st.utilisationPct).toBe(5);
      expect(st.p90LatencyMs).toBe(900);
      // active_ratio_pct = 2 * 100 / (2 + 1) = 66
      // min(100, floor(800 * 100 / 900)) = 88
      // w_provider_pct = floor(66 * 88 / 100) = 58
      expect(st.wProviderPct).toBe(58);
    });
  });

  it("returns wProviderPct = 100 when p90 <= 800 ms and all keys are active", async () => {
    const stub = getCoordinatorStub("pool:telemetry_stats_optimal");
    const t0 = Date.UTC(2030, 5, 1, 13, 0, 0);

    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(t0);

      await coord.upsertKey({
        keyId: "k_opt_1",
        owner: "usr_opt_a",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 100,
        rpdLimit: 100,
      });
      await coord.upsertKey({
        keyId: "k_opt_2",
        owner: "usr_opt_b",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 100,
        rpdLimit: 100,
      });

      const l = await coord.lease({
        tenant: "usr_opt_a",
        ownOnly: false,
        estimateCu: 10,
        provider: "google",
      });
      expect(l).not.toBeNull();
      await coord.settle(l!.leaseId, "ok", 10, undefined, "gemini-2.5-flash", 450);

      const st = await coord.stats();
      expect(st.activeKeys).toBe(2);
      expect(st.quarantinedKeys).toBe(0);
      expect(st.p90LatencyMs).toBe(450);
      expect(st.wProviderPct).toBe(100);
    });
  });
});
