/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests for Cryptographic Utilities & Timing-Safe Equality
 */

import { describe, expect, it } from "vitest";
import {
  base64ToUint8Array,
  base64UrlToUint8Array,
  bytesToHex,
  bytesToString,
  hexToBytes,
  secureRandomBytes,
  secureRandomHex,
  secureRandomString,
  stringToBytes,
  timingSafeEqual,
  timingSafeEqualHashed,
  timingSafeEqualStrings,
  uint8ArrayToBase64,
  uint8ArrayToBase64Url,
  wipeBytes,
} from "../../src/crypto/utils";
import { DecryptionError } from "../../src/errors/key_errors";

describe("Cryptographic Utilities & Timing-Safe Equality", () => {
  describe("timingSafeEqual", () => {
    it("returns true for identical byte buffers", () => {
      const a = new Uint8Array([1, 2, 3, 4, 5, 255]);
      const b = new Uint8Array([1, 2, 3, 4, 5, 255]);
      expect(timingSafeEqual(a, b)).toBe(true);
    });

    it("returns false if a single byte differs (first, middle, last)", () => {
      const base = new Uint8Array([10, 20, 30, 40, 50]);

      // First byte differs
      const diffFirst = new Uint8Array([11, 20, 30, 40, 50]);
      expect(timingSafeEqual(base, diffFirst)).toBe(false);

      // Middle byte differs
      const diffMiddle = new Uint8Array([10, 20, 31, 40, 50]);
      expect(timingSafeEqual(base, diffMiddle)).toBe(false);

      // Last byte differs
      const diffLast = new Uint8Array([10, 20, 30, 40, 51]);
      expect(timingSafeEqual(base, diffLast)).toBe(false);
    });

    it("returns false for buffers of different lengths", () => {
      const shortBuf = new Uint8Array([1, 2, 3]);
      const longBuf = new Uint8Array([1, 2, 3, 4]);
      expect(timingSafeEqual(shortBuf, longBuf)).toBe(false);
      expect(timingSafeEqual(longBuf, shortBuf)).toBe(false);
    });

    it("returns true for two empty buffers", () => {
      const empty1 = new Uint8Array(0);
      const empty2 = new Uint8Array(0);
      expect(timingSafeEqual(empty1, empty2)).toBe(true);
    });

    it("returns false when one buffer is empty and the other is not", () => {
      const empty = new Uint8Array(0);
      const nonNull = new Uint8Array([0]);
      expect(timingSafeEqual(empty, nonNull)).toBe(false);
      expect(timingSafeEqual(nonNull, empty)).toBe(false);
    });

    it("correctly identifies 1-bit discrepancies", () => {
      const a = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
      const b = new Uint8Array([0xaa, 0xbb, 0xcd, 0xdd]); // 0xcc ^ 0xcd = 1
      expect(timingSafeEqual(a, b)).toBe(false);
    });

    it("handles large 256-byte buffers", () => {
      const buf1 = secureRandomBytes(256);
      const buf2 = new Uint8Array(buf1);
      expect(timingSafeEqual(buf1, buf2)).toBe(true);

      buf2[128] ^= 0x01;
      expect(timingSafeEqual(buf1, buf2)).toBe(false);
    });
  });

  describe("timingSafeEqualStrings", () => {
    it("returns true for identical ASCII strings", () => {
      expect(timingSafeEqualStrings("secret-api-token", "secret-api-token")).toBe(true);
    });

    it("returns false for different strings of same length", () => {
      expect(timingSafeEqualStrings("secret-token-1", "secret-token-2")).toBe(false);
    });

    it("returns false for different strings of different lengths", () => {
      expect(timingSafeEqualStrings("secret", "secret-long")).toBe(false);
      expect(timingSafeEqualStrings("secret-long", "secret")).toBe(false);
    });

    it("returns true for two empty strings", () => {
      expect(timingSafeEqualStrings("", "")).toBe(true);
    });

    it("returns false when comparing empty with non-empty string", () => {
      expect(timingSafeEqualStrings("", "a")).toBe(false);
      expect(timingSafeEqualStrings("a", "")).toBe(false);
    });

    it("handles unicode and multibyte characters", () => {
      expect(timingSafeEqualStrings("🔑-token-🚀", "🔑-token-🚀")).toBe(true);
      expect(timingSafeEqualStrings("🔑-token-🚀", "🔒-token-🚀")).toBe(false);
    });
  });

  describe("timingSafeEqualHashed", () => {
    it("returns true for identical string inputs", async () => {
      const match = await timingSafeEqualHashed("my-secret-token", "my-secret-token");
      expect(match).toBe(true);
    });

    it("returns false for different string inputs of same length", async () => {
      const match = await timingSafeEqualHashed("token-12345", "token-54321");
      expect(match).toBe(false);
    });

    it("returns false for different string inputs of different lengths", async () => {
      const match = await timingSafeEqualHashed("short", "extremely-long-string-value");
      expect(match).toBe(false);
    });

    it("compares string and matching Uint8Array byte sequence", async () => {
      const str = "hello-crypto";
      const bytes = stringToBytes(str);
      const match = await timingSafeEqualHashed(str, bytes);
      expect(match).toBe(true);
    });

    it("returns true for identical empty inputs", async () => {
      const match = await timingSafeEqualHashed("", new Uint8Array(0));
      expect(match).toBe(true);
    });

    it("handles large 10KB inputs", async () => {
      const large1 = "X".repeat(10240);
      const large2 = "X".repeat(10240);
      const large3 = "X".repeat(10239) + "Y";

      expect(await timingSafeEqualHashed(large1, large2)).toBe(true);
      expect(await timingSafeEqualHashed(large1, large3)).toBe(false);
    });
  });

  describe("bytesToHex & hexToBytes", () => {
    it("converts byte array to lowercase hex string", () => {
      const bytes = new Uint8Array([0x00, 0x01, 0x0a, 0x0f, 0x10, 0xab, 0xff]);
      expect(bytesToHex(bytes)).toBe("00010a0f10abff");
    });

    it("converts empty buffer to empty hex string", () => {
      expect(bytesToHex(new Uint8Array(0))).toBe("");
    });

    it("converts hex string to byte array", () => {
      const hex = "00010a0f10abff";
      const bytes = hexToBytes(hex);
      expect(bytes).toEqual(new Uint8Array([0x00, 0x01, 0x0a, 0x0f, 0x10, 0xab, 0xff]));
    });

    it("handles uppercase and mixed-case hex", () => {
      const hexUpper = "00010A0F10ABFF";
      const bytes = hexToBytes(hexUpper);
      expect(bytes).toEqual(new Uint8Array([0x00, 0x01, 0x0a, 0x0f, 0x10, 0xab, 0xff]));
    });

    it("roundtrips arbitrary random bytes through hex and back", () => {
      const original = secureRandomBytes(64);
      const hex = bytesToHex(original);
      const restored = hexToBytes(hex);
      expect(restored).toEqual(original);
    });

    it("throws TypeError on odd-length hex strings", () => {
      expect(() => hexToBytes("abc")).toThrow(TypeError);
      expect(() => hexToBytes("1")).toThrow(TypeError);
    });

    it("throws TypeError on non-hexadecimal characters", () => {
      expect(() => hexToBytes("00zz")).toThrow(TypeError);
      expect(() => hexToBytes("012g")).toThrow(TypeError);
      expect(() => hexToBytes("not-hex-chars!")).toThrow(TypeError);
    });
  });

  describe("stringToBytes & bytesToString", () => {
    it("roundtrips standard ASCII text", () => {
      const text = "Key Collective LLM Router v2";
      const bytes = stringToBytes(text);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytesToString(bytes)).toBe(text);
    });

    it("roundtrips Unicode strings and emojis", () => {
      const unicode = "🔐 Cloudflare Workers ⚡ 日本語 العربية";
      const bytes = stringToBytes(unicode);
      expect(bytesToString(bytes)).toBe(unicode);
    });

    it("roundtrips empty string", () => {
      const bytes = stringToBytes("");
      expect(bytes.byteLength).toBe(0);
      expect(bytesToString(bytes)).toBe("");
    });

    it("throws TypeError on invalid UTF-8 sequence when fatal is true", () => {
      // 0xff 0xff is invalid UTF-8
      const invalidUtf8 = new Uint8Array([0xff, 0xff]);
      expect(() => bytesToString(invalidUtf8, true)).toThrow(TypeError);
    });
  });

  describe("Base64 & Base64URL utilities", () => {
    it("roundtrips bytes to standard Base64 and back", () => {
      const bytes = new Uint8Array([1, 2, 3, 250, 255]);
      const b64 = uint8ArrayToBase64(bytes);
      expect(typeof b64).toBe("string");
      const decoded = base64ToUint8Array(b64);
      expect(decoded).toEqual(bytes);
    });

    it("encodes to Base64URL without + / or =", () => {
      // Test payload that creates + and / in standard base64
      const bytes = new Uint8Array([251, 255, 254]); // base64: "+//+"
      const b64url = uint8ArrayToBase64Url(bytes);
      expect(b64url).not.toContain("+");
      expect(b64url).not.toContain("/");
      expect(b64url).not.toContain("=");

      const decoded = base64UrlToUint8Array(b64url);
      expect(decoded).toEqual(bytes);
    });

    it("throws DecryptionError on malformed base64", () => {
      expect(() => base64ToUint8Array("%%%not-valid-base64%%%")).toThrow(DecryptionError);
    });
  });

  describe("secureRandomBytes, secureRandomHex, secureRandomString", () => {
    it("generates correct number of random bytes", () => {
      const bytes16 = secureRandomBytes(16);
      expect(bytes16.byteLength).toBe(16);
      const bytes32 = secureRandomBytes(32);
      expect(bytes32.byteLength).toBe(32);
    });

    it("generates unique bytes on successive calls", () => {
      const b1 = secureRandomBytes(32);
      const b2 = secureRandomBytes(32);
      expect(timingSafeEqual(b1, b2)).toBe(false);
    });

    it("handles zero length random bytes", () => {
      const zeroBytes = secureRandomBytes(0);
      expect(zeroBytes.byteLength).toBe(0);
    });

    it("throws RangeError for negative lengths", () => {
      expect(() => secureRandomBytes(-1)).toThrow(RangeError);
    });

    it("generates secure random hex with correct character length", () => {
      const hex16 = secureRandomHex(16);
      expect(hex16.length).toBe(32);
      expect(/^[0-9a-f]{32}$/.test(hex16)).toBe(true);

      const hex32 = secureRandomHex(32);
      expect(hex32.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(hex32)).toBe(true);
    });

    it("generates secure random alphanumeric strings", () => {
      const str = secureRandomString(32);
      expect(str.length).toBe(32);
      expect(/^[A-Za-z0-9]{32}$/.test(str)).toBe(true);
    });

    it("respects custom alphabet", () => {
      const hexChars = "0123456789abcdef";
      const customStr = secureRandomString(24, hexChars);
      expect(customStr.length).toBe(24);
      expect(/^[0-9a-f]{24}$/.test(customStr)).toBe(true);
    });

    it("returns empty string for length <= 0", () => {
      expect(secureRandomString(0)).toBe("");
      expect(secureRandomString(-5)).toBe("");
    });

    it("throws Error if alphabet is empty", () => {
      expect(() => secureRandomString(10, "")).toThrow();
    });
  });

  describe("wipeBytes", () => {
    it("zeros out buffer contents in place", () => {
      const sensitive = new Uint8Array([42, 100, 255, 128, 64]);
      wipeBytes(sensitive);
      expect(sensitive).toEqual(new Uint8Array([0, 0, 0, 0, 0]));
    });

    it("handles empty buffers safely", () => {
      const empty = new Uint8Array(0);
      expect(() => wipeBytes(empty)).not.toThrow();
    });
  });
});
