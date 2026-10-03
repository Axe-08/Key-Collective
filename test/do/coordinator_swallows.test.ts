/**
 * WP-F.10 T-F.10.4 (AU-02): PoolCoordinatorDO no longer swallows failed writes.
 * - The ROTATING -> TOMBSTONED D1 update logs its failure; the next alarm retries.
 * - A failed pool:bands push is logged and retried on the next alarm, even
 *   inside the same hour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { PoolCoordinatorDO } from "../../src/pool/coordinator_do";

function getCoordinatorStub(name: string): DurableObjectStub {
  const ns = (env as unknown as { POOL_COORDINATOR: DurableObjectNamespace }).POOL_COORDINATOR;
  return ns.get(ns.idFromName(name));
}

function loggedLines(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((c: unknown[]) => String(c[0]));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PoolCoordinatorDO failed writes are logged and retried (AU-02)", () => {
  it("logs a failed tombstone update and applies it on the next alarm", async () => {
    const now = Date.UTC(2031, 4, 6, 9, 0, 0);
    const projectHash = `ph_swallow_${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO project_hash_registry (project_hash, tenant_id, provider, state, rotating_until) VALUES (?, 'usr_swallow', 'google', 'ROTATING', ?)"
    )
      .bind(projectHash, now - 60_000)
      .run();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stub = getCoordinatorStub(`test-swallow-tombstone-${crypto.randomUUID()}`);

    await env.DB.prepare("ALTER TABLE project_hash_registry RENAME TO phr_x").run();
    try {
      await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
        coord.setClockForTest(now);
        await coord.alarm();
      });
    } finally {
      await env.DB.prepare("ALTER TABLE phr_x RENAME TO project_hash_registry").run();
    }
    expect(loggedLines(errorSpy).some((l) => l.includes("project_hash_tombstone_failed"))).toBe(true);

    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(now + 60_000);
      await coord.alarm();
    });
    const row = await env.DB.prepare("SELECT state FROM project_hash_registry WHERE project_hash = ?")
      .bind(projectHash)
      .first<{ state: string }>();
    expect(row?.state).toBe("TOMBSTONED");
  });

  it("logs a failed pool:bands push and retries it on the next alarm within the same hour", async () => {
    const now = Date.UTC(2031, 4, 6, 10, 0, 0);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stub = getCoordinatorStub(`test-swallow-bands-${crypto.randomUUID()}`);

    const failingNs = {
      idFromName: (name: string) => name,
      get: () => ({
        setPoolBand: async (): Promise<void> => {
          throw new Error("bands shard unavailable");
        },
      }),
    };
    const pushes: Array<{ provider: string; bandCap: number }> = [];
    const recordingNs = {
      idFromName: (name: string) => name,
      get: () => ({
        setPoolBand: async (provider: string, _util: number, bandCap: number): Promise<void> => {
          pushes.push({ provider, bandCap });
        },
      }),
    };

    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(now);
      await coord.upsertKey({
        keyId: `key_bands_${crypto.randomUUID()}`,
        owner: "owner_bands",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 10,
        rpdLimit: 100,
      });
      coord.setEnvForTest({ POOL_COORDINATOR: failingNs });
      await coord.alarm();
    });
    expect(loggedLines(errorSpy).some((l) => l.includes("pool_band_push_failed"))).toBe(true);

    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      coord.setEnvForTest({ POOL_COORDINATOR: recordingNs });
      coord.setClockForTest(now + 60_000);
      await coord.alarm();
    });
    expect(pushes).toEqual([{ provider: "google", bandCap: 450 }]);

    // Once delivered, an unchanged band is not pushed again.
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(now + 120_000);
      await coord.alarm();
    });
    expect(pushes).toHaveLength(1);
  });
});
