/**
 * Key Collective v3 — Ephemeral Demo Tier Subsystem Unit Tests
 *
 * Tests the modularized `src/auth/demo/` subsystem components:
 * constants, types, storage, sandbox, and DemoDO class.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GLOBAL_RPM_LIMIT,
  DEFAULT_GLOBAL_RPD_LIMIT,
  DEFAULT_IP_RPD_LIMIT,
  DEFAULT_IP_RPM_LIMIT,
  DEFAULT_ROTATION_INTERVAL_MS,
  DEFAULT_STALE_PRUNE_MS,
  DemoDO,
  DemoDOStorageLike,
  DemoSandbox,
  DemoStorage,
  DurableObjectStateLike,
  generateDemoToken,
  STORAGE_KEY_EXPIRY,
  STORAGE_KEY_TOKEN,
  validateDemoToken,
} from "./index";

class MockStorage implements DemoDOStorageLike {
  public store = new Map<string, unknown>();
  public alarm: number | null = null;
  public setAlarmCalls: Array<number | Date> = [];

  async get<T = unknown>(key: string): Promise<T | undefined>;
  async get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  async get<T = unknown>(
    keyOrKeys: string | string[]
  ): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(keyOrKeys)) {
      const map = new Map<string, T>();
      for (const k of keyOrKeys) {
        if (this.store.has(k)) {
          map.set(k, this.store.get(k) as T);
        }
      }
      return map;
    }
    return this.store.get(keyOrKeys) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void>;
  async put<T>(entries: Record<string, T>): Promise<void>;
  async put<T>(
    keyOrEntries: string | Record<string, T>,
    value?: T
  ): Promise<void> {
    if (typeof keyOrEntries === "string") {
      this.store.set(keyOrEntries, value);
    } else {
      for (const [k, v] of Object.entries(keyOrEntries)) {
        this.store.set(k, v);
      }
    }
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.setAlarmCalls.push(scheduledTime);
    this.alarm =
      typeof scheduledTime === "number"
        ? scheduledTime
        : scheduledTime.getTime();
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

function createMockDOState(): {
  state: DurableObjectStateLike;
  storage: MockStorage;
} {
  const storage = new MockStorage();
  const state: DurableObjectStateLike = {
    id: {
      name: "global_demo_pool",
      toString: () => "demo-singleton-do",
    },
    storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: async <T>(cb: () => Promise<T>): Promise<T> => {
      return await cb();
    },
  };
  return { state, storage };
}

describe("Demo Subsystem (src/auth/demo)", () => {
  let mockState: DurableObjectStateLike;
  let mockStorage: MockStorage;
  let currentTime: number;

  beforeEach(() => {
    const mock = createMockDOState();
    mockState = mock.state;
    mockStorage = mock.storage;
    currentTime = 1_700_000_000_000;
  });

  describe("Constants & Configuration", () => {
    it("exports default rate limits and storage keys", () => {
      expect(DEFAULT_ROTATION_INTERVAL_MS).toBe(15 * 60 * 1000);
      expect(DEFAULT_IP_RPM_LIMIT).toBe(1);
      expect(DEFAULT_IP_RPD_LIMIT).toBe(5);
      expect(DEFAULT_GLOBAL_RPM_LIMIT).toBe(5);
      expect(DEFAULT_GLOBAL_RPD_LIMIT).toBe(20);
      expect(DEFAULT_STALE_PRUNE_MS).toBe(60 * 60 * 1000);
      expect(STORAGE_KEY_TOKEN).toBe("demo:token");
      expect(STORAGE_KEY_EXPIRY).toBe("demo:expiry");
    });
  });

  describe("DemoStorage Adapter", () => {
    it("persists, loads, and schedules alarm", async () => {
      const storageManager = new DemoStorage(mockStorage);
      await storageManager.persistTokenData("kc_demo_test", 12345678);

      const loaded = await storageManager.loadTokenData();
      expect(loaded.token).toBe("kc_demo_test");
      expect(loaded.expiresAt).toBe(12345678);

      await storageManager.scheduleAlarm(12345678);
      expect(mockStorage.alarm).toBe(12345678);
    });
  });

  describe("DemoSandbox Pure Functions", () => {
    it("generates valid CSPRNG token with timestamp and prefix", () => {
      const token = generateDemoToken(currentTime);
      expect(token).toMatch(/^kc_demo_\d+_[a-f0-9]{12}$/);
    });

    it("validates candidate token correctly", () => {
      const valid = generateDemoToken(currentTime);
      const expiresAt = currentTime + 900_000;

      expect(validateDemoToken(valid, valid, expiresAt, currentTime).valid).toBe(true);
      expect(validateDemoToken("invalid", valid, expiresAt, currentTime).valid).toBe(false);
      expect(validateDemoToken(valid, valid, currentTime - 10, currentTime).valid).toBe(false);
    });
  });

  describe("DemoSandbox Rate Limiter", () => {
    it("tracks sliding window per IP and globally", () => {
      const sandbox = new DemoSandbox({
        ipRpmLimit: 2,
        ipRpdLimit: 10,
        globalRpmLimit: 5,
      });

      const r1 = sandbox.recordRequest("1.2.3.4", currentTime);
      expect(r1.allowed).toBe(true);
      expect(r1.currentRpm).toBe(1);

      const r2 = sandbox.recordRequest("1.2.3.4", currentTime);
      expect(r2.allowed).toBe(true);
      expect(r2.currentRpm).toBe(2);

      const r3 = sandbox.recordRequest("1.2.3.4", currentTime);
      expect(r3.allowed).toBe(false);
      expect(r3.reason).toBe("ip_rpm_exceeded");
    });
  });

  describe("DemoDO Integration", () => {
    it("initializes and handles rotation and checkAndConsume via modular DemoDO", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider: () => currentTime });
      const { token, expiresAt } = await demoDO.getActiveDemoToken();

      expect(token).toMatch(/^kc_demo_/);
      expect(expiresAt).toBe(currentTime + DEFAULT_ROTATION_INTERVAL_MS);

      const res = await demoDO.checkAndConsume("10.0.0.1", token);
      expect(res.allowed).toBe(true);
      expect(res.status).toBe(200);
    });
  });
});
