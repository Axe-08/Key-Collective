import { describe, it, expect } from 'vitest';
import { PoolCoordinatorDO } from '../../src/pool/coordinator_do';

describe('PoolCoordinatorDO', () => {
  it('instantiates cleanly and provides base methods', () => {
    expect(PoolCoordinatorDO).toBeDefined();
  });

  it('persists provider status to ctx.storage and restores on reboot', async () => {
    const memory = new Map<string, any>();
    const mockStorage = {
      get: async (key: string) => memory.get(key),
      put: async (key: string, val: any) => memory.set(key, val),
      getAlarm: async () => null,
      setAlarm: async () => {},
    };

    const do1 = new PoolCoordinatorDO({ storage: mockStorage });
    const updateReq = new Request("http://coordinator/coordinator/update-provider", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "gemini",
        activeKeys: 10,
        quarantineKeys: 1,
        latencyMs: 120,
      }),
    });

    const updateRes = await do1.fetch(updateReq);
    expect(updateRes.status).toBe(200);
    expect(memory.has("providers")).toBe(true);

    // Instantiate fresh DO instance with same storage (simulating eviction restart)
    const do2 = new PoolCoordinatorDO({ storage: mockStorage });
    // Wait microtask for initStorage
    await new Promise((r) => setTimeout(r, 10));

    const healthRes = await do2.fetch(new Request("http://coordinator/coordinator/health"));
    const healthData = (await healthRes.json()) as any;
    expect(healthData.gemini).toBeDefined();
    expect(healthData.gemini.activeKeys).toBe(10);
  });
});
