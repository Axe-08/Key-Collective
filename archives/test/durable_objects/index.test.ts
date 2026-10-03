/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: Durable Objects Barrel Export (T-05)
 */

import { describe, expect, it } from "vitest";
import * as DOModule from "../../src/durable_objects";
import {
  CIRCUIT_BREAKER_STATES,
  CircuitBreaker,
  KeyPoolDO,
  KeySelector,
  ONE_DAY_MS,
  ONE_DAY_SECONDS,
  RateLimiter,
  createDefaultCircuitBreakerData,
  createDefaultRateLimiterData,
  isCircuitBreakerData,
  isCircuitBreakerState,
  isEncryptedKey,
  isRateLimitEntry,
  isRateLimiterData,
  isSelectableKey,
} from "../../src/durable_objects";

describe("Durable Objects Barrel Export (T-05)", () => {
  describe("Class Exports", () => {
    it("exports CircuitBreaker class", () => {
      expect(CircuitBreaker).toBeDefined();
      expect(typeof CircuitBreaker).toBe("function");
      expect(DOModule.CircuitBreaker).toBe(CircuitBreaker);
    });

    it("exports RateLimiter class", () => {
      expect(RateLimiter).toBeDefined();
      expect(typeof RateLimiter).toBe("function");
      expect(DOModule.RateLimiter).toBe(RateLimiter);
    });

    it("exports KeySelector class", () => {
      expect(KeySelector).toBeDefined();
      expect(typeof KeySelector).toBe("function");
      expect(DOModule.KeySelector).toBe(KeySelector);
    });

    it("exports KeyPoolDO class", () => {
      expect(KeyPoolDO).toBeDefined();
      expect(typeof KeyPoolDO).toBe("function");
      expect(DOModule.KeyPoolDO).toBe(KeyPoolDO);
    });
  });

  describe("Constants & Helper Functions", () => {
    it("exports CircuitBreaker constants and helpers", () => {
      expect(CIRCUIT_BREAKER_STATES).toEqual(["CLOSED", "OPEN", "HALF_OPEN"]);
      expect(typeof createDefaultCircuitBreakerData).toBe("function");
      expect(typeof isCircuitBreakerState).toBe("function");
      expect(typeof isCircuitBreakerData).toBe("function");

      const defaultData = createDefaultCircuitBreakerData();
      expect(defaultData.state).toBe("CLOSED");
      expect(isCircuitBreakerState("CLOSED")).toBe(true);
      expect(isCircuitBreakerData(defaultData)).toBe(true);
    });

    it("exports RateLimiter constants and helpers", () => {
      expect(ONE_DAY_MS).toBe(86_400_000);
      expect(ONE_DAY_SECONDS).toBe(86_400);
      expect(typeof createDefaultRateLimiterData).toBe("function");
      expect(typeof isRateLimitEntry).toBe("function");
      expect(typeof isRateLimiterData).toBe("function");

      const defaultData = createDefaultRateLimiterData();
      expect(defaultData.entries).toEqual([]);
      expect(defaultData.totalCostMicrodollars).toBe("0");
      expect(isRateLimiterData(defaultData)).toBe(true);
    });

    it("exports KeySelector helpers", () => {
      expect(typeof isSelectableKey).toBe("function");
      expect(
        isSelectableKey({
          id: "key_1",
          provider: "openai",
          keyHash: "hash_1",
          encryptedKey: "enc_1",
          iv: "iv_1",
          isActive: true,
          modelWhitelist: [],
          tags: {},
        })
      ).toBe(true);
    });

    it("exports KeyPoolDO helpers", () => {
      expect(typeof isEncryptedKey).toBe("function");
      expect(
        isEncryptedKey({
          id: "key_1",
          tenantId: "tenant_1",
          provider: "openai",
          ciphertext: "secret_1",
          nonce: "nonce_12345678",
        })
      ).toBe(true);
    });
  });
});
