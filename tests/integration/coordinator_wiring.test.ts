import { describe, it, expect, vi } from 'vitest';
import { PoolCoordinatorDO } from '../../src/pool/coordinator_do';
import { ChatHandler } from '../../src/worker/router/chat/handler';
import type { AuthenticatedContext, WorkerEnv } from '../../src/worker/auth/index';

function createMockStorage() {
  const memory = new Map<string, unknown>();
  return {
    get: async (k: string) => memory.get(k),
    put: async (k: string, v: unknown) => { memory.set(k, v); },
    getAlarm: async () => null,
    setAlarm: async () => {},
  };
}

describe('PoolCoordinatorDO & ChatHandler Wiring Integration', () => {
  it('enforces emergency brake when tenant exceeds 35% pool volume', async () => {
    const storage = createMockStorage();
    const coordinator = new PoolCoordinatorDO({ storage } as any);

    // Baseline volume from other tenants: 64 requests
    await coordinator.fetch(new Request('http://coordinator/coordinator/report-volume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'tenant_other', volume: 64 }),
    }));

    // Abusive tenant sends 36 requests -> 36% > 35% -> triggers brake
    for (let i = 0; i < 36; i++) {
      await coordinator.fetch(new Request('http://coordinator/coordinator/report-volume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId: 'tenant_abusive', volume: 1 }),
      }));
    }

    const brakeCheck = await coordinator.fetch(
      new Request('http://coordinator/coordinator/brake-status/tenant_abusive')
    );
    const brakeData = await brakeCheck.json<{ braked: boolean }>();
    expect(brakeData.braked).toBe(true);

    // Wire up ChatHandler with this coordinator stub
    const mockEnv: WorkerEnv = {
      POOL_COORDINATOR: {
        idFromName: () => 'global',
        get: () => ({
          fetch: (url: string, init?: RequestInit) => coordinator.fetch(new Request(url, init)),
        }),
      } as any,
    };

    const dummyDeps: any = {
      options: {},
      modelRegistry: { calculateCost: () => 0n },
      timeProvider: () => Date.now(),
      getKeyPool: () => ({ recordUsage: vi.fn() }),
      getRouter: () => ({ route: vi.fn() }),
      getCostLedgerRepo: () => undefined,
      getAuthTokensRepo: () => undefined,
      getTelemetryEmitter: () => ({ emit: vi.fn() }),
    };

    const handler = new ChatHandler(dummyDeps);
    const authCtx: AuthenticatedContext = {
      tenantId: 'tenant_abusive',
      isAuthenticated: true,
      rpmLimit: 60,
      currentRpm: 1,
      remainingRpm: 59,
      budgetMicrodollars: 1000n,
      spentMicrodollars: 0n,
      token: { id: 'tok_1', hashSha256: 'h1', tenantId: 'tenant_abusive', budgetMicrodollars: 1000n, spentMicrodollars: 0n, allowedProviders: [], rpmLimit: 60, expiresAt: null, createdAt: new Date().toISOString() },
    };

    // Chat request should be blocked with 429 EMERGENCY_BRAKE_ACTIVE
    await expect(
      handler.handleChatCompletions(
        new Request('http://api/v1/chat/completions', { method: 'POST' }),
        { messages: [{ role: 'user', content: 'hello' }] },
        authCtx,
        mockEnv
      )
    ).rejects.toThrow(/Emergency brake active/);
  });

  it('fails open when coordinator DO encounters an error', async () => {
    const mockEnv: WorkerEnv = {
      POOL_COORDINATOR: {
        idFromName: () => 'global',
        get: () => ({
          fetch: () => Promise.reject(new Error('Network error or DO cold start')),
        }),
      } as any,
    };

    const mockRouter = {
      route: vi.fn().mockResolvedValue({
        model: 'gemini-1.5-flash',
        provider: 'gemini',
        costMicrodollars: 100n,
        content: 'Response text',
        usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
      }),
    };

    const dummyDeps: any = {
      options: {},
      modelRegistry: { calculateCost: () => 0n },
      timeProvider: () => Date.now(),
      getKeyPool: () => ({ recordUsage: vi.fn() }),
      getRouter: () => mockRouter,
      getCostLedgerRepo: () => undefined,
      getAuthTokensRepo: () => undefined,
      getTelemetryEmitter: () => ({ emit: vi.fn() }),
    };

    const handler = new ChatHandler(dummyDeps);
    const authCtx: AuthenticatedContext = {
      tenantId: 'tenant_normal',
      isAuthenticated: true,
      rpmLimit: 60,
      currentRpm: 1,
      remainingRpm: 59,
      budgetMicrodollars: 1000n,
      spentMicrodollars: 0n,
      token: { id: 'tok_2', hashSha256: 'h2', tenantId: 'tenant_normal', budgetMicrodollars: 1000n, spentMicrodollars: 0n, allowedProviders: [], rpmLimit: 60, expiresAt: null, createdAt: new Date().toISOString() },
    };

    const res = await handler.handleChatCompletions(
      new Request('http://api/v1/chat/completions', { method: 'POST' }),
      { messages: [{ role: 'user', content: 'hi' }] },
      authCtx,
      mockEnv
    );

    expect(res.status).toBe(200);
    expect(mockRouter.route).toHaveBeenCalled();
  });
});
