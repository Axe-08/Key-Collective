/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests for Durable Object Key Decryption (TASK-DOP-02)
 *
 * Verifies:
 * - AES-256-GCM Decryption using Web Crypto API.
 * - Nonce must strictly be 12-bytes (96 bits) invariant.
 * - Tamper resistance and authentication tag validation.
 * - Strict type safety, error boundaries, and environment fallback.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_KEY_LENGTH_BYTES,
  MASTER_KEY_ENV_VAR,
  NONCE_LENGTH_BYTES,
  TAG_LENGTH_BYTES,
} from "../constants/crypto";
import {
  DecryptionError,
  EncryptionError,
  InvalidKeyError,
} from "../errors/key_errors";
import {
  decrypt,
  decryptApiKey,
  decryptKey,
  decryptKeyRaw,
  encryptKey,
  isEncryptedKey,
  resolveMasterKey,
  validateNonce,
  type EncryptedKey,
} from "./crypto";
import {
  base64ToUint8Array,
  deriveKey,
  generateNonce,
  uint8ArrayToBase64,
} from "../crypto/encryption";

describe("Durable Object Crypto & AES-256-GCM Decryption (TASK-DOP-02)", () => {
  const TEST_MASTER_KEY = "test-master-secret-key-32bytes-passphrase!!";
  const TEST_API_KEY = "sk-ant-api03-abcdef1234567890-XYZ987654321";
  const TEST_TENANT_ID = "tenant_acme_corp";
  const TEST_PROVIDER = "anthropic";

  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[MASTER_KEY_ENV_VAR];
    delete process.env[MASTER_KEY_ENV_VAR];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env[MASTER_KEY_ENV_VAR] = originalEnv;
    } else {
      delete process.env[MASTER_KEY_ENV_VAR];
    }
  });

  describe("EncryptedKey Contract Structure", () => {
    it("conforms to the exact EncryptedKey interface", async () => {
      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      // Verify exact signature fields
      expect(typeof encrypted.id).toBe("string");
      expect(typeof encrypted.tenantId).toBe("string");
      expect(typeof encrypted.provider).toBe("string");
      expect(typeof encrypted.ciphertext).toBe("string");
      expect(typeof encrypted.nonce).toBe("string");
    });

    it("validates objects using isEncryptedKey type guard", async () => {
      const validKey: EncryptedKey = {
        id: "key_01",
        tenantId: "tenant_01",
        provider: "openai",
        ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
        nonce: uint8ArrayToBase64(new Uint8Array(12)),
      };

      expect(isEncryptedKey(validKey)).toBe(true);
      expect(isEncryptedKey(null)).toBe(false);
      expect(isEncryptedKey(undefined)).toBe(false);
      expect(isEncryptedKey("not-an-object")).toBe(false);
      expect(isEncryptedKey({})).toBe(false);
      expect(isEncryptedKey({ id: "key_1" })).toBe(false);
      expect(isEncryptedKey({ ...validKey, ciphertext: "" })).toBe(false);
      expect(isEncryptedKey({ ...validKey, nonce: "" })).toBe(false);
    });
  });

  describe("AES-256-GCM Decryption (decryptKey)", () => {
    it("decrypts an EncryptedKey using string master secret passphrase", async () => {
      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      const decrypted = await decryptKey(encrypted, TEST_MASTER_KEY);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("decrypts an EncryptedKey using raw 32-byte Uint8Array master key", async () => {
      const raw32 = crypto.getRandomValues(new Uint8Array(ENCRYPTION_KEY_LENGTH_BYTES));
      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        raw32
      );

      const decrypted = await decryptKey(encrypted, raw32);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("decrypts an EncryptedKey using pre-imported CryptoKey", async () => {
      const cryptoKey = await deriveKey(TEST_MASTER_KEY);
      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        cryptoKey
      );

      const decrypted = await decryptKey(encrypted, cryptoKey);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("decrypts UTF-8 unicode keys with emojis and special characters", async () => {
      const complexKey = "sk-key-🔐-日本語-ñoño-test!@#$%^&*()_+";
      const encrypted = await encryptKey(
        complexKey,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      const decrypted = await decryptKey(encrypted, TEST_MASTER_KEY);
      expect(decrypted).toBe(complexKey);
    });

    it("decrypts raw binary payload via decryptKeyRaw", async () => {
      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      const rawDecrypted = await decryptKeyRaw(encrypted, TEST_MASTER_KEY);
      expect(rawDecrypted).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(rawDecrypted)).toBe(TEST_API_KEY);
    });

    it("supports aliases decryptApiKey and decrypt", async () => {
      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      expect(await decryptApiKey(encrypted, TEST_MASTER_KEY)).toBe(TEST_API_KEY);
      expect(await decrypt(encrypted, TEST_MASTER_KEY)).toBe(TEST_API_KEY);
    });

    it("supports positional argument overload: decryptKey(ciphertext, nonce, masterKey)", async () => {
      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      const decrypted = await decryptKey(
        encrypted.ciphertext,
        encrypted.nonce,
        TEST_MASTER_KEY
      );
      expect(decrypted).toBe(TEST_API_KEY);
    });
  });

  describe("Nonce 12-Byte Invariant Enforcement", () => {
    it("validates that a 12-byte nonce succeeds", async () => {
      const nonce12 = generateNonce(NONCE_LENGTH_BYTES);
      expect(nonce12.byteLength).toBe(12);
      expect(validateNonce(nonce12)).toBe(true);
      expect(validateNonce(uint8ArrayToBase64(nonce12))).toBe(true);

      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY,
        { nonce: nonce12 }
      );

      const decrypted = await decryptKey(encrypted, TEST_MASTER_KEY);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("rejects nonces shorter than 12 bytes with DecryptionError", async () => {
      const shortNonce = new Uint8Array(8); // 8 bytes instead of 12
      crypto.getRandomValues(shortNonce);

      const badKey: EncryptedKey = {
        id: "bad_nonce_key",
        tenantId: TEST_TENANT_ID,
        provider: TEST_PROVIDER,
        ciphertext: uint8ArrayToBase64(new Uint8Array(32)),
        nonce: uint8ArrayToBase64(shortNonce),
      };

      await expect(decryptKey(badKey, TEST_MASTER_KEY)).rejects.toThrow(
        DecryptionError
      );
      await expect(decryptKey(badKey, TEST_MASTER_KEY)).rejects.toThrow(
        /Invalid nonce length: expected 12 bytes/
      );
    });

    it("rejects nonces longer than 12 bytes with DecryptionError", async () => {
      const longNonce = new Uint8Array(16); // 16 bytes instead of 12
      crypto.getRandomValues(longNonce);

      const badKey: EncryptedKey = {
        id: "bad_long_nonce_key",
        tenantId: TEST_TENANT_ID,
        provider: TEST_PROVIDER,
        ciphertext: uint8ArrayToBase64(new Uint8Array(32)),
        nonce: uint8ArrayToBase64(longNonce),
      };

      await expect(decryptKey(badKey, TEST_MASTER_KEY)).rejects.toThrow(
        DecryptionError
      );
      await expect(decryptKey(badKey, TEST_MASTER_KEY)).rejects.toThrow(
        /Invalid nonce length: expected 12 bytes/
      );
    });

    it("rejects non-base64 corrupted nonce with DecryptionError", async () => {
      const badKey: EncryptedKey = {
        id: "corrupted_nonce_key",
        tenantId: TEST_TENANT_ID,
        provider: TEST_PROVIDER,
        ciphertext: uint8ArrayToBase64(new Uint8Array(32)),
        nonce: "!!NOT_BASE_64!!",
      };

      await expect(decryptKey(badKey, TEST_MASTER_KEY)).rejects.toThrow(
        DecryptionError
      );
    });

    it("rejects empty nonce string with DecryptionError", async () => {
      const badKey: EncryptedKey = {
        id: "empty_nonce_key",
        tenantId: TEST_TENANT_ID,
        provider: TEST_PROVIDER,
        ciphertext: uint8ArrayToBase64(new Uint8Array(32)),
        nonce: "",
      };

      await expect(decryptKey(badKey, TEST_MASTER_KEY)).rejects.toThrow(
        DecryptionError
      );
    });

    it("validateNonce helper correctly evaluates nonces", () => {
      expect(validateNonce(new Uint8Array(12))).toBe(true);
      expect(validateNonce(new Uint8Array(8))).toBe(false);
      expect(validateNonce(new Uint8Array(16))).toBe(false);
      expect(validateNonce(uint8ArrayToBase64(new Uint8Array(12)))).toBe(true);
      expect(validateNonce(uint8ArrayToBase64(new Uint8Array(10)))).toBe(false);
      expect(validateNonce("invalid-b64-string!@#")).toBe(false);
    });
  });

  describe("Tamper Resistance & Cryptographic Tag Verification", () => {
    it("throws DecryptionError when ciphertext bit is tampered", async () => {
      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      const rawCiphertext = base64ToUint8Array(encrypted.ciphertext);
      rawCiphertext[0] ^= 0x01; // flip single bit
      const tamperedKey: EncryptedKey = {
        ...encrypted,
        ciphertext: uint8ArrayToBase64(rawCiphertext),
      };

      await expect(decryptKey(tamperedKey, TEST_MASTER_KEY)).rejects.toThrow(
        DecryptionError
      );
    });

    it("throws DecryptionError when nonce bit is tampered", async () => {
      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      const rawNonce = base64ToUint8Array(encrypted.nonce);
      rawNonce[0] ^= 0x01; // flip single bit
      const tamperedKey: EncryptedKey = {
        ...encrypted,
        nonce: uint8ArrayToBase64(rawNonce),
      };

      await expect(decryptKey(tamperedKey, TEST_MASTER_KEY)).rejects.toThrow(
        DecryptionError
      );
    });

    it("throws DecryptionError when authentication tag is corrupted", async () => {
      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      const rawCiphertext = base64ToUint8Array(encrypted.ciphertext);
      // Corrupt the final byte of the 16-byte authentication tag
      rawCiphertext[rawCiphertext.length - 1] ^= 0xff;
      const tamperedKey: EncryptedKey = {
        ...encrypted,
        ciphertext: uint8ArrayToBase64(rawCiphertext),
      };

      await expect(decryptKey(tamperedKey, TEST_MASTER_KEY)).rejects.toThrow(
        DecryptionError
      );
    });

    it("throws DecryptionError when decrypted with wrong master key", async () => {
      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      await expect(
        decryptKey(encrypted, "incorrect-master-key-passphrase-999!")
      ).rejects.toThrow(DecryptionError);
    });

    it("throws DecryptionError when ciphertext is shorter than 16-byte tag", async () => {
      const shortCiphertext = new Uint8Array(10); // Less than 16 bytes
      const badKey: EncryptedKey = {
        id: "short_ciphertext",
        tenantId: TEST_TENANT_ID,
        provider: TEST_PROVIDER,
        ciphertext: uint8ArrayToBase64(shortCiphertext),
        nonce: uint8ArrayToBase64(new Uint8Array(12)),
      };

      await expect(decryptKey(badKey, TEST_MASTER_KEY)).rejects.toThrow(
        DecryptionError
      );
      await expect(decryptKey(badKey, TEST_MASTER_KEY)).rejects.toThrow(
        /Ciphertext too short/
      );
    });
  });

  describe("Master Key Resolution & Environment Variable Fallback", () => {
    it("uses KC_MASTER_KEY environment variable if masterKey parameter is omitted", async () => {
      process.env[MASTER_KEY_ENV_VAR] = TEST_MASTER_KEY;

      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      const decrypted = await decryptKey(encrypted);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("throws DecryptionError when no master key is provided and env var is not set", async () => {
      delete process.env[MASTER_KEY_ENV_VAR];

      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      await expect(decryptKey(encrypted)).rejects.toThrow(DecryptionError);
      await expect(decryptKey(encrypted)).rejects.toThrow(
        /Master encryption key not provided/
      );
    });

    it("throws DecryptionError when empty string master key is provided", async () => {
      const encrypted = await encryptKey(
        TEST_API_KEY,
        TEST_TENANT_ID,
        TEST_PROVIDER,
        TEST_MASTER_KEY
      );

      await expect(decryptKey(encrypted, "")).rejects.toThrow(DecryptionError);
    });
  });

  describe("Input Validation & Error Edge Cases", () => {
    it("throws DecryptionError if null or non-object is passed", async () => {
      await expect(
        decryptKey(null as unknown as EncryptedKey, TEST_MASTER_KEY)
      ).rejects.toThrow(DecryptionError);
    });

    it("throws DecryptionError if ciphertext is empty", async () => {
      const emptyCiphertextKey: EncryptedKey = {
        id: "empty_ct",
        tenantId: TEST_TENANT_ID,
        provider: TEST_PROVIDER,
        ciphertext: "",
        nonce: uint8ArrayToBase64(new Uint8Array(12)),
      };

      await expect(
        decryptKey(emptyCiphertextKey, TEST_MASTER_KEY)
      ).rejects.toThrow(DecryptionError);
    });

    it("throws EncryptionError if encryptKey is called with empty plaintext", async () => {
      await expect(
        encryptKey("", TEST_TENANT_ID, TEST_PROVIDER, TEST_MASTER_KEY)
      ).rejects.toThrow(EncryptionError);
    });

    it("throws InvalidKeyError if encryptKey is called with empty tenantId or provider", async () => {
      await expect(
        encryptKey(TEST_API_KEY, "", TEST_PROVIDER, TEST_MASTER_KEY)
      ).rejects.toThrow(InvalidKeyError);
      await expect(
        encryptKey(TEST_API_KEY, TEST_TENANT_ID, "", TEST_MASTER_KEY)
      ).rejects.toThrow(InvalidKeyError);
    });
  });
});
