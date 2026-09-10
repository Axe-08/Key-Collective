/**
 * Key Collective v3 — Ephemeral Demo Tier State Machine & DO Alarm Engine
 * Unit Tests for DemoDO (Autonomous Singleton Demo Durable Object)
 *
 * Conforms to:
 * - docs/system_design_v3.md (Section 3: Ephemeral Demo Tier State Machine & DO Alarm Engine)
 * - docs/adr/003-multi-project-tiered-architecture.md (Section 3: Global Demo Pool)
 * - docs/architecture/lld_pod-auth-sybil.md (Section 4.3: Demo Durable Object)
 * - micro_tasks_pod-auth-sybil.json (Task auth-sybil-03)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GLOBAL_RPM_LIMIT,
  DEFAULT_IP_RPD_LIMIT,
  DEFAULT_IP_RPM_LIMIT,
  DEFAULT_ROTATION_INTERVAL_MS,
  DemoDO,
  DemoDOStorageLike,
  DurableObjectStateLike,
  STORAGE_KEY_EXPIRY,
  STORAGE_KEY_TOKEN,
} from "../../src/auth/demo_do";

/**
 * Mock implementation of Cloudflare DurableObjectStorage supporting Alarms.
 */
class MockDemoDOStorage implements DemoDOStorageLike {
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

  async delete(key: string): Promise<boolean>;
  async delete(keys: string[]): Promise<number>;
  async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    if (Array.isArray(keyOrKeys)) {
      let count = 0;
      for (const k of keyOrKeys) {
        if (this.store.delete(k)) count++;
      }
      return count;
    }
    return this.store.delete(keyOrKeys);
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

/**
 * Factory for mock DurableObjectStateLike.
 */
function createMockDOState(
  name = "global_demo_pool",
  idHex = "demo-singleton-do"
): {
  state: DurableObjectStateLike;
  storage: MockDemoDOStorage;
} {
  const storage = new MockDemoDOStorage();
  const state: DurableObjectStateLike = {
    id: {
      name,
      toString: () => idHex,
    },
    storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: async <T>(cb: () => Promise<T>): Promise<T> => {
      return await cb();
    },
  };
  return { state, storage };
}

describe("DemoDO — Ephemeral Demo Tier Durable Object", () => {
  let mockState: DurableObjectStateLike;
  let mockStorage: MockDemoDOStorage;
  let currentTime: number;
  let timeProvider: () => number;

  beforeEach(() => {
    const mock = createMockDOState();
    mockState = mock.state;
    mockStorage = mock.storage;
    currentTime = 1_700_000_000_000; // Fixed epoch reference
    timeProvider = () => currentTime;
  });

  describe("Initialization & Token Lifecycle", () => {
    it("generates a fresh token with 'kc_demo_' prefix on initial creation", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const active = await demoDO.getActiveDemoToken();

      expect(active.token).toMatch(/^kc_demo_\d+_[a-f0-9]{12}$/);
      expect(active.expiresAt).toBe(currentTime + DEFAULT_ROTATION_INTERVAL_MS);
      expect(demoDO.getCurrentToken()).toBe(active.token);
      expect(demoDO.getTokenExpiresAt()).toBe(active.expiresAt);
    });

    it("persists generated token and expiry to transactional DO storage", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const active = await demoDO.getActiveDemoToken();

      expect(mockStorage.store.get(STORAGE_KEY_TOKEN)).toBe(active.token);
      expect(mockStorage.store.get(STORAGE_KEY_EXPIRY)).toBe(active.expiresAt);
    });

    it("schedules a DO alarm matching the 15-minute expiration timestamp", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const active = await demoDO.getActiveDemoToken();

      expect(mockStorage.alarm).toBe(active.expiresAt);
      expect(mockStorage.setAlarmCalls).toContain(active.expiresAt);
    });

    it("restores valid token and expiry from storage upon new DO initialization", async () => {
      const savedToken = "kc_demo_1700000000_aabbccddeeff";
      const savedExpiry = currentTime + 600_000; // 10 minutes remaining
      mockStorage.store.set(STORAGE_KEY_TOKEN, savedToken);
      mockStorage.store.set(STORAGE_KEY_EXPIRY, savedExpiry);

      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const active = await demoDO.getActiveDemoToken();

      expect(active.token).toBe(savedToken);
      expect(active.expiresAt).toBe(savedExpiry);
      expect(mockStorage.alarm).toBe(savedExpiry);
    });

    it("rotates token on initialization if stored token has already expired", async () => {
      const expiredToken = "kc_demo_1699990000_112233445566";
      const expiredTime = currentTime - 1000; // Expired 1 second ago
      mockStorage.store.set(STORAGE_KEY_TOKEN, expiredToken);
      mockStorage.store.set(STORAGE_KEY_EXPIRY, expiredTime);

      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const active = await demoDO.getActiveDemoToken();

      expect(active.token).not.toBe(expiredToken);
      expect(active.token).toMatch(/^kc_demo_\d+_[a-f0-9]{12}$/);
      expect(active.expiresAt).toBe(currentTime + DEFAULT_ROTATION_INTERVAL_MS);
    });

    it("works when blockConcurrencyWhile is not provided on ctx", async () => {
      const stateWithoutBCW: DurableObjectStateLike = {
        id: mockState.id,
        storage: mockStorage,
        waitUntil: vi.fn(),
      };
      const demoDO = new DemoDO(stateWithoutBCW, {}, { timeProvider });
      const active = await demoDO.getActiveDemoToken();

      expect(active.token).toMatch(/^kc_demo_/);
      expect(active.expiresAt).toBe(currentTime + DEFAULT_ROTATION_INTERVAL_MS);
    });
  });

  describe("15-Minute Alarm & Token Rotation", () => {
    it("rotates token and updates DO storage when alarm() fires", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const firstToken = (await demoDO.getActiveDemoToken()).token;

      // Fast-forward 15 minutes
      currentTime += DEFAULT_ROTATION_INTERVAL_MS;
      await demoDO.alarm();

      const rotated = await demoDO.getActiveDemoToken();
      expect(rotated.token).not.toBe(firstToken);
      expect(rotated.token).toMatch(/^kc_demo_\d+_[a-f0-9]{12}$/);
      expect(rotated.expiresAt).toBe(currentTime + DEFAULT_ROTATION_INTERVAL_MS);
      expect(mockStorage.store.get(STORAGE_KEY_TOKEN)).toBe(rotated.token);
      expect(mockStorage.store.get(STORAGE_KEY_EXPIRY)).toBe(rotated.expiresAt);
      expect(mockStorage.alarm).toBe(rotated.expiresAt);
    });

    it("invalidates previous token after rotation", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const firstToken = (await demoDO.getActiveDemoToken()).token;

      expect((await demoDO.validateToken(firstToken)).valid).toBe(true);

      currentTime += DEFAULT_ROTATION_INTERVAL_MS;
      await demoDO.alarm();

      const validation = await demoDO.validateToken(firstToken);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("invalid or has rotated");
    });
  });

  describe("Per-IP Sliding Window Rate Limiting", () => {
    it("allows requests up to the 3 RPM limit per IP", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const ip = "203.0.113.10";

      const r1 = await demoDO.recordRequest(ip);
      expect(r1.allowed).toBe(true);
      expect(r1.currentRpm).toBe(1);

      const r2 = await demoDO.recordRequest(ip);
      expect(r2.allowed).toBe(true);
      expect(r2.currentRpm).toBe(2);

      const r3 = await demoDO.recordRequest(ip);
      expect(r3.allowed).toBe(true);
      expect(r3.currentRpm).toBe(3);
    });

    it("rejects 4th request within 1 minute with 429 and retryAfterSeconds", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const ip = "203.0.113.10";

      await demoDO.recordRequest(ip);
      await demoDO.recordRequest(ip);
      await demoDO.recordRequest(ip);

      const r4 = await demoDO.recordRequest(ip);
      expect(r4.allowed).toBe(false);
      expect(r4.reason).toBe("ip_rpm_exceeded");
      expect(r4.currentRpm).toBe(3);
      expect(r4.retryAfterSeconds).toBeGreaterThan(0);
      expect(r4.retryAfterSeconds).toBeLessThanOrEqual(60);
    });

    it("allows new requests after 60-second sliding window rolls off", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const ip = "203.0.113.10";

      await demoDO.recordRequest(ip);
      await demoDO.recordRequest(ip);
      await demoDO.recordRequest(ip);

      expect((await demoDO.checkRateLimit(ip)).allowed).toBe(false);

      // Advance time by 61 seconds
      currentTime += 61_000;

      const checkAfter = await demoDO.checkRateLimit(ip);
      expect(checkAfter.allowed).toBe(true);
      expect(checkAfter.currentRpm).toBe(0);

      const r5 = await demoDO.recordRequest(ip);
      expect(r5.allowed).toBe(true);
      expect(r5.currentRpm).toBe(1);
    });

    it("enforces 25 RPD limit per IP over a 24-hour period", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const ip = "198.51.100.42";

      // Send 25 requests spread across intervals > 1 minute
      for (let i = 0; i < 25; i++) {
        currentTime += 65_000; // 65 seconds between requests -> 0 RPM block
        const res = await demoDO.recordRequest(ip);
        expect(res.allowed).toBe(true);
        expect(res.currentRpd).toBe(i + 1);
      }

      // 26th request should fail with ip_rpd_exceeded
      currentTime += 65_000;
      const r26 = await demoDO.recordRequest(ip);
      expect(r26.allowed).toBe(false);
      expect(r26.reason).toBe("ip_rpd_exceeded");
      expect(r26.currentRpd).toBe(25);
    });

    it("isolates sliding windows across different client IPs", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const ipA = "1.1.1.1";
      const ipB = "2.2.2.2";

      // Exhaust IP A quota (3 RPM)
      await demoDO.recordRequest(ipA);
      await demoDO.recordRequest(ipA);
      await demoDO.recordRequest(ipA);
      expect((await demoDO.recordRequest(ipA)).allowed).toBe(false);

      // IP B remains unaffected
      const rB1 = await demoDO.recordRequest(ipB);
      expect(rB1.allowed).toBe(true);
      expect(rB1.currentRpm).toBe(1);
    });
  });

  describe("Global Demo Pool Ceiling Rate Limiting", () => {
    it("enforces 20 RPM shared pool limit across different IPs", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });

      // 10 different IPs send 2 requests each = 20 global requests
      for (let i = 0; i < 10; i++) {
        const ip = `10.0.0.${i}`;
        const r1 = await demoDO.recordRequest(ip);
        const r2 = await demoDO.recordRequest(ip);
        expect(r1.allowed).toBe(true);
        expect(r2.allowed).toBe(true);
      }

      // 21st request from fresh IP should hit global ceiling
      const freshIp = "10.0.0.99";
      const blocked = await demoDO.recordRequest(freshIp);
      expect(blocked.allowed).toBe(false);
      expect(blocked.reason).toBe("global_rpm_exceeded");
      expect(blocked.globalRpm).toBe(20);
      expect(blocked.globalRpmLimit).toBe(DEFAULT_GLOBAL_RPM_LIMIT);
    });

    it("clears global pool limit after 60 seconds", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });

      for (let i = 0; i < 20; i++) {
        const ip = `10.0.1.${i}`;
        await demoDO.recordRequest(ip);
      }

      expect((await demoDO.checkRateLimit("10.0.1.99")).allowed).toBe(false);

      currentTime += 61_000;

      const allowed = await demoDO.checkRateLimit("10.0.1.99");
      expect(allowed.allowed).toBe(true);
      expect(allowed.globalRpm).toBe(0);
    });
  });

  describe("Pruning Inactive IP Sliding Windows", () => {
    it("prunes IP records inactive for > 1 hour during alarm rotation", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const staleIp = "192.168.1.100";
      const activeIp = "192.168.1.200";

      // Record request for stale IP at t=0
      await demoDO.recordRequest(staleIp);

      // Advance time by 65 minutes (> 1 hour threshold)
      currentTime += 65 * 60 * 1000;

      // Active IP makes a request at t=65m
      await demoDO.recordRequest(activeIp);

      expect(demoDO.getIpWindow(staleIp)).toBeDefined();
      expect(demoDO.getIpWindow(activeIp)).toBeDefined();

      // Trigger alarm rotation
      await demoDO.alarm();

      // staleIp should be purged, activeIp should remain
      expect(demoDO.getIpWindow(staleIp)).toBeUndefined();
      expect(demoDO.getIpWindow(activeIp)).toBeDefined();
    });

    it("preserves IP records with activity within the last 1 hour", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const ip = "172.16.0.1";

      await demoDO.recordRequest(ip);

      // Advance by 15 minutes (1 rotation cycle)
      currentTime += 15 * 60 * 1000;
      await demoDO.alarm();

      expect(demoDO.getIpWindow(ip)).toBeDefined();
    });
  });

  describe("Token Validation API", () => {
    it("validates the active demo token correctly", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const { token } = await demoDO.getActiveDemoToken();

      const validation = await demoDO.validateToken(token);
      expect(validation.valid).toBe(true);
      expect(validation.reason).toBeUndefined();
    });

    it("rejects empty or non-string tokens", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });

      expect((await demoDO.validateToken("")).valid).toBe(false);
      // @ts-expect-error Testing runtime non-string input
      expect((await demoDO.validateToken(null)).valid).toBe(false);
    });

    it("rejects tokens without 'kc_demo_' prefix", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const validation = await demoDO.validateToken("bearer_token_123");

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("expected kc_demo_");
    });

    it("rejects tokens past expiration", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const { token } = await demoDO.getActiveDemoToken();

      currentTime += DEFAULT_ROTATION_INTERVAL_MS + 1000;

      const validation = await demoDO.validateToken(token);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("expired");
    });
  });

  describe("Atomic checkAndConsume API", () => {
    it("allows valid token and records IP request atomically", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const { token } = await demoDO.getActiveDemoToken();
      const ip = "10.10.10.10";

      const res = await demoDO.checkAndConsume(ip, token);
      expect(res.allowed).toBe(true);
      expect(res.status).toBe(200);
      expect(res.rateLimit?.currentRpm).toBe(1);
    });

    it("returns 401 when token is invalid and does NOT consume IP quota", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const ip = "10.10.10.10";

      const res = await demoDO.checkAndConsume(ip, "kc_demo_invalid_token");
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(401);
      expect(demoDO.getIpWindow(ip)).toBeUndefined();
    });

    it("returns 429 when IP rate limit is exceeded", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const { token } = await demoDO.getActiveDemoToken();
      const ip = "10.10.10.10";

      await demoDO.checkAndConsume(ip, token);
      await demoDO.checkAndConsume(ip, token);
      await demoDO.checkAndConsume(ip, token);

      const r4 = await demoDO.checkAndConsume(ip, token);
      expect(r4.allowed).toBe(false);
      expect(r4.status).toBe(429);
      expect(r4.message).toContain("3 RPM");
      expect(r4.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  describe("HTTP Fetch RPC Interface", () => {
    it("handles OPTIONS preflight request with CORS headers", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const req = new Request("http://demo.internal/", { method: "OPTIONS" });
      const res = await demoDO.fetch(req);

      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    });

    it("handles GET /token and GET /api/demo/token", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });

      const req1 = new Request("http://demo.internal/token", { method: "GET" });
      const res1 = await demoDO.fetch(req1);
      expect(res1.status).toBe(200);
      const json1 = (await res1.json()) as { token: string; expiresAt: number };
      expect(json1.token).toMatch(/^kc_demo_/);

      const req2 = new Request("http://demo.internal/api/demo/token", {
        method: "GET",
      });
      const res2 = await demoDO.fetch(req2);
      expect(res2.status).toBe(200);
      const json2 = (await res2.json()) as { token: string; expiresAt: number };
      expect(json2.token).toBe(json1.token);
    });

    it("handles GET /limits?ip=...", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const ip = "123.123.123.123";

      const req = new Request(`http://demo.internal/limits?ip=${ip}`, {
        method: "GET",
      });
      const res = await demoDO.fetch(req);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { allowed: boolean; rpmLimit: number };
      expect(json.allowed).toBe(true);
      expect(json.rpmLimit).toBe(DEFAULT_IP_RPM_LIMIT);
    });

    it("handles POST /verify", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const { token } = await demoDO.getActiveDemoToken();

      // Valid token
      const validReq = new Request("http://demo.internal/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const validRes = await demoDO.fetch(validReq);
      expect(validRes.status).toBe(200);
      const validJson = (await validRes.json()) as { valid: boolean };
      expect(validJson.valid).toBe(true);

      // Invalid token
      const invalidReq = new Request("http://demo.internal/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "kc_demo_wrong" }),
      });
      const invalidRes = await demoDO.fetch(invalidReq);
      expect(invalidRes.status).toBe(401);
    });

    it("handles POST /consume with cf-connecting-ip header", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const { token } = await demoDO.getActiveDemoToken();

      const req = new Request("http://demo.internal/consume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "8.8.8.8",
        },
        body: JSON.stringify({ token }),
      });
      const res = await demoDO.fetch(req);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { allowed: boolean };
      expect(json.allowed).toBe(true);
    });

    it("handles POST /rotate to force token rotation", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const token1 = (await demoDO.getActiveDemoToken()).token;

      currentTime += 60_000;
      const rotateReq = new Request("http://demo.internal/rotate", {
        method: "POST",
      });
      const rotateRes = await demoDO.fetch(rotateReq);
      expect(rotateRes.status).toBe(200);
      const json = (await rotateRes.json()) as { token: string };
      expect(json.token).not.toBe(token1);
      expect(json.token).toMatch(/^kc_demo_/);
    });

    it("returns 404 for unknown endpoints", async () => {
      const demoDO = new DemoDO(mockState, {}, { timeProvider });
      const req = new Request("http://demo.internal/unknown-path", {
        method: "GET",
      });
      const res = await demoDO.fetch(req);
      expect(res.status).toBe(404);
    });
  });
});
