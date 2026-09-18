import { describe, it, expect } from 'vitest';
import { PoolCoordinatorDO } from '../../src/pool/coordinator_do';

function makeMockCtx() {
  const memory = new Map<string, unknown>();
  return {
    storage: {
      get: async (k: string) => memory.get(k),
      put: async (k: string, v: unknown) => { memory.set(k, v); },
      getAlarm: async () => null,
      setAlarm: async () => {},
    },
    memory,
  };
}

function makeCoordinator() {
  const ctx = makeMockCtx();
  return { do: new PoolCoordinatorDO(ctx as any), ctx };
}

async function reportVolume(do_: PoolCoordinatorDO, tenantId: string, volume = 1) {
  return do_.fetch(new Request("http://coordinator/coordinator/report-volume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, volume }),
  }));
}

async function checkBrake(do_: PoolCoordinatorDO, tenantId: string) {
  const res = await do_.fetch(
    new Request(`http://coordinator/coordinator/brake-status/${tenantId}`)
  );
  return res.json<{ braked: boolean }>();
}

// ── 1. Instantiation & Storage ───────────────────────────────────────────────
describe('PoolCoordinatorDO — instantiation & persistence', () => {
  it('instantiates without throwing', () => {
    const { do: coord } = makeCoordinator();
    expect(coord).toBeDefined();
  });

  it('persists provider status to ctx.storage and restores on reboot', async () => {
    const ctx = makeMockCtx();
    const do1 = new PoolCoordinatorDO(ctx as any);
    await do1.fetch(new Request("http://coordinator/coordinator/update-provider", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "gemini", activeKeys: 10, quarantineKeys: 1, latencyMs: 120 }),
    }));

    // Simulate eviction: new DO instance with same storage
    const do2 = new PoolCoordinatorDO(ctx as any);
    await new Promise(r => setTimeout(r, 20)); // wait for initStorage

    const healthRes = await do2.fetch(new Request("http://coordinator/coordinator/health"));
    const health = await healthRes.json<Record<string, { activeKeys: number }>>();
    expect(health.gemini.activeKeys).toBe(10);
  });

  it('restores active brakes after eviction restart', async () => {
    const ctx = makeMockCtx();
    const do1 = new PoolCoordinatorDO(ctx as any);

    await reportVolume(do1, "tenantB", 64);
    for (let i = 0; i < 36; i++) {
      await reportVolume(do1, "tenantA", 1);
    }

    const brake1 = await checkBrake(do1, "tenantA");
    expect(brake1.braked).toBe(true);

    const do2 = new PoolCoordinatorDO(ctx as any);
    await new Promise(r => setTimeout(r, 20));
    const brake2 = await checkBrake(do2, "tenantA");
    expect(brake2.braked).toBe(true);
  });
});

// ── 2. Anomalous Spiker Brake ─────────────────────────────────────────────────
describe('PoolCoordinatorDO — Anomalous Spiker Brake', () => {
  it('applies brake when single tenant exceeds 35% of pool volume', async () => {
    const { do: coord } = makeCoordinator();
    await reportVolume(coord, "otherTenant", 64);
    let lastRes: { brakeApplied: boolean } = { brakeApplied: false };
    for (let i = 0; i < 36; i++) {
      const res = await reportVolume(coord, "abusiveTenant");
      lastRes = await res.json();
    }
    expect(lastRes.brakeApplied).toBe(true);
  });

  it('does NOT brake when tenant is at or below 35% of pool volume', async () => {
    const { do: coord } = makeCoordinator();
    await reportVolume(coord, "otherTenant", 65);
    for (let i = 0; i < 35; i++) {
      await reportVolume(coord, "tenantA");
    }
    const brake = await checkBrake(coord, "tenantA");
    expect(brake.braked).toBe(false);
  });

  it('brake expires after timeout', async () => {
    const { do: coord } = makeCoordinator();
    await reportVolume(coord, "other", 64);
    for (let i = 0; i < 36; i++) {
      await reportVolume(coord, "abusive");
    }

    const before = await checkBrake(coord, "abusive");
    expect(before.braked).toBe(true);

    // Mock expired brake timestamp
    const memory = (coord as any).activeBrakes as Map<string, number>;
    memory.set("abusive", Date.now() - 1000);

    const after = await checkBrake(coord, "abusive");
    expect(after.braked).toBe(false);
  });

  it('does not brake tenants with zero volume', async () => {
    const { do: coord } = makeCoordinator();
    const brake = await checkBrake(coord, "freshTenant");
    expect(brake.braked).toBe(false);
  });

  it('isolates brakes: braking tenantA does not affect tenantB', async () => {
    const { do: coord } = makeCoordinator();
    await reportVolume(coord, "other", 64);
    for (let i = 0; i < 36; i++) {
      await reportVolume(coord, "tenantA");
    }

    const brakeA = await checkBrake(coord, "tenantA");
    const brakeB = await checkBrake(coord, "tenantB");
    expect(brakeA.braked).toBe(true);
    expect(brakeB.braked).toBe(false);
  });
});

// ── 3. Provider Weight Computation ───────────────────────────────────────────
describe('PoolCoordinatorDO — provider weight computation', () => {
  it('computes positive wProvider for healthy provider', async () => {
    const { do: coord } = makeCoordinator();
    const res = await coord.fetch(new Request("http://coordinator/coordinator/update-provider", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "groq", activeKeys: 10, quarantineKeys: 0, latencyMs: 100 }),
    }));
    const data = await res.json<{ wProvider: number }>();
    expect(data.wProvider).toBeGreaterThan(0);
  });

  it('computes higher wProvider for low-latency provider', async () => {
    const { do: coord } = makeCoordinator();

    await coord.fetch(new Request("http://coordinator/coordinator/update-provider", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "fastProvider", activeKeys: 10, quarantineKeys: 0, latencyMs: 50 }),
    }));
    await coord.fetch(new Request("http://coordinator/coordinator/update-provider", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "slowProvider", activeKeys: 10, quarantineKeys: 0, latencyMs: 500 }),
    }));

    const healthRes = await coord.fetch(new Request("http://coordinator/coordinator/health"));
    const health = await healthRes.json<Record<string, { wProvider: number }>>();

    expect(health.fastProvider.wProvider).toBeGreaterThan(health.slowProvider.wProvider);
  });

  it('computes lower wProvider for provider with quarantined keys', async () => {
    const { do: coord } = makeCoordinator();

    await coord.fetch(new Request("http://coordinator/coordinator/update-provider", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "healthy", activeKeys: 10, quarantineKeys: 0, latencyMs: 200 }),
    }));
    await coord.fetch(new Request("http://coordinator/coordinator/update-provider", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "degraded", activeKeys: 5, quarantineKeys: 5, latencyMs: 200 }),
    }));

    const res = await coord.fetch(new Request("http://coordinator/coordinator/health"));
    const health = await res.json<Record<string, { wProvider: number }>>();
    expect(health.healthy.wProvider).toBeGreaterThan(health.degraded.wProvider);
  });
});

// ── 4. HTTP Interface ─────────────────────────────────────────────────────────
describe('PoolCoordinatorDO — HTTP interface', () => {
  it('returns 404 for unknown routes', async () => {
    const { do: coord } = makeCoordinator();
    const res = await coord.fetch(new Request("http://coordinator/coordinator/unknown"));
    expect(res.status).toBe(404);
  });

  it('GET /coordinator/health returns JSON object', async () => {
    const { do: coord } = makeCoordinator();
    const res = await coord.fetch(new Request("http://coordinator/coordinator/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe("object");
  });
});
