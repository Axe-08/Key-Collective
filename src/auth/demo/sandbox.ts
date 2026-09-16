/**
 * Key Collective v3 — Ephemeral Demo Sandbox & Sliding Window Rate Limiter
 *
 * Implements ephemeral token generation (CSPRNG), candidate token validation,
 * and multi-tiered sliding window rate limiting (IP RPM, IP RPD, Global RPM).
 *
 * Invariants (GEMINI.md):
 * - TypeScript strict mode (no any).
 * - Fixed-point / integer arithmetic for rate limits and time deltas (no floating-point math).
 * - Ephemeral sliding window pruning for bounded memory footprint.
 */

import {
  DEFAULT_GLOBAL_RPM_LIMIT,
  DEFAULT_GLOBAL_RPD_LIMIT,
  DEFAULT_IP_RPD_LIMIT,
  DEFAULT_IP_RPM_LIMIT,
  DEFAULT_STALE_PRUNE_MS,
} from "./constants";
import type {
  DemoRateLimitResult,
  IpWindowData,
  TokenValidationResult,
} from "./types";

/**
 * Generates an ephemeral demo token with a 12-byte CSPRNG random hex suffix.
 */
export function generateDemoToken(now: number): string {
  const webCrypto =
    typeof crypto !== "undefined"
      ? crypto
      : (globalThis as unknown as { crypto: Crypto }).crypto;

  const randomBytes = webCrypto.getRandomValues(new Uint8Array(16));
  const tokenSuffix = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);

  return `kc_demo_${Math.floor(now / 1000)}_${tokenSuffix}`;
}

/**
 * Validates a candidate demo token against the active token and expiration.
 */
export function validateDemoToken(
  token: string,
  currentToken: string,
  tokenExpiresAt: number,
  now: number
): TokenValidationResult {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "Missing or invalid token format" };
  }

  if (!token.startsWith("kc_demo_")) {
    return { valid: false, reason: "Invalid token prefix: expected kc_demo_" };
  }

  if (token !== currentToken) {
    return {
      valid: false,
      reason: "Demo token is invalid or has rotated",
    };
  }

  if (now >= tokenExpiresAt) {
    return { valid: false, reason: "Demo token has expired" };
  }

  return { valid: true };
}

export interface DemoSandboxConfig {
  ipRpmLimit?: number;
  ipRpdLimit?: number;
  globalRpmLimit?: number;
  globalRpdLimit?: number;
  stalePruneMs?: number;
}

/**
 * Ephemeral sandbox engine managing per-IP sliding windows and global playground limits.
 */
export class DemoSandbox {
  private readonly ipRpmLimit: number;
  private readonly ipRpdLimit: number;
  private readonly globalRpmLimit: number;
  private readonly globalRpdLimit: number;
  private readonly stalePruneMs: number;

  private readonly ipSlidingWindows: Map<string, IpWindowData> = new Map();
  private globalTimestamps: number[] = [];

  constructor(config?: DemoSandboxConfig) {
    this.ipRpmLimit = config?.ipRpmLimit ?? DEFAULT_IP_RPM_LIMIT;
    this.ipRpdLimit = config?.ipRpdLimit ?? DEFAULT_IP_RPD_LIMIT;
    this.globalRpmLimit = config?.globalRpmLimit ?? DEFAULT_GLOBAL_RPM_LIMIT;
    this.globalRpdLimit = config?.globalRpdLimit ?? DEFAULT_GLOBAL_RPD_LIMIT;
    this.stalePruneMs = config?.stalePruneMs ?? DEFAULT_STALE_PRUNE_MS;
  }

  /**
   * Evaluates rate limits for a given IP and the global demo pool without recording a request.
   */
  public checkRateLimit(ip: string, now: number): DemoRateLimitResult {
    const oneMinuteAgo = now - 60_000;
    const oneDayAgo = now - 86_400_000;

    // Filter global timestamps in 1-minute window
    const activeGlobal = this.globalTimestamps.filter((t) => t > oneMinuteAgo);
    const globalRpm = activeGlobal.length;

    // Filter IP timestamps in 24-hour window
    const ipData = this.ipSlidingWindows.get(ip);
    const ipTimestamps = ipData
      ? ipData.timestamps.filter((t) => t > oneDayAgo)
      : [];
    const ipMinuteTimestamps = ipTimestamps.filter((t) => t > oneMinuteAgo);
    const ipRpm = ipMinuteTimestamps.length;
    const ipRpd = ipTimestamps.length;

    // 1. IP RPM check (3 RPM default)
    if (ipRpm >= this.ipRpmLimit) {
      const oldestInMinute = ipMinuteTimestamps[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldestInMinute + 60_000 - now) / 1000)
      );
      return {
        allowed: false,
        currentRpm: ipRpm,
        rpmLimit: this.ipRpmLimit,
        currentRpd: ipRpd,
        rpdLimit: this.ipRpdLimit,
        globalRpm,
        globalRpmLimit: this.globalRpmLimit,
        retryAfterSeconds,
        reason: "ip_rpm_exceeded",
      };
    }

    // 2. IP RPD check (25 RPD default)
    if (ipRpd >= this.ipRpdLimit) {
      const oldestInDay = ipTimestamps[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldestInDay + 86_400_000 - now) / 1000)
      );
      return {
        allowed: false,
        currentRpm: ipRpm,
        rpmLimit: this.ipRpmLimit,
        currentRpd: ipRpd,
        rpdLimit: this.ipRpdLimit,
        globalRpm,
        globalRpmLimit: this.globalRpmLimit,
        retryAfterSeconds,
        reason: "ip_rpd_exceeded",
      };
    }

    // 3. Global pool RPM check (5 RPM default)
    if (globalRpm >= this.globalRpmLimit) {
      const oldestGlobal = activeGlobal[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldestGlobal + 60_000 - now) / 1000)
      );
      return {
        allowed: false,
        currentRpm: ipRpm,
        rpmLimit: this.ipRpmLimit,
        currentRpd: ipRpd,
        rpdLimit: this.ipRpdLimit,
        globalRpm,
        globalRpmLimit: this.globalRpmLimit,
        retryAfterSeconds,
        reason: "global_rpm_exceeded",
      };
    }

    // 4. Global pool RPD check (20 RPD default)
    const activeGlobalDay = this.globalTimestamps.filter((t) => t > oneDayAgo);
    const globalRpd = activeGlobalDay.length;
    if (globalRpd >= this.globalRpdLimit) {
      const oldestGlobalDay = activeGlobalDay[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldestGlobalDay + 86_400_000 - now) / 1000)
      );
      return {
        allowed: false,
        currentRpm: ipRpm,
        rpmLimit: this.ipRpmLimit,
        currentRpd: ipRpd,
        rpdLimit: this.ipRpdLimit,
        globalRpm,
        globalRpmLimit: this.globalRpmLimit,
        retryAfterSeconds,
        reason: "global_rpd_exceeded",
      };
    }

    return {
      allowed: true,
      currentRpm: ipRpm,
      rpmLimit: this.ipRpmLimit,
      currentRpd: ipRpd,
      rpdLimit: this.ipRpdLimit,
      globalRpm,
      globalRpmLimit: this.globalRpmLimit,
    };
  }

  /**
   * Records a request for a client IP and increments sliding counters.
   * Returns rate limit diagnostic details.
   */
  public recordRequest(ip: string, now: number): DemoRateLimitResult {
    const check = this.checkRateLimit(ip, now);
    if (!check.allowed) {
      return check;
    }

    const oneMinuteAgo = now - 60_000;
    const oneDayAgo = now - 86_400_000;

    // Record global timestamp
    this.globalTimestamps = this.globalTimestamps.filter((t) => t > oneDayAgo);
    this.globalTimestamps.push(now);

    // Record IP timestamp
    const existing = this.ipSlidingWindows.get(ip);
    const validTimestamps = existing
      ? existing.timestamps.filter((t) => t > oneDayAgo)
      : [];
    validTimestamps.push(now);

    const ipMinuteTimestamps = validTimestamps.filter((t) => t > oneMinuteAgo);

    const updatedData: IpWindowData = {
      requests: validTimestamps.length,
      windowStart: now,
      timestamps: validTimestamps,
      minuteWindowStart: oneMinuteAgo,
      minuteRequests: ipMinuteTimestamps.length,
      dayWindowStart: oneDayAgo,
      dayRequests: validTimestamps.length,
    };

    this.ipSlidingWindows.set(ip, updatedData);

    return {
      allowed: true,
      currentRpm: ipMinuteTimestamps.length,
      rpmLimit: this.ipRpmLimit,
      currentRpd: validTimestamps.length,
      rpdLimit: this.ipRpdLimit,
      globalRpm: this.globalTimestamps.length,
      globalRpmLimit: this.globalRpmLimit,
    };
  }

  /**
   * Prunes stale IP rate-limiting windows that have been inactive for >= stalePruneMs.
   */
  public pruneStaleWindows(now: number): void {
    const pruneThreshold = now - this.stalePruneMs;
    for (const [ip, data] of this.ipSlidingWindows.entries()) {
      if (data.windowStart < pruneThreshold) {
        this.ipSlidingWindows.delete(ip);
      }
    }
  }

  /**
   * Returns a read-only snapshot of active IP sliding windows.
   */
  public getIpSlidingWindows(): ReadonlyMap<string, IpWindowData> {
    return this.ipSlidingWindows;
  }

  /**
   * Returns IP window data for a specific IP if present.
   */
  public getIpWindow(ip: string): IpWindowData | undefined {
    return this.ipSlidingWindows.get(ip);
  }
}
