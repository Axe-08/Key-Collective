import { describe, it, expect } from "vitest";
import {
  // Cryptographic
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
  // Financial
  MICRODOLLAR_MULTIPLIER,
  MICRODOLLARS_PER_DOLLAR,
  ONE_MICRODOLLAR,
  ONE_CENT_MICRODOLLARS,
  ONE_DOLLAR_MICRODOLLARS,
  DEFAULT_MAX_BUDGET_MICRODOLLARS,
  DEFAULT_BUDGET_ALERT_THRESHOLD_PERCENT,
  MIN_MICRODOLLARS,
  dollarsToMicrodollars,
  microdollarsToDollars,
  centsToMicrodollars,
  microdollarsToCents,
  formatMicrodollars,
  isValidMicrodollarAmount,
  // Limits
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
} from "../src/constants";

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

describe("Financial Constants & Microdollars Logic (LLD 1.1)", () => {
  it("defines fixed-point microdollar multipliers and base amounts", () => {
    expect(MICRODOLLAR_MULTIPLIER).toBe(1_000_000n);
    expect(MICRODOLLARS_PER_DOLLAR).toBe(1_000_000n);
    expect(ONE_MICRODOLLAR).toBe(1n);
    expect(ONE_CENT_MICRODOLLARS).toBe(10_000n);
    expect(ONE_DOLLAR_MICRODOLLARS).toBe(1_000_000n);
    expect(DEFAULT_MAX_BUDGET_MICRODOLLARS).toBe(100_000_000n);
    expect(DEFAULT_BUDGET_ALERT_THRESHOLD_PERCENT).toBe(80);
    expect(MIN_MICRODOLLARS).toBe(0n);
  });

  describe("dollarsToMicrodollars", () => {
    it("converts whole integer dollars", () => {
      expect(dollarsToMicrodollars(1)).toBe(1_000_000n);
      expect(dollarsToMicrodollars(100)).toBe(100_000_000n);
      expect(dollarsToMicrodollars("5")).toBe(5_000_000n);
      expect(dollarsToMicrodollars("0")).toBe(0n);
    });

    it("converts exact decimal fractions without floating-point error", () => {
      expect(dollarsToMicrodollars("0.000001")).toBe(1n);
      expect(dollarsToMicrodollars("0.000005")).toBe(5n);
      expect(dollarsToMicrodollars("0.01")).toBe(10_000n);
      expect(dollarsToMicrodollars("1.50")).toBe(1_500_000n);
      expect(dollarsToMicrodollars("12.345678")).toBe(12_345_678n);
    });

    it("handles negative amounts correctly", () => {
      expect(dollarsToMicrodollars("-1.50")).toBe(-1_500_000n);
      expect(dollarsToMicrodollars("-0.000001")).toBe(-1n);
    });

    it("truncates sub-microdollar precision beyond 6 decimals", () => {
      expect(dollarsToMicrodollars("1.123456789")).toBe(1_123_456n);
    });

    it("throws on malformed dollar strings", () => {
      expect(() => dollarsToMicrodollars("abc")).toThrow(TypeError);
      expect(() => dollarsToMicrodollars("$12.34")).toThrow(TypeError);
      expect(() => dollarsToMicrodollars("1.2.3")).toThrow(TypeError);
    });
  });

  describe("microdollarsToDollars", () => {
    it("converts microdollars to decimal numbers for presentation", () => {
      expect(microdollarsToDollars(1_000_000n)).toBe(1.0);
      expect(microdollarsToDollars(1_500_000n)).toBe(1.5);
      expect(microdollarsToDollars(10_000n)).toBe(0.01);
      expect(microdollarsToDollars(1n)).toBe(0.000001);
      expect(microdollarsToDollars(0n)).toBe(0);
    });
  });

  describe("cents and microdollars conversions", () => {
    it("converts cents to microdollars", () => {
      expect(centsToMicrodollars(1)).toBe(10_000n);
      expect(centsToMicrodollars(50)).toBe(500_000n);
      expect(centsToMicrodollars(100n)).toBe(1_000_000n);
    });

    it("converts microdollars to whole cents (truncated)", () => {
      expect(microdollarsToCents(500_000n)).toBe(50n);
      expect(microdollarsToCents(10_000n)).toBe(1n);
      expect(microdollarsToCents(9_999n)).toBe(0n);
    });
  });

  describe("formatMicrodollars", () => {
    it("formats standard amounts in auto precision", () => {
      expect(formatMicrodollars(1_500_000n)).toBe("$1.50");
      expect(formatMicrodollars(0n)).toBe("$0.00");
      expect(formatMicrodollars(10_000n)).toBe("$0.01");
      expect(formatMicrodollars(12n)).toBe("$0.000012");
      expect(formatMicrodollars(1_234_567n)).toBe("$1.234567");
    });

    it("formats with cents-only precision", () => {
      expect(formatMicrodollars(1_500_000n, { precision: "cents" })).toBe("$1.50");
      expect(formatMicrodollars(1_234_567n, { precision: "cents" })).toBe("$1.23");
    });

    it("formats with microdollars full 6-digit precision", () => {
      expect(formatMicrodollars(1_500_000n, { precision: "microdollars" })).toBe("$1.500000");
      expect(formatMicrodollars(12n, { precision: "microdollars" })).toBe("$0.000012");
    });

    it("formats negative microdollar amounts", () => {
      expect(formatMicrodollars(-1_500_000n)).toBe("-$1.50");
      expect(formatMicrodollars(-12n)).toBe("-$0.000012");
    });

    it("formats without currency symbol when requested", () => {
      expect(formatMicrodollars(1_500_000n, { includeSymbol: false })).toBe("1.50");
    });
  });

  describe("isValidMicrodollarAmount", () => {
    it("validates non-negative bigint microdollars", () => {
      expect(isValidMicrodollarAmount(0n)).toBe(true);
      expect(isValidMicrodollarAmount(100n)).toBe(true);
      expect(isValidMicrodollarAmount(1_000_000n)).toBe(true);
      expect(isValidMicrodollarAmount(-1n)).toBe(false);
      expect(isValidMicrodollarAmount(100)).toBe(false);
      expect(isValidMicrodollarAmount("100")).toBe(false);
      expect(isValidMicrodollarAmount(null)).toBe(false);
      expect(isValidMicrodollarAmount(undefined)).toBe(false);
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
