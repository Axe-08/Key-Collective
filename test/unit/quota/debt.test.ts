import { describe, it, expect, beforeEach } from "vitest";
import {
  nightlyReset,
  calculateMultiplierCeiling,
  determineJailStatus,
} from "../../../src/quota/tenant/debt";
import { TenantQuotaDO, type DurableObjectStateLike } from "../../../src/quota/tenant";
import type { DurableObjectStorageLike } from "../../../src/durable_objects/circuit_breaker";

class MockStorage implements DurableObjectStorageLike {
  private data = new Map<string, unknown>();
  public alarmTime: number | null = null;

  public async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  public async put<T = unknown>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }

  public async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  public async deleteAll(): Promise<void> {
    this.data.clear();
  }

  public async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const prefix = options?.prefix ?? "";
    for (const [k, v] of this.data.entries()) {
      if (k.startsWith(prefix)) {
        result.set(k, JSON.parse(JSON.stringify(v)) as T);
      }
    }
    return result;
  }

  public async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarmTime = typeof scheduledTime === "number" ? scheduledTime : scheduledTime.getTime();
  }

  public async getAlarm(): Promise<number | null> {
    return this.alarmTime;
  }
}

describe("Nightly Reset: decay, trust, streaks, catch-up (WP-5.4 T-5.4.2)", () => {
  let mockStorage: MockStorage;
  let mockState: DurableObjectStateLike;
  let currentTime: number;

  beforeEach(() => {
    mockStorage = new MockStorage();
    mockState = {
      id: { toString: () => "tenant-debt-test-id", name: "tenant-debt-test" },
      storage: mockStorage,
      waitUntil: () => {},
    };
    currentTime = Date.UTC(2026, 9, 1, 12, 0, 0); // 2026-10-01T12:00:00Z
  });

  it("decays trusted tenant by 30% and untrusted tenant by 20% using integer floor math", () => {
    const untrusted = nightlyReset({
      debtCu: 100n,
      contributed24h: 50n,
      trusted: false,
      streak: 4,
    });
    expect(untrusted.debtCu).toBe(80n);
    expect(untrusted.streak).toBe(0);
    expect(untrusted.trusted).toBe(false);

    // Non-round integer floor decay: 33 - floor(33 * 20 / 100) = 33 - 6 = 27
    const untrustedOdd = nightlyReset({
      debtCu: 33n,
      contributed24h: 0n,
      trusted: false,
      streak: 0,
    });
    expect(untrustedOdd.debtCu).toBe(27n);

    // Trusted tenant: rate (30%) decided BEFORE trust is cleared
    const trusted = nightlyReset({
      debtCu: 100n,
      contributed24h: 50n,
      trusted: true,
      streak: 10,
    });
    expect(trusted.debtCu).toBe(70n);
    expect(trusted.streak).toBe(0);
    expect(trusted.trusted).toBe(false);
  });

  it("grants trusted status and 500 ceiling after 7 consecutive debt-free resets (D-07)", () => {
    let state = {
      debtCu: 0n,
      contributed24h: 100n,
      trusted: false,
      streak: 0,
      multiplierCeiling: 450,
    };

    for (let day = 1; day <= 6; day++) {
      state = nightlyReset(state);
      expect(state.streak).toBe(day);
      expect(state.trusted).toBe(false);
      expect(state.multiplierCeiling).toBe(450);
    }

    state = nightlyReset(state);
    expect(state.streak).toBe(7);
    expect(state.trusted).toBe(true);
    expect(state.multiplierCeiling).toBe(500);
  });

  it("preserves contributed_24h across midnight so debt 60 with contributed_24h 100 is SOFT_WARNING, not jailed", async () => {
    const doInstance = new TenantQuotaDO(mockState, {}, {
      tenantId: "tenant-midnight-cliff",
      timeProvider: () => currentTime,
    });

    // At 23:00 UTC on Day 1: tenant contributes 100 CU and borrows 75 CU (which decays 20% to 60 CU at midnight)
    currentTime = Date.UTC(2026, 9, 1, 23, 0, 0);
    await doInstance.credit(100n);
    await doInstance.accrueDebt(75n);

    // Cross midnight to 00:05 UTC on Day 2 and run alarm
    currentTime = Date.UTC(2026, 9, 2, 0, 5, 0);
    await doInstance.alarm();

    const debtState = await doInstance.getDebtStateAsync();
    // 75n decayed by 20% = 60n; contributed_24h from 1h ago is still 100n
    expect(debtState.communityDebtCu).toBe("60");
    expect(debtState.contributedCu24h).toBe("100");
    expect(debtState.multiplierCeiling).toBe(150);
    expect(debtState.jailStatus).toBe("SOFT_WARNING");

    // Also verify pure helper directly with debt=60 after reset and contributed24h=100
    const ceil = calculateMultiplierCeiling(60n, 100n, false);
    expect(ceil).toBe(150);
    expect(determineJailStatus(60n, ceil)).toBe("SOFT_WARNING");
  });

  it("applies three decays when three daily alarms were missed (last_reset_day catch-up)", async () => {
    const doInstance = new TenantQuotaDO(mockState, {}, {
      tenantId: "tenant-catchup",
      timeProvider: () => currentTime,
    });

    // Day 1 (2026-10-01): accrue 1000 CU debt
    await doInstance.accrueDebt(1000n);
    expect(doInstance.getCommunityDebtCu()).toBe(1000n);

    // Advance 3 days to Day 4 (2026-10-04) without running intermediate alarms
    currentTime = Date.UTC(2026, 9, 4, 0, 5, 0);
    await doInstance.alarm();

    // 3 decays of 20%:
    // Day 2: 1000 - 200 = 800
    // Day 3: 800 - 160 = 640
    // Day 4: 640 - 128 = 512
    expect(doInstance.getCommunityDebtCu()).toBe(512n);
    expect(await mockStorage.get<string>("last_reset_day")).toBe("2026-10-04");

    // Running alarm again on the same day (2026-10-04) does not apply another decay
    currentTime = Date.UTC(2026, 9, 4, 12, 0, 0);
    await doInstance.alarm();
    expect(doInstance.getCommunityDebtCu()).toBe(512n);
  });

  it("accrueDebt resets streak immediately while leaving trusted flag until next nightly reset", async () => {
    const doInstance = new TenantQuotaDO(mockState, {}, {
      tenantId: "tenant-trust-decay",
      timeProvider: () => currentTime,
    });

    // Achieve 7 debt-free days to become trusted
    for (let d = 1; d <= 7; d++) {
      currentTime = Date.UTC(2026, 9, 1 + d, 0, 5, 0);
      await doInstance.alarm();
    }

    let state = await doInstance.getDebtStateAsync();
    expect(state.trustedContributor).toBe(true);
    expect(state.consecutiveDebtFreeDays).toBe(7);

    // Accrue 100 CU debt later on Day 8
    currentTime = Date.UTC(2026, 9, 8, 14, 0, 0);
    await doInstance.accrueDebt(100n);

    state = await doInstance.getDebtStateAsync();
    // Streak resets immediately, but trustedContributor remains true until next reset
    expect(state.consecutiveDebtFreeDays).toBe(0);
    expect(state.trustedContributor).toBe(true);

    // Next nightly reset on Day 9 decays by 30% (to 70) and then clears trustedContributor
    currentTime = Date.UTC(2026, 9, 9, 0, 5, 0);
    await doInstance.alarm();

    state = await doInstance.getDebtStateAsync();
    expect(state.communityDebtCu).toBe("70");
    expect(state.trustedContributor).toBe(false);
    expect(state.consecutiveDebtFreeDays).toBe(0);
  });
});
