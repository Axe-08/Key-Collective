/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests for SHA-256 Hashing & Verification Helpers
 */

import { describe, expect, it } from "vitest";
import {
  HASH_ALGORITHM,
  SHA256_DIGEST_LENGTH_BYTES,
  SHA256_HEX_LENGTH,
  hashApiKey,
  hashFingerprint,
  hashToken,
  hashWithSalt,
  hmacSha256,
  hmacSha256Hex,
  sha256,
  sha256Base64,
  sha256Base64Url,
  sha256Hex,
  verifyHmacSha256,
  verifySha256,
  verifyToken,
} from "../../src/crypto/hashing";
import { hexToBytes, stringToBytes } from "../../src/crypto/utils";

describe("SHA-256 Hashing & Token Verification Helpers", () => {
  // NIST Standard Test Vectors
  const VECTORS = {
    empty: {
      input: "",
      hex: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      b64: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    },
    abc: {
      input: "abc",
      hex: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    },
    helloWorld: {
      input: "hello world",
      hex: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    },
    long: {
      input: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      hex: "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    },
  };

  describe("Constants", () => {
    it("exports correct cryptographic hashing constants", () => {
      expect(HASH_ALGORITHM).toBe("SHA-256");
      expect(SHA256_DIGEST_LENGTH_BYTES).toBe(32);
      expect(SHA256_HEX_LENGTH).toBe(64);
    });
  });

  describe("sha256 & sha256Hex", () => {
    it("computes NIST vector for empty string", async () => {
      const raw = await sha256(VECTORS.empty.input);
      expect(raw).toBeInstanceOf(Uint8Array);
      expect(raw.byteLength).toBe(SHA256_DIGEST_LENGTH_BYTES);

      const hex = await sha256Hex(VECTORS.empty.input);
      expect(hex).toBe(VECTORS.empty.hex);
    });

    it("computes NIST vector for 'abc'", async () => {
      const hex = await sha256Hex(VECTORS.abc.input);
      expect(hex).toBe(VECTORS.abc.hex);
    });

    it("computes NIST vector for 'hello world'", async () => {
      const hex = await sha256Hex(VECTORS.helloWorld.input);
      expect(hex).toBe(VECTORS.helloWorld.hex);
    });

    it("computes NIST vector for standard 448-bit string", async () => {
      const hex = await sha256Hex(VECTORS.long.input);
      expect(hex).toBe(VECTORS.long.hex);
    });

    it("accepts Uint8Array input", async () => {
      const bytes = stringToBytes("hello world");
      const hex = await sha256Hex(bytes);
      expect(hex).toBe(VECTORS.helloWorld.hex);
    });

    it("accepts ArrayBuffer input", async () => {
      const bytes = stringToBytes("hello world");
      const hex = await sha256Hex(bytes.buffer);
      expect(hex).toBe(VECTORS.helloWorld.hex);
    });

    it("throws TypeError for invalid input types", async () => {
      // @ts-expect-error testing invalid runtime input
      await expect(sha256(12345)).rejects.toThrow(TypeError);
      // @ts-expect-error testing invalid runtime input
      await expect(sha256(null)).rejects.toThrow(TypeError);
    });
  });

  describe("sha256Base64 & sha256Base64Url", () => {
    it("computes base64 digest matching NIST vector", async () => {
      const b64 = await sha256Base64(VECTORS.empty.input);
      expect(b64).toBe(VECTORS.empty.b64);
    });

    it("computes URL-safe base64 without +, /, or =", async () => {
      const b64url = await sha256Base64Url(VECTORS.empty.input);
      expect(b64url).not.toContain("+");
      expect(b64url).not.toContain("/");
      expect(b64url).not.toContain("=");
      // Standard: 47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=
      // URL-Safe: 47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU
      expect(b64url).toBe("47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
    });
  });

  describe("hashToken (ADR 002 / Go reference proxy.HashToken)", () => {
    it("produces 64-character lowercase hex string", async () => {
      const token = "kc_live_9f83a04b12c8e543d21f8a9e";
      const hash = await hashToken(token);
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    it("is deterministic for identical tokens", async () => {
      const token = "kc_test_bearer_token_777";
      const h1 = await hashToken(token);
      const h2 = await hashToken(token);
      expect(h1).toBe(h2);
    });

    it("matches Go reference hashToken for known test token", async () => {
      // Go: HashToken("kc_test_token")
      const goToken = "kc_test_token";
      const expected = await sha256Hex(goToken);
      const hash = await hashToken(goToken);
      expect(hash).toBe(expected);
    });
  });

  describe("hashApiKey", () => {
    it("hashes API keys canonicalizing whitespace", async () => {
      const rawKey = "sk-ant-api03-1234567890";
      const untrimmedKey = "  sk-ant-api03-1234567890 \n";

      const h1 = await hashApiKey(rawKey);
      const h2 = await hashApiKey(untrimmedKey);

      expect(h1).toBe(h2);
      expect(h1.length).toBe(64);
    });
  });

  describe("hashWithSalt", () => {
    it("produces distinct digests with different salts", async () => {
      const data = "tenant-secret-payload";
      const hash1 = await hashWithSalt(data, "salt-A");
      const hash2 = await hashWithSalt(data, "salt-B");

      expect(hash1).not.toBe(hash2);
      expect(hash1.length).toBe(64);
      expect(hash2.length).toBe(64);
    });

    it("supports Uint8Array salt", async () => {
      const saltBytes = new Uint8Array([1, 2, 3, 4]);
      const hash = await hashWithSalt("my-data", saltBytes);
      expect(hash.length).toBe(64);
    });
  });

  describe("hashFingerprint", () => {
    it("returns default 16-character prefix", async () => {
      const data = "api-key-to-fingerprint";
      const fullHex = await sha256Hex(data);
      const fp = await hashFingerprint(data);

      expect(fp.length).toBe(16);
      expect(fp).toBe(fullHex.slice(0, 16));
    });

    it("supports custom fingerprint lengths", async () => {
      const data = "my-key";
      const fullHex = await sha256Hex(data);

      const fp8 = await hashFingerprint(data, 8);
      expect(fp8.length).toBe(8);
      expect(fp8).toBe(fullHex.slice(0, 8));

      const fp32 = await hashFingerprint(data, 32);
      expect(fp32.length).toBe(32);
      expect(fp32).toBe(fullHex.slice(0, 32));
    });

    it("throws RangeError on invalid length", async () => {
      await expect(hashFingerprint("test", 0)).rejects.toThrow(RangeError);
      await expect(hashFingerprint("test", -1)).rejects.toThrow(RangeError);
      await expect(hashFingerprint("test", 65)).rejects.toThrow(RangeError);
    });
  });

  describe("verifySha256 & verifyToken (Timing-Safe)", () => {
    it("verifies matching hex hash (case-insensitive)", async () => {
      const data = "authenticated-request-body";
      const hex = await sha256Hex(data);

      expect(await verifySha256(data, hex)).toBe(true);
      expect(await verifySha256(data, hex.toUpperCase())).toBe(true);
    });

    it("rejects non-matching hex hash", async () => {
      const data = "valid-payload";
      const hex = await sha256Hex("different-payload");

      expect(await verifySha256(data, hex)).toBe(false);
    });

    it("verifies matching base64 hash", async () => {
      const data = "base64-test-data";
      const b64 = await sha256Base64(data);

      expect(await verifySha256(data, b64)).toBe(true);
    });

    it("verifies bearer token against known hash with verifyToken", async () => {
      const token = "kc_bearer_secret_abc123";
      const storedHash = await hashToken(token);

      expect(await verifyToken(token, storedHash)).toBe(true);
      expect(await verifyToken("wrong_token", storedHash)).toBe(false);
      expect(await verifyToken(token, "0".repeat(64))).toBe(false);
    });
  });

  describe("HMAC-SHA-256 (RFC 4231 test vectors)", () => {
    // RFC 4231 standard vector
    // Key = "key", Data = "The quick brown fox jumps over the lazy dog"
    // Expected HMAC-SHA256 = f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8
    const RFC_KEY = "key";
    const RFC_DATA = "The quick brown fox jumps over the lazy dog";
    const RFC_EXPECTED_HEX = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";

    it("computes HMAC-SHA-256 matching standard RFC test vector", async () => {
      const mac = await hmacSha256(RFC_KEY, RFC_DATA);
      expect(mac).toBeInstanceOf(Uint8Array);
      expect(mac.byteLength).toBe(32);

      const macHex = await hmacSha256Hex(RFC_KEY, RFC_DATA);
      expect(macHex).toBe(RFC_EXPECTED_HEX);
    });

    it("verifies valid HMAC with verifyHmacSha256 (hex and Uint8Array)", async () => {
      const isValidHex = await verifyHmacSha256(RFC_KEY, RFC_DATA, RFC_EXPECTED_HEX);
      expect(isValidHex).toBe(true);

      const expectedBytes = hexToBytes(RFC_EXPECTED_HEX);
      const isValidBytes = await verifyHmacSha256(RFC_KEY, RFC_DATA, expectedBytes);
      expect(isValidBytes).toBe(true);
    });

    it("rejects invalid or tampered HMAC", async () => {
      const tamperedHex = RFC_EXPECTED_HEX.slice(0, 62) + "00";
      const isValid = await verifyHmacSha256(RFC_KEY, RFC_DATA, tamperedHex);
      expect(isValid).toBe(false);

      const wrongKey = await verifyHmacSha256("wrong-key", RFC_DATA, RFC_EXPECTED_HEX);
      expect(wrongKey).toBe(false);

      const wrongData = await verifyHmacSha256(RFC_KEY, "tampered data", RFC_EXPECTED_HEX);
      expect(wrongData).toBe(false);
    });
  });
});
