/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests for AES-256-GCM Web Crypto Encryption & Decryption Helpers
 */

import { describe, expect, it } from "vitest";
import {
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_KEY_LENGTH,
  ENCRYPTION_KEY_LENGTH_BYTES,
  NONCE_LENGTH_BYTES,
  TAG_LENGTH_BYTES,
} from "../../src/constants/crypto";
import {
  base64ToUint8Array,
  decrypt,
  decryptRaw,
  deriveKey,
  encrypt,
  generateNonce,
  generateNonceB64,
  hashToken,
  importRawKey,
  uint8ArrayToBase64,
} from "../../src/crypto/encryption";
import { DecryptionError, EncryptionError } from "../../src/errors/key_errors";

interface AesKeyAlgorithmInfo {
  name: string;
  length?: number;
}

describe("Web Crypto AES-256-GCM Helpers", () => {
  const TEST_MASTER_KEY = "test-master-secret-passphrase-32bytes!";
  const TEST_API_KEY = "sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz-AAAA";

  describe("generateNonce & generateNonceB64", () => {
    it("generates a 12-byte (96-bit) nonce", () => {
      const nonce = generateNonce();
      expect(nonce).toBeInstanceOf(Uint8Array);
      expect(nonce.byteLength).toBe(NONCE_LENGTH_BYTES);
    });

    it("generates unique nonces across successive calls", () => {
      const set = new Set<string>();
      const iterations = 50;
      for (let i = 0; i < iterations; i++) {
        const nonce = generateNonce();
        const hex = Array.from(nonce)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        set.add(hex);
      }
      expect(set.size).toBe(iterations);
    });

    it("throws EncryptionError if requested with invalid length", () => {
      expect(() => generateNonce(8)).toThrow(EncryptionError);
      expect(() => generateNonce(16)).toThrow(EncryptionError);
      expect(() => generateNonce(0)).toThrow(EncryptionError);
    });

    it("generates a valid base64 nonce with generateNonceB64", () => {
      const nonceB64 = generateNonceB64();
      expect(typeof nonceB64).toBe("string");
      const decoded = base64ToUint8Array(nonceB64);
      expect(decoded.byteLength).toBe(NONCE_LENGTH_BYTES);
    });
  });

  describe("deriveKey", () => {
    it("derives a 256-bit AES-GCM CryptoKey from a string passphrase", async () => {
      const key = await deriveKey(TEST_MASTER_KEY);
      expect(key.type).toBe("secret");
      expect(key.algorithm.name).toBe(ENCRYPTION_ALGORITHM);
      const algo = key.algorithm as AesKeyAlgorithmInfo;
      expect(algo.length).toBe(ENCRYPTION_KEY_LENGTH);
      expect(key.usages).toContain("encrypt");
      expect(key.usages).toContain("decrypt");
    });

    it("throws EncryptionError for empty secret string", async () => {
      await expect(deriveKey("")).rejects.toThrow(EncryptionError);
    });

    it("throws EncryptionError for empty Uint8Array", async () => {
      await expect(deriveKey(new Uint8Array(0))).rejects.toThrow(EncryptionError);
    });

    it("derives key deterministically for the same secret", async () => {
      const data = "hello deterministic encryption";
      const key1 = await deriveKey("secret-123");
      const key2 = await deriveKey("secret-123");

      const encrypted = await encrypt(data, key1);
      const decrypted = await decrypt(encrypted, key2);
      expect(decrypted).toBe(data);
    });
  });

  describe("importRawKey", () => {
    it("imports a valid 32-byte raw key directly", async () => {
      const raw32 = crypto.getRandomValues(new Uint8Array(ENCRYPTION_KEY_LENGTH_BYTES));
      const key = await importRawKey(raw32);
      expect(key.type).toBe("secret");
      expect(key.algorithm.name).toBe(ENCRYPTION_ALGORITHM);
      const algo = key.algorithm as AesKeyAlgorithmInfo;
      expect(algo.length).toBe(ENCRYPTION_KEY_LENGTH);
    });

    it("rejects raw key that is not 32 bytes (e.g. 16 or 24 bytes)", async () => {
      const raw16 = new Uint8Array(16);
      await expect(importRawKey(raw16)).rejects.toThrow(EncryptionError);

      const raw24 = new Uint8Array(24);
      await expect(importRawKey(raw24)).rejects.toThrow(EncryptionError);
    });
  });

  describe("encrypt & decrypt roundtrip", () => {
    it("encrypts and decrypts a standard API key string", async () => {
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
      expect(encrypted.nonce).toBeInstanceOf(Uint8Array);
      expect(encrypted.nonce.byteLength).toBe(12);
      expect(encrypted.ciphertextB64).toBeDefined();
      expect(encrypted.nonceB64).toBeDefined();
      expect(encrypted.combined.byteLength).toBe(
        encrypted.nonce.byteLength + encrypted.ciphertext.byteLength
      );

      const decrypted = await decrypt(encrypted.ciphertextB64, TEST_MASTER_KEY, encrypted.nonceB64);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("encrypts and decrypts an empty string", async () => {
      const encrypted = await encrypt("", TEST_MASTER_KEY);
      // Empty plaintext in AES-GCM results in 16-byte authentication tag
      expect(encrypted.ciphertext.byteLength).toBe(TAG_LENGTH_BYTES);
      const decrypted = await decrypt(encrypted, TEST_MASTER_KEY);
      expect(decrypted).toBe("");
    });

    it("encrypts and decrypts large payloads (e.g. 20KB)", async () => {
      const largeText = "A".repeat(20480);
      const encrypted = await encrypt(largeText, TEST_MASTER_KEY);
      const decrypted = await decrypt(encrypted, TEST_MASTER_KEY);
      expect(decrypted).toBe(largeText);
    });

    it("encrypts and decrypts UTF-8 unicode strings and emojis", async () => {
      const unicodeText = "🔑 Key Collective 🚀 ñoño 日本語 مرحبا";
      const encrypted = await encrypt(unicodeText, TEST_MASTER_KEY);
      const decrypted = await decrypt(encrypted, TEST_MASTER_KEY);
      expect(decrypted).toBe(unicodeText);
    });

    it("encrypts and decrypts raw binary Uint8Array via decryptRaw", async () => {
      const rawBinary = new Uint8Array([0x00, 0xff, 0x42, 0x13, 0x37, 0xaa, 0xbb]);
      const encrypted = await encrypt(rawBinary, TEST_MASTER_KEY);
      const decryptedBytes = await decryptRaw(encrypted, TEST_MASTER_KEY);
      expect(decryptedBytes).toEqual(rawBinary);
    });

    it("generates different ciphertexts for the same plaintext (semantic security)", async () => {
      const enc1 = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      const enc2 = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);

      expect(enc1.nonceB64).not.toBe(enc2.nonceB64);
      expect(enc1.ciphertextB64).not.toBe(enc2.ciphertextB64);
      expect(enc1.combinedB64).not.toBe(enc2.combinedB64);

      expect(await decrypt(enc1, TEST_MASTER_KEY)).toBe(TEST_API_KEY);
      expect(await decrypt(enc2, TEST_MASTER_KEY)).toBe(TEST_API_KEY);
    });

    it("supports providing a custom 12-byte nonce", async () => {
      const customNonce = generateNonce();
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY, customNonce);
      expect(encrypted.nonce).toEqual(customNonce);

      const decrypted = await decrypt(encrypted.ciphertext, TEST_MASTER_KEY, customNonce);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("rejects encryption if explicitly provided nonce is not 12 bytes", async () => {
      const badNonce = new Uint8Array(8);
      await expect(encrypt(TEST_API_KEY, TEST_MASTER_KEY, badNonce)).rejects.toThrow(
        EncryptionError
      );
    });

    it("works with pre-derived CryptoKey", async () => {
      const cryptoKey = await deriveKey(TEST_MASTER_KEY);
      const encrypted = await encrypt(TEST_API_KEY, cryptoKey);
      const decrypted = await decrypt(encrypted, cryptoKey);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("works with raw 32-byte Uint8Array key", async () => {
      const raw32 = crypto.getRandomValues(new Uint8Array(32));
      const encrypted = await encrypt(TEST_API_KEY, raw32);
      const decrypted = await decrypt(encrypted, raw32);
      expect(decrypted).toBe(TEST_API_KEY);
    });
  });

  describe("decrypt input format variations", () => {
    it("decrypts from combined base64 string", async () => {
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      const decrypted = await decrypt(encrypted.combinedB64, TEST_MASTER_KEY);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("decrypts from combined Uint8Array", async () => {
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      const decrypted = await decrypt(encrypted.combined, TEST_MASTER_KEY);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("decrypts from EncryptedPayload object with base64 strings", async () => {
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      const payload = {
        ciphertext: encrypted.ciphertextB64,
        nonce: encrypted.nonceB64,
      };
      const decrypted = await decrypt(payload, TEST_MASTER_KEY);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("decrypts from EncryptedPayload object with Uint8Array buffers", async () => {
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      const payload = {
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
      };
      const decrypted = await decrypt(payload, TEST_MASTER_KEY);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("decrypts from separate positional bytes", async () => {
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      const decrypted = await decrypt(encrypted.ciphertext, TEST_MASTER_KEY, encrypted.nonce);
      expect(decrypted).toBe(TEST_API_KEY);
    });
  });

  describe("security & tamper resistance", () => {
    it("throws DecryptionError when ciphertext bit is tampered", async () => {
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      const corruptedCiphertext = new Uint8Array(encrypted.ciphertext);
      corruptedCiphertext[0] ^= 0x01; // flip 1 bit

      await expect(
        decrypt(corruptedCiphertext, TEST_MASTER_KEY, encrypted.nonce)
      ).rejects.toThrow(DecryptionError);
    });

    it("throws DecryptionError when nonce bit is tampered", async () => {
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      const corruptedNonce = new Uint8Array(encrypted.nonce);
      corruptedNonce[0] ^= 0x01;

      await expect(
        decrypt(encrypted.ciphertext, TEST_MASTER_KEY, corruptedNonce)
      ).rejects.toThrow(DecryptionError);
    });

    it("throws DecryptionError when authentication tag is tampered", async () => {
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      const corruptedCiphertext = new Uint8Array(encrypted.ciphertext);
      // In AES-GCM, the last 16 bytes are the auth tag
      corruptedCiphertext[corruptedCiphertext.length - 1] ^= 0x01;

      await expect(
        decrypt(corruptedCiphertext, TEST_MASTER_KEY, encrypted.nonce)
      ).rejects.toThrow(DecryptionError);
    });

    it("throws DecryptionError when decrypted with wrong master key", async () => {
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      await expect(
        decrypt(encrypted, "wrong-master-key-passphrase!!!")
      ).rejects.toThrow(DecryptionError);
    });

    it("throws DecryptionError when combined payload is too short", async () => {
      // Minimum is 12 (nonce) + 16 (tag) = 28 bytes
      const shortBytes = new Uint8Array(20);
      await expect(decrypt(shortBytes, TEST_MASTER_KEY)).rejects.toThrow(DecryptionError);
    });

    it("throws DecryptionError when nonce length is invalid", async () => {
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      const badNonce = new Uint8Array(10); // 10 instead of 12
      await expect(
        decrypt(encrypted.ciphertext, TEST_MASTER_KEY, badNonce)
      ).rejects.toThrow(DecryptionError);
    });

    it("throws DecryptionError for invalid base64 ciphertext input", async () => {
      await expect(
        decrypt("!!!not-valid-base64!!!", TEST_MASTER_KEY, generateNonce())
      ).rejects.toThrow(DecryptionError);
    });

    it("throws DecryptionError for empty master key secret during decryption", async () => {
      const encrypted = await encrypt(TEST_API_KEY, TEST_MASTER_KEY);
      await expect(decrypt(encrypted, "")).rejects.toThrow(DecryptionError);
    });

    it("throws EncryptionError for empty master key secret during encryption", async () => {
      await expect(encrypt(TEST_API_KEY, "")).rejects.toThrow(EncryptionError);
    });
  });

  describe("base64 utilities", () => {
    it("roundtrips bytes to base64 and back", () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 250, 254, 255]);
      const b64 = uint8ArrayToBase64(original);
      const decoded = base64ToUint8Array(b64);
      expect(decoded).toEqual(original);
    });

    it("decodes URL-safe base64 strings with - and _", () => {
      // standard: "+/==" vs url-safe: "-_"
      const standard = new Uint8Array([251, 255, 254]); // base64: "+//+"
      const b64 = uint8ArrayToBase64(standard);
      const urlSafe = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      const decoded = base64ToUint8Array(urlSafe);
      expect(decoded).toEqual(standard);
    });
  });

  describe("hashToken", () => {
    it("produces correct SHA-256 hex string for a token", async () => {
      // Known SHA-256 test vector: sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      const emptyHash = await hashToken("");
      expect(emptyHash).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );

      // Known SHA-256 for "hello world"
      // b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
      const helloHash = await hashToken("hello world");
      expect(helloHash).toBe(
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
      );
    });

    it("returns a 64-character lowercase hex string", async () => {
      const hash = await hashToken("kc-auth-token-xyz-12345");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
