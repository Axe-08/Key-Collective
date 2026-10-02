import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PoolCoordinatorDO } from "../../../src/pool/coordinator_do";
import { handlePoolRoute } from "../../../src/worker/pool_routes";
import { handleGetKeys } from "../../../src/worker/router/dashboard/keys/get_keys";
import { addProviderKey, createUser } from "../../helpers/world";

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

describe("WP-5.10 T-5.10.2 — Truthful telemetry endpoints", () => {
  it("GET /api/pool/telemetry aggregates coordinator stats(), reports w_provider = 1.0 when p90 <= 800 ms and all keys active, and does not mutate coordinator state", async () => {
    const userA = await createUser({ github: true, eligible: true });
    const userB = await createUser({ github: true, eligible: true });

    const googleStub = getCoordinatorStub("pool:google");
    const groqStub = getCoordinatorStub("pool:groq");
    const t0 = Date.UTC(2030, 5, 2, 10, 0, 0);

    await runInDurableObject(googleStub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(t0);
      await coord.upsertKey({
        keyId: "k_tel_google_1",
        owner: userA.id,
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 100,
        rpdLimit: 100,
      });
      await coord.upsertKey({
        keyId: "k_tel_google_2",
        owner: userB.id,
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 100,
        rpdLimit: 100,
      });
      const lease = await coord.lease({
        tenant: userA.id,
        ownOnly: false,
        estimateCu: 10,
        provider: "google",
      });
      expect(lease).not.toBeNull();
      await coord.settle(lease!.leaseId, "ok", 10, undefined, "gemini-2.5-flash", 600);
    });

    await runInDurableObject(groqStub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(t0);
      await coord.upsertKey({
        keyId: "k_tel_groq_1",
        owner: userB.id,
        provider: "groq",
        status: "OBSERVATION",
        rpmLimit: 100,
        rpdLimit: 100,
      });
    });

    const statsBeforeGoogle = await runInDurableObject(googleStub, (c: PoolCoordinatorDO) =>
      c.stats()
    );

    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromises.push(p);
      },
    };

    const req = new Request("https://console.test/api/pool/telemetry");
    const res = await handlePoolRoute(
      "/api/pool/telemetry",
      "GET",
      req,
      env,
      userA.id,
      ctx
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(waitUntilPromises.length).toBe(0);

    const body = (await res!.json()) as {
      total_active_keys: number;
      keys_in_observation: number;
      keys_quarantined: number;
      pool_utilization_percent: number;
      provider_pools: Array<{
        provider: string;
        active_keys: number;
        observation_keys: number;
        quarantined_keys: number;
        u_pool_percent: number;
        w_provider: number;
        p90_latency_ms: number;
        eye_for_eye_accessible: boolean;
      }>;
    };

    expect(body.total_active_keys).toBe(2);
    expect(body.keys_in_observation).toBe(1);
    expect(body.keys_quarantined).toBe(0);

    const geminiPool = body.provider_pools.find((p) => p.provider === "gemini");
    expect(geminiPool).toBeDefined();
    expect(geminiPool!.active_keys).toBe(2);
    expect(geminiPool!.p90_latency_ms).toBe(600);
    expect(geminiPool!.w_provider).toBe(1.0);
    expect(geminiPool!.eye_for_eye_accessible).toBe(true);

    const groqPool = body.provider_pools.find((p) => p.provider === "groq");
    expect(groqPool).toBeDefined();
    expect(groqPool!.observation_keys).toBe(1);
    expect(groqPool!.eye_for_eye_accessible).toBe(false);

    const statsAfterGoogle = await runInDurableObject(googleStub, (c: PoolCoordinatorDO) =>
      c.stats()
    );
    expect(statsAfterGoogle).toEqual(statsBeforeGoogle);
  });

  it("handleGetKeys reads per-key dispatches_today and dispatches_communal from coordinator instead of stale D1 columns", async () => {
    const owner = await createUser({ github: true, eligible: true });
    const borrower = await createUser({ github: true, eligible: true });

    const key = await addProviderKey(owner, {
      provider: "google",
      pool: "COMMUNITY",
      plaintext: "AIzaSyTruthfulGetKeysCoordinatorKey01",
      rpmLimit: 100,
      rpdLimit: 1000,
    });

    const googleStub = getCoordinatorStub("pool:google");
    const t0 = Date.UTC(2030, 5, 2, 11, 0, 0);
    await runInDurableObject(googleStub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(t0);
      await coord.upsertKey({
        keyId: key.id,
        owner: owner.id,
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 100,
        rpdLimit: 1000,
      });

      // 2 communal dispatches + 1 own dispatch -> dispatches_today = 3, dispatches_communal = 2
      const l1 = await coord.lease({ tenant: borrower.id, ownOnly: false, provider: "google" });
      await coord.settle(l1!.leaseId, "ok", 10);
      const l2 = await coord.lease({ tenant: borrower.id, ownOnly: false, provider: "google" });
      await coord.settle(l2!.leaseId, "ok", 10);
      const l3 = await coord.lease({ tenant: owner.id, ownOnly: true, provider: "google" });
      await coord.settle(l3!.leaseId, "ok", 10);
    });

    const res = await handleGetKeys(env, owner.id);
    expect(res.status).toBe(200);
    const items = (await res.json()) as Array<{
      id: string;
      dispatches_today: number;
      dispatches_communal: number;
    }>;
    const item = items.find((i) => i.id === key.id);
    expect(item).toBeDefined();
    expect(item!.dispatches_today).toBe(3);
    expect(item!.dispatches_communal).toBe(2);
  });
});
