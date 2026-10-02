import { describe, expect, it } from 'vitest';
import { TenantQuotaDO, type DurableObjectStateLike } from '../../../src/quota/tenant';
import type { DurableObjectStorageLike } from '../../../src/durable_objects/circuit_breaker';

class InMemoryStorage implements DurableObjectStorageLike {
  private readonly map = new Map<string, unknown>();
  public alarmTime: number | null = null;

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
  public async list<T = unknown>(): Promise<Map<string, T>> {
    return new Map();
  }
  public async setAlarm(time: number): Promise<void> {
    this.alarmTime = time;
  }
  public async getAlarm(): Promise<number | null> {
    return this.alarmTime;
  }
}

describe('WP-6.3 / T-6.3.1: TenantQuotaDO standing caps & recovery output', () => {
  it('returns caps and recovery structures from TenantQuotaDO.getDebtState()', async () => {
    const tenantId = `usr_standing_caps_test`;
    const storage = new InMemoryStorage();
    const state: DurableObjectStateLike = {
      id: {
        toString: () => tenantId,
        name: tenantId,
      },
      storage,
      waitUntil: () => {},
    };

    const quotaDo = new TenantQuotaDO(state, {}, { tenantId });
    const debtState = quotaDo.getDebtState();

    expect(debtState).toHaveProperty('caps');
    // @ts-expect-error verifying property presence
    expect(debtState.caps).toHaveProperty('vesting');
    // @ts-expect-error verifying property presence
    expect(debtState.caps).toHaveProperty('debt');
    // @ts-expect-error verifying property presence
    expect(debtState.caps).toHaveProperty('band');

    expect(debtState).toHaveProperty('recovery');
    // @ts-expect-error verifying property presence
    expect(debtState.recovery).toHaveProperty('debt_decay');
    // @ts-expect-error verifying property presence
    expect(debtState.recovery).toHaveProperty('estimated_days');
  });
});
