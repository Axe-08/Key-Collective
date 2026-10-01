import { describe, it, expect, beforeEach } from 'vitest';
import {
  TenantQuotaDO,
  DurableObject,
  DurableObjectStateLike,
  toMicrodollars,
  toCu,
  calculateMultiplierCeiling,
  determineJailStatus,
  nightlyReset,
} from '../../../src/quota/tenant/index';
import { DurableObjectStorageLike } from '../../../src/durable_objects/circuit_breaker';
import { TenantIsolationError } from '../../../src/errors/auth_errors';

/**
 * In-memory mock of DurableObjectStorage.
 */
class MockDurableObjectStorage implements DurableObjectStorageLike {
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
    const result = new Map<string, T>();
    const prefix = options?.prefix ?? '';
    for (const [k, v] of this.map.entries()) {
      if (k.startsWith(prefix)) {
        result.set(k, JSON.parse(JSON.stringify(v)) as T);
      }
    }
    return result;
  }
}

function createMockState(tenantId: string): {
  state: DurableObjectStateLike;
  storage: MockDurableObjectStorage;
} {
  const storage = new MockDurableObjectStorage();
  const state: DurableObjectStateLike = {
    id: {
      toString: () => tenantId,
      name: tenantId,
    },
    storage,
    waitUntil: () => {},
  };
  return { state, storage };
}

describe('src/quota/tenant_do.ts', () => {
  let mockStorage: MockDurableObjectStorage;
  let mockState: DurableObjectStateLike;
  let currentTime: number;
  const testTenant = 'usr_tenant_alpha';

  beforeEach(() => {
    currentTime = 1_000_000_000;
    const mock = createMockState(testTenant);
    mockState = mock.state;
    mockStorage = mock.storage;
  });

  describe('Inheritance and Tenant Isolation', () => {
    it('extends DurableObject base class', () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });
      expect(doInstance).toBeInstanceOf(DurableObject);
      expect(doInstance.tenantId).toBe(testTenant);
    });

    it('throws TenantIsolationError when initialized with empty tenantId', () => {
      const emptyState: DurableObjectStateLike = {
        id: { toString: () => '', name: '' },
        storage: mockStorage,
      };
      expect(() => new TenantQuotaDO(emptyState, {})).toThrow(TenantIsolationError);
    });

    it('enforces assertTenant against mismatched tenant IDs', () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });
      expect(() => doInstance.assertTenant('usr_other_tenant')).toThrow(TenantIsolationError);
      expect(() => doInstance.assertTenant(testTenant)).not.toThrow();
    });
  });

  describe('Microdollar Cost Tracking (Fixed-Point Math)', () => {
    it('accurately parses microdollars from bigint, number, and string', () => {
      expect(toMicrodollars(1000n)).toBe(1000n);
      expect(toMicrodollars(500)).toBe(500n);
      expect(toMicrodollars(12.9)).toBe(12n);
      expect(toMicrodollars('2500000')).toBe(2500000n);
      expect(toMicrodollars('invalid')).toBe(0n);
      expect(toMicrodollars(null)).toBe(0n);
    });

    it('accumulates exact int64 microdollars without floating-point errors', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      await doInstance.consumeQuota({ costMicrodollars: 100_000n });
      await doInstance.consumeQuota({ costMicrodollars: '250000' });
      await doInstance.consumeQuota({ costMicrodollars: 50_000 });

      expect(doInstance.getTotalCostMicrodollars()).toBe(400_000n);
    });
  });

  describe('Quota Consumption & Golden Test Scenarios', () => {
    it('tc-v3-03: Multi-project shared quota enforcement (20 RPM ceiling for Builder)', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        initialTier: 'builder',
        timeProvider: () => currentTime,
      });

      // Project A sends 12 requests
      for (let i = 0; i < 12; i++) {
        const res = await doInstance.consumeQuota({
          projectId: 'project_a',
          tier: 'builder',
        });
        expect(res.allowed).toBe(true);
      }

      // Project B sends 8 requests
      for (let i = 0; i < 8; i++) {
        const res = await doInstance.consumeQuota({
          projectId: 'project_b',
          tier: 'builder',
        });
        expect(res.allowed).toBe(true);
      }

      expect(doInstance.getRpm()).toBe(20);

      // Combined 21st request across projects receives 429 USER_QUOTA_EXHAUSTED
      const breachRes = await doInstance.consumeQuota({
        projectId: 'project_a',
        tier: 'builder',
      });

      expect(breachRes.allowed).toBe(false);
      expect(breachRes.errorCode).toBe('USER_QUOTA_EXHAUSTED');
      expect(breachRes.error_code).toBe('USER_QUOTA_EXHAUSTED');
      expect(breachRes.retryAfterSeconds).toBe(60);
      expect(breachRes.currentRpm).toBe(20);
      expect(breachRes.rpmLimit).toBe(20);
    });

    it('tc-v3-04: Project-level sub-cap enforcement (5 RPM sub-cap on Project A)', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        initialTier: 'builder',
        timeProvider: () => currentTime,
      });

      // Project A configured with 5 RPM sub-cap sends 5 requests
      for (let i = 0; i < 5; i++) {
        const res = await doInstance.consumeQuota({
          projectId: 'project_a',
          projectMaxSubCap: 5,
          tier: 'builder',
        });
        expect(res.allowed).toBe(true);
      }

      expect(doInstance.getRpm('project_a')).toBe(5);
      expect(doInstance.getRpm()).toBe(5); // Root has 15 RPM remaining

      // 6th request to Project A returns 429 PROJECT_SUB_CAP_EXCEEDED
      const breachRes = await doInstance.consumeQuota({
        projectId: 'project_a',
        projectMaxSubCap: 5,
        tier: 'builder',
      });

      expect(breachRes.allowed).toBe(false);
      expect(breachRes.errorCode).toBe('PROJECT_SUB_CAP_EXCEEDED');
      expect(breachRes.error_code).toBe('PROJECT_SUB_CAP_EXCEEDED');
      expect(breachRes.retryAfterSeconds).toBe(60);
      expect(breachRes.currentProjectRpm).toBe(5);
      expect(breachRes.projectRpmLimit).toBe(5);
    });

    it('enforces daily RPD limit breach (e.g. Probationary 50 RPD)', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        initialTier: 'probationary',
        timeProvider: () => currentTime,
      });

      // Consume 50 requests
      for (let i = 0; i < 50; i++) {
        // Advance time 31s between requests to stay under 2 RPM
        currentTime += 31_000;
        const res = await doInstance.consumeQuota({ tier: 'probationary' });
        expect(res.allowed).toBe(true);
      }

      // 51st request exceeds 50 RPD
      currentTime += 31_000;
      const breachRes = await doInstance.consumeQuota({ tier: 'probationary' });
      expect(breachRes.allowed).toBe(false);
      expect(breachRes.errorCode).toBe('USER_DAILY_QUOTA_EXHAUSTED');
    });

    it('immediately rejects suspended tier accounts with 0 RPM limit', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        initialTier: 'suspended',
        timeProvider: () => currentTime,
      });

      const res = await doInstance.consumeQuota();
      expect(res.allowed).toBe(false);
      expect(res.errorCode).toBe('USER_QUOTA_EXHAUSTED');
      expect(res.rpmLimit).toBe(0);
    });

    it('allows unlimited requests for admin tier', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        initialTier: 'admin',
        timeProvider: () => currentTime,
      });

      for (let i = 0; i < 100; i++) {
        const res = await doInstance.consumeQuota();
        expect(res.allowed).toBe(true);
      }
      expect(doInstance.getRpm()).toBe(100);
    });
  });

  describe('DO Transactional Storage Persistence & Eviction Survival', () => {
    it('persists quota entries to DO storage and survives memory eviction', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        initialTier: 'builder',
        timeProvider: () => currentTime,
      });

      // Make 10 requests with costs
      for (let i = 0; i < 10; i++) {
        await doInstance.consumeQuota({
          projectId: 'proj_persist',
          costMicrodollars: 10_000n,
        });
      }

      expect(doInstance.getRpm()).toBe(10);
      expect(doInstance.getTotalCostMicrodollars()).toBe(100_000n);

      // Verify stored in storage
      const stored = await mockStorage.get<any>('quota:data');
      expect(stored).toBeDefined();
      expect(stored.entries.length).toBe(10);
      expect(stored.totalCostMicrodollars).toBe('100000');

      // Simulate DO eviction
      doInstance.clearMemoryCache();
      expect(doInstance.getRpm()).toBe(0);
      expect(doInstance.getTotalCostMicrodollars()).toBe(0n);

      // Next request re-hydrates from storage
      const nextRes = await doInstance.consumeQuota({
        projectId: 'proj_persist',
        costMicrodollars: 5_000n,
      });

      expect(nextRes.allowed).toBe(true);
      expect(doInstance.getRpm()).toBe(11);
      expect(doInstance.getTotalCostMicrodollars()).toBe(105_000n);
    });

    it('resets counters and persists empty state to storage', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      await doInstance.consumeQuota({ costMicrodollars: 50_000n });
      expect(doInstance.getRpm()).toBe(1);

      await doInstance.reset();
      expect(doInstance.getRpm()).toBe(0);
      expect(doInstance.getTotalCostMicrodollars()).toBe(0n);

      const stored = await mockStorage.get<any>('quota:data');
      expect(stored.entries.length).toBe(0);
      expect(stored.totalCostMicrodollars).toBe('0');
    });
  });

  describe('HTTP fetch() Interface', () => {
    it('handles POST /consume returning HTTP 200 when allowed', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      const req = new Request('https://do.internal/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj_fetch',
          count: 2,
          costMicrodollars: '10000',
        }),
      });

      const res = await doInstance.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json() as any;
      expect(data.allowed).toBe(true);
      expect(data.currentRpm).toBe(2);
      expect(data.totalCostMicrodollars).toBe('10000');
    });

    it('handles POST /consume returning HTTP 429 when quota exceeded', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        initialTier: 'builder',
        timeProvider: () => currentTime,
      });

      // Fill the 20 RPM builder quota
      for (let i = 0; i < 20; i++) {
        await doInstance.consumeQuota();
      }

      const req = new Request('https://do.internal/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj_breach' }),
      });

      const res = await doInstance.fetch(req);
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('60');

      const data = await res.json() as any;
      expect(data.allowed).toBe(false);
      expect(data.errorCode).toBe('USER_QUOTA_EXHAUSTED');
    });

    it('returns HTTP 403 on tenant isolation violation in x-tenant-id header', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      const req = new Request('https://do.internal/consume', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': 'usr_mismatched_tenant',
        },
        body: JSON.stringify({}),
      });

      const res = await doInstance.fetch(req);
      expect(res.status).toBe(403);
      const data = await res.json() as any;
      expect(data.code).toBe('TENANT_ISOLATION_VIOLATION');
    });

    it('handles GET /quota to inspect current usage', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        initialTier: 'builder',
        timeProvider: () => currentTime,
      });

      await doInstance.consumeQuota({ count: 3 });

      const req = new Request('https://do.internal/quota', { method: 'GET' });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json() as any;
      expect(data.tenantId).toBe(testTenant);
      expect(data.currentRpm).toBe(3);
      expect(data.rpmLimit).toBe(20);
      expect(data.remainingRpm).toBe(17);
    });

    it('handles POST /tier to update tier dynamically', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        initialTier: 'builder',
        timeProvider: () => currentTime,
      });

      const req = new Request('https://do.internal/tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'max' }),
      });

      const res = await doInstance.fetch(req);
      expect(res.status).toBe(200);
      expect(doInstance.getTier()).toBe('max');
    });

    it('handles POST /reset to clear counters', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      await doInstance.consumeQuota({ count: 5 });
      expect(doInstance.getRpm()).toBe(5);

      const req = new Request('https://do.internal/reset', { method: 'POST' });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(200);
      expect(doInstance.getRpm()).toBe(0);
    });

    it('handles GET /health', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      const req = new Request('https://do.internal/health', { method: 'GET' });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.status).toBe('healthy');
      expect(data.do).toBe(true);
    });
  });

  describe('Credit Units (CU) and 24h Usage Tracking (Zero Float Math)', () => {
    it('accurately parses CU from bigint, number, and string using toCu', () => {
      expect(toCu(5000n)).toBe(5000n);
      expect(toCu(120)).toBe(120n);
      expect(toCu('45000')).toBe(45000n);
      expect(toCu('   ')).toBe(0n);
      expect(toCu('bad')).toBe(0n);
    });

    it('accumulates cuUsed24h as pure bigint without floats', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      await doInstance.consumeQuota({ cu: 100n });
      await doInstance.consumeQuota({ cu: 250n });
      await doInstance.consumeQuota({ costMicrodollars: 50n });

      expect(doInstance.getCuUsed24h()).toBe(400n);
    });

    it('returns cuUsed24h in ConsumeQuotaResult', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      const res = await doInstance.consumeQuota({ cu: 500n });
      expect(res.allowed).toBe(true);
      expect(res.cuUsed24h).toBe('500');
    });

    it('persists cuUsed24h across eviction and reloads from storage', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      await doInstance.consumeQuota({ cu: 750n });
      expect(doInstance.getCuUsed24h()).toBe(750n);

      doInstance.clearMemoryCache();
      expect(doInstance.getCuUsed24h()).toBe(0n);

      await doInstance.consumeQuota({ cu: 250n });
      expect(doInstance.getCuUsed24h()).toBe(1000n);
    });

    it('resets cuUsed24h on reset()', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      await doInstance.consumeQuota({ cu: 800n });
      expect(doInstance.getCuUsed24h()).toBe(800n);

      await doInstance.reset();
      expect(doInstance.getCuUsed24h()).toBe(0n);
    });
  });

  describe('Communal Debt Tracking, Scaled Integer Ratios & Integer Decay', () => {
    it('credit first reduces debt then adds remainder to contribution (T-5.3.2)', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      await doInstance.accrueDebt(1000n);
      expect(doInstance.getCommunityDebtCu()).toBe(1000n);

      // First 400n credit reduces debt from 1000n to 600n, 0n remainder to contribution
      await doInstance.credit(400n);
      expect(doInstance.getCommunityDebtCu()).toBe(600n);
      expect(doInstance.getDebtState().dailyContributedCu).toBe('0');
      expect(doInstance.getDebtState().contributedCu24h).toBe('0');

      // Next 750n credit clears remaining 600n debt and adds 150n remainder to contribution
      await doInstance.credit(750n);
      expect(doInstance.getCommunityDebtCu()).toBe(0n);

      const state = doInstance.getDebtState();
      expect(state.communityDebtCu).toBe('0');
      expect(state.dailyContributedCu).toBe('150');
      expect(state.contributedCu24h).toBe('150');

      const buckets = await mockStorage.get<number[]>('contributed_buckets');
      expect(Array.isArray(buckets)).toBe(true);
      expect(buckets?.length).toBe(24);
      expect(buckets?.reduce((a, b) => a + b, 0)).toBe(150);
    });

    it('AC-02: 100 borrowed requests (1 CU each) -> borrower debt 100, lender contribution 100; then borrower serves 100 requests -> borrower debt 0', async () => {
      const borrowerMock = createMockState('usr_borrower');
      const lenderMock = createMockState('usr_lender');

      const borrowerDo = new TenantQuotaDO(borrowerMock.state, {}, {
        timeProvider: () => currentTime,
      });
      const lenderDo = new TenantQuotaDO(lenderMock.state, {}, {
        timeProvider: () => currentTime,
      });

      for (let i = 0; i < 100; i++) {
        await borrowerDo.accrueDebt(1n, `lease_b_${i}`);
        await lenderDo.credit(1n, `lease_b_${i}`);
      }

      expect(borrowerDo.getCommunityDebtCu()).toBe(100n);
      expect(lenderDo.getDebtState().contributedCu24h).toBe('100');

      // Now borrower's own community key serves 100 requests (1 CU each) for others
      for (let i = 0; i < 100; i++) {
        await borrowerDo.credit(1n, `lease_serve_${i}`);
      }

      expect(borrowerDo.getCommunityDebtCu()).toBe(0n);
      expect(borrowerDo.getDebtState().contributedCu24h).toBe('0');
    });

    it('evicts contribution from 25h ago from the 24h sliding window while retaining recent hours (D-12)', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      // Hour 0: credit 100 CU
      await doInstance.credit(100n);
      expect(doInstance.getDebtState().contributedCu24h).toBe('100');

      // Advance 10 hours: credit 50 CU
      currentTime += 10 * 3_600_000;
      await doInstance.credit(50n);
      expect(doInstance.getDebtState().contributedCu24h).toBe('150');

      // Advance 15 more hours (total 25h since first credit, 15h since second credit)
      currentTime += 15 * 3_600_000;
      const stateAfter25h = await doInstance.standing();
      // First 100 CU (25h ago) is evicted; second 50 CU (15h ago) remains!
      expect(stateAfter25h.contributedCu24h).toBe('50');
    });

    it('calculates multiplier ceiling using scaled integer ratios without floating point math', () => {
      // 0 contribution, >0 debt -> 1000n ratio -> 100 ceiling (HARD_JAIL)
      expect(calculateMultiplierCeiling(100n, 0n, false)).toBe(100);
      expect(determineJailStatus(100n, 100)).toBe('HARD_JAIL');

      // Ratio > 100n: 200n debt with 150n contributed (200*100/150 = 133n) -> 100 ceiling
      expect(calculateMultiplierCeiling(200n, 150n, false)).toBe(100);

      // Ratio 51..100: 75n debt with 100n contributed (75n ratio) -> 150 ceiling (SOFT_WARNING)
      expect(calculateMultiplierCeiling(75n, 100n, false)).toBe(150);
      expect(determineJailStatus(75n, 150)).toBe('SOFT_WARNING');

      // Ratio <= 50: 40n debt with 100n contributed (40n ratio) -> 450 (or 500 for trusted) (PRISTINE)
      expect(calculateMultiplierCeiling(40n, 100n, false)).toBe(450);
      expect(calculateMultiplierCeiling(40n, 100n, true)).toBe(500);
      expect(determineJailStatus(0n, 450)).toBe('PRISTINE');
    });

    it('processes nightly debt reset with integer decay and 7-day trust', () => {
      // Non-trusted contributor: 20% integer decay (debt - debt*20/100)
      const state1 = {
        communityDebtCu: 100n,
        dailyContributedCu: 50n,
        trustedContributor: false,
        consecutiveDebtFreeDays: 5,
        multiplierCeiling: 100,
      };
      const res1 = nightlyReset(state1);
      expect(res1.communityDebtCu).toBe(80n);
      expect(res1.consecutiveDebtFreeDays).toBe(0);
      // Sliding-window contribution is not reset by nightlyReset
      expect(res1.dailyContributedCu).toBe(50n);

      // Integer truncation with non-round number: 33n * 20 / 100 = 660 / 100 = 6n; 33n - 6n = 27n
      const state2 = {
        communityDebtCu: 33n,
        dailyContributedCu: 0n,
        trustedContributor: false,
        consecutiveDebtFreeDays: 0,
        multiplierCeiling: 100,
      };
      const res2 = nightlyReset(state2);
      expect(res2.communityDebtCu).toBe(27n);

      // Trusted contributor: 30% integer decay (debt - debt*30/100)
      const state3 = {
        communityDebtCu: 100n,
        dailyContributedCu: 0n,
        trustedContributor: true,
        consecutiveDebtFreeDays: 10,
        multiplierCeiling: 100,
      };
      const res3 = nightlyReset(state3);
      expect(res3.communityDebtCu).toBe(70n);
      expect(res3.trustedContributor).toBe(false); // resets after debt
      expect(res3.consecutiveDebtFreeDays).toBe(0);

      // Debt free day increment -> 7 days grants trusted status
      const state4 = {
        communityDebtCu: 0n,
        dailyContributedCu: 100n,
        trustedContributor: false,
        consecutiveDebtFreeDays: 6,
        multiplierCeiling: 450,
      };
      const res4 = nightlyReset(state4);
      expect(res4.communityDebtCu).toBe(0n);
      expect(res4.consecutiveDebtFreeDays).toBe(7);
      expect(res4.trustedContributor).toBe(true); // >= 7 consecutive days
    });

    it('invokes alarm across midnight to run nightly debt reset and update state', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      await doInstance.accrueDebt(100n);
      expect(doInstance.getCommunityDebtCu()).toBe(100n);

      currentTime += 86_400_000;
      await doInstance.alarm();
      // 100n decays by 20% -> 80n
      expect(doInstance.getCommunityDebtCu()).toBe(80n);
    });

    it('returns cuUsed24h and communityDebtCu in GET /quota response', async () => {
      const doInstance = new TenantQuotaDO(mockState, {}, {
        timeProvider: () => currentTime,
      });

      await doInstance.consumeQuota({ cu: 1234n });
      await doInstance.accrueDebt(500n);

      const req = new Request('https://do.internal/quota', { method: 'GET' });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(200);

      const data = await res.json() as any;
      expect(data.cuUsed24h).toBe('1234');
      expect(data.communityDebtCu).toBe('500');
    });
  });
});

