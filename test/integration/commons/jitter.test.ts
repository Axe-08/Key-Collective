import { describe, expect, it } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { PoolCoordinatorDO } from "../../../src/pool/coordinator_do";
import { nextProviderReset } from "../../../src/providers/config";

function getCoordinatorStub(name: string): DurableObjectStub {
  return env.POOL_COORDINATOR.get(env.POOL_COORDINATOR.idFromName(name));
}

/**
 * Computes the one-sample Kolmogorov–Smirnov statistic D_n against Uniform(a, b).
 */
function ksStatisticUniform(samples: number[], a: number, b: number): number {
  const n = samples.length;
  if (n === 0 || b <= a) return 1;
  const sorted = [...samples].sort((x, y) => x - y);
  let maxDiff = 0;
  for (let i = 0; i < n; i++) {
    const u = Math.min(1, Math.max(0, (sorted[i] - a) / (b - a)));
    const dPlus = Math.abs((i + 1) / n - u);
    const dMinus = Math.abs(u - i / n);
    if (dPlus > maxDiff) maxDiff = dPlus;
    if (dMinus > maxDiff) maxDiff = dMinus;
  }
  return maxDiff;
}

describe("RPD reset jitter (WP-5.8 T-5.8.2)", () => {
  it("AC-12: exhausting 100 keys at 23:59:30 provider time sets reactivate_at within [reset, reset+300s], spread > 240s, and KS statistic < 0.05", async () => {
    const stub = getCoordinatorStub("test-jitter-100-keys");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      // 2030-06-15 06:59:30 UTC is 23:59:30 PDT (America/Los_Angeles)
      const now = Date.UTC(2030, 5, 15, 6, 59, 30);
      const reset = nextProviderReset("google", now);
      expect(reset).toBe(Date.UTC(2030, 5, 15, 7, 0, 0));

      coord.setClockForTest(now);
      coord.setEnvForTest({
        COMMONS_ENFORCEMENT: "observe",
      });

      const keyIds: string[] = [];
      for (let i = 0; i < 100; i++) {
        const keyId = `key_jitter_${String(i).padStart(3, "0")}`;
        keyIds.push(keyId);
        await coord.upsertKey({
          keyId,
          owner: `owner_jitter_${i}`,
          provider: "google",
          status: "ACTIVE",
          rpmLimit: 100,
          rpdLimit: 1000,
        });
      }

      const reactivateTimestamps: number[] = [];

      for (let i = 0; i < 100; i++) {
        const keyId = keyIds[i];
        const lease = await coord.lease({
          tenant: `owner_jitter_${i}`,
          ownOnly: true,
        });
        expect(lease).not.toBeNull();
        expect(lease?.keyId).toBe(keyId);

        await coord.settle(lease!.leaseId, "rpd_exhausted", 0);

        const state = await coord.getKeyState(keyId);
        expect(state?.status).toBe("COOLDOWN");
        expect(typeof state?.reactivateAt).toBe("number");
        const reactivateAt = state!.reactivateAt!;
        expect(reactivateAt).toBeGreaterThanOrEqual(reset);
        expect(reactivateAt).toBeLessThanOrEqual(reset + 300_000);
        reactivateTimestamps.push(reactivateAt);
      }

      const minReactivate = Math.min(...reactivateTimestamps);
      const maxReactivate = Math.max(...reactivateTimestamps);
      const spreadMs = maxReactivate - minReactivate;
      expect(spreadMs).toBeGreaterThan(240_000);

      const ks = ksStatisticUniform(reactivateTimestamps, reset, reset + 300_000);
      expect(ks).toBeLessThan(0.05);

      // Alarm after reset + 300_000 reactivates all 100 keys
      coord.setClockForTest(reset + 300_001);
      await coord.alarm();
      const statsAfter = await coord.stats();
      expect(statsAfter.activeKeys).toBe(100);
      expect(statsAfter.cooldownKeys).toBe(0);
    });
  });
});
