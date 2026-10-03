import { describe, it, expect } from "vitest";
import {
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_KEY_LENGTH,
  ENCRYPTION_KEY_LENGTH_BYTES,
  NONCE_LENGTH_BYTES,
  TAG_LENGTH_BITS,
  TAG_LENGTH_BYTES,
  MASTER_KEY_ENV_VAR,
  KEY_MASK_PREFIX_LENGTH,
  KEY_MASK_SUFFIX_LENGTH,
  isValidNonceLength,
  isValidKeyLength,
  maskApiKey,
} from "../src/constants/crypto";
import {
  DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  DEFAULT_RPM_LIMIT,
  DEFAULT_RPD_LIMIT,
  DEFAULT_WINDOW_SIZE_SECONDS,
  DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SECONDS,
  DEFAULT_CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD,
  DEFAULT_CIRCUIT_BREAKER_TRIPPING_STATUS_CODES,
  DEFAULT_RETRY_AFTER_SECONDS,
  MAX_RPM_LIMIT,
  MIN_RPM_LIMIT,
  DEFAULT_MAX_FALLBACK_RETRIES,
  DEFAULT_FALLBACK_BACKOFF_MS,
  isValidRpmLimit,
  isValidCircuitBreakerThreshold,
} from "../src/constants/limits";

describe("Cryptographic Constants & Utilities (LLD 1.2)", () => {
  it("defines standard AES-GCM parameters", () => {
    expect(ENCRYPTION_ALGORITHM).toBe("AES-GCM");
    expect(ENCRYPTION_KEY_LENGTH).toBe(256);
    expect(ENCRYPTION_KEY_LENGTH_BYTES).toBe(32);
    expect(NONCE_LENGTH_BYTES).toBe(12);
    expect(TAG_LENGTH_BITS).toBe(128);
    expect(TAG_LENGTH_BYTES).toBe(16);
  });

  it("defines master key environment variable and mask dimensions according to ADR 002", () => {
    expect(MASTER_KEY_ENV_VAR).toBe("KC_MASTER_KEY");
    expect(KEY_MASK_PREFIX_LENGTH).toBe(6);
    expect(KEY_MASK_SUFFIX_LENGTH).toBe(4);
  });

  it("validates nonce length with isValidNonceLength", () => {
    expect(isValidNonceLength(12)).toBe(true);
    expect(isValidNonceLength(16)).toBe(false);
    expect(isValidNonceLength(8)).toBe(false);
    expect(isValidNonceLength(0)).toBe(false);
  });

  it("validates key length with isValidKeyLength", () => {
    expect(isValidKeyLength(256)).toBe(true);
    expect(isValidKeyLength(128)).toBe(false);
    expect(isValidKeyLength(512)).toBe(false);
  });

  describe("maskApiKey", () => {
    it("masks a typical API key retaining 6-char prefix and 4-char suffix", () => {
      const key = "sk-ant-api03-abcdef1234567890wxyz";
      const res = maskApiKey(key);
      expect(res.prefix).toBe("sk-ant");
      expect(res.suffix).toBe("wxyz");
      expect(res.masked).toBe("sk-ant...wxyz");
    });

    it("handles short keys without crashing", () => {
      const shortKey = "short";
      const res = maskApiKey(shortKey);
      expect(res.prefix).toBe("short");
      expect(res.suffix).toBe("");
      expect(res.masked).toBe("short...");
    });

    it("handles empty key strings", () => {
      const res = maskApiKey("");
      expect(res.prefix).toBe("");
      expect(res.suffix).toBe("");
      expect(res.masked).toBe("");
    });

    it("allows customized prefix and suffix lengths", () => {
      const key = "abcdefghijklmnopqrstuvwxyz";
      const res = maskApiKey(key, 3, 2);
      expect(res.prefix).toBe("abc");
      expect(res.suffix).toBe("yz");
      expect(res.masked).toBe("abc...yz");
    });
  });
});



describe("System Limits & Circuit Breaker Constants (LLD 1.3)", () => {
  it("defines standard circuit breaker invariants", () => {
    expect(DEFAULT_CIRCUIT_BREAKER_THRESHOLD).toBe(3);
    expect(DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SECONDS).toBe(60);
    expect(DEFAULT_CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD).toBe(1);
    expect(DEFAULT_CIRCUIT_BREAKER_TRIPPING_STATUS_CODES).toEqual([429, 500, 502, 503, 504]);
  });

  it("defines standard rate limiting invariants", () => {
    expect(DEFAULT_RPM_LIMIT).toBe(60);
    expect(DEFAULT_RPD_LIMIT).toBe(1500);
    expect(DEFAULT_WINDOW_SIZE_SECONDS).toBe(60);
    expect(DEFAULT_RETRY_AFTER_SECONDS).toBe(60);
    expect(MAX_RPM_LIMIT).toBe(100_000);
    expect(MIN_RPM_LIMIT).toBe(1);
  });

  it("defines routing fallback invariants", () => {
    expect(DEFAULT_MAX_FALLBACK_RETRIES).toBe(3);
    expect(DEFAULT_FALLBACK_BACKOFF_MS).toBe(250);
  });

  it("validates RPM limit ranges with isValidRpmLimit", () => {
    expect(isValidRpmLimit(60)).toBe(true);
    expect(isValidRpmLimit(1)).toBe(true);
    expect(isValidRpmLimit(100_000)).toBe(true);
    expect(isValidRpmLimit(0)).toBe(false);
    expect(isValidRpmLimit(-10)).toBe(false);
    expect(isValidRpmLimit(100_001)).toBe(false);
    expect(isValidRpmLimit(60.5)).toBe(false);
    expect(isValidRpmLimit("60")).toBe(false);
    expect(isValidRpmLimit(null)).toBe(false);
  });

  it("validates circuit breaker threshold with isValidCircuitBreakerThreshold", () => {
    expect(isValidCircuitBreakerThreshold(1)).toBe(true);
    expect(isValidCircuitBreakerThreshold(3)).toBe(true);
    expect(isValidCircuitBreakerThreshold(5)).toBe(true);
    expect(isValidCircuitBreakerThreshold(0)).toBe(false);
    expect(isValidCircuitBreakerThreshold(-1)).toBe(false);
    expect(isValidCircuitBreakerThreshold(2.5)).toBe(false);
    expect(isValidCircuitBreakerThreshold(null)).toBe(false);
  });
});
