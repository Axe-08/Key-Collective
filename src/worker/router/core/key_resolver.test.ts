import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveTenantKey, encrypt } from "../../../crypto/encryption/index";
import { encryptKey } from "../../../durable_objects/crypto";
import { KeyDecryptionError } from "../../../errors/key_errors";
import type { WorkerEnv } from "../../auth/index";
import { evict, clearDecryptedKeyCache, resolveLeasedKey, resolvePlaintextKey } from "./key_resolver";

describe("Strict Upstream Key Decryption (WP-4.4 T-4.4.1)", () => {
  const MASTER_KEY = "super-secret-master-key-for-tests-12345";
  const TENANT_A = "usr_tenant_alpha_001";
  const TENANT_B = "usr_tenant_beta_002";

  beforeEach(() => {
    clearDecryptedKeyCache();
  });

  it("decrypts keys encrypted with deriveTenantKey from D1 for matching tenant", async () => {
    const rawPlaintext = "AIzaSyRealDecryptedSecretKey999";
    const tenantKey = await deriveTenantKey(MASTER_KEY, TENANT_A);
    const { ciphertextB64, nonceB64 } = await encrypt(rawPlaintext, tenantKey);

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: async () => ({
            id: "key_gemini_test",
            tenant_id: TENANT_A,
            provider: "google",
            encrypted_key_b64: ciphertextB64,
            nonce_b64: nonceB64,
            hkdf_migrated: 1,
            status: "HEALTHY",
          }),
        }),
      }),
    };

    const env = {
      DB: mockDb,
      KC_MASTER_KEY: MASTER_KEY,
    } as unknown as WorkerEnv;

    const resolved = await resolveLeasedKey(
      { keyId: "key_gemini_test", ownerTenantId: TENANT_A, provider: "google" },
      env
    );
    expect(resolved).toBe(rawPlaintext);
  });

  it("unmigrated row (hkdf_migrated=0): throws KeyDecryptionError and quarantines key without attempting legacy decryption (T-7.6.1)", async () => {
    const rawPlaintext = "gsk_LegacySecretKey888";
    const encrypted = await encryptKey(rawPlaintext, "default", "groq", MASTER_KEY);

    let quarantinedKeyId: string | null = null;

    const mockDb = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: unknown[]) => ({
          first: async () => {
            if (sql.includes("SELECT")) {
              return {
                id: "key_legacy_001",
                tenant_id: TENANT_A,
                provider: "groq",
                encrypted_key_b64: encrypted.ciphertext,
                nonce_b64: encrypted.nonce,
                hkdf_migrated: 0,
                status: "HEALTHY",
              };
            }
            return null;
          },
          run: async () => {
            if (sql.includes("QUARANTINED")) {
              quarantinedKeyId = args[1] as string;
            }
            return { success: true };
          },
        })),
      })),
    };

    const env = {
      DB: mockDb,
      KC_MASTER_KEY: MASTER_KEY,
    } as unknown as WorkerEnv;

    await expect(
      resolveLeasedKey(
        { keyId: "key_legacy_001", ownerTenantId: TENANT_A, provider: "groq" },
        env
      )
    ).rejects.toThrow(KeyDecryptionError);
    expect(quarantinedKeyId).toBe("key_legacy_001");
  });

  it("caches decrypted key in-memory by keyId:nonce and invalidates on evict(keyId)", async () => {
    const rawPlaintext = "AIzaSyCachedKey777";
    const tenantKey = await deriveTenantKey(MASTER_KEY, TENANT_A);
    const { ciphertextB64, nonceB64 } = await encrypt(rawPlaintext, tenantKey);

    let queryCount = 0;
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: async () => {
            queryCount++;
            return {
              id: "key_cached_test",
              tenant_id: TENANT_A,
              provider: "google",
              encrypted_key_b64: ciphertextB64,
              nonce_b64: nonceB64,
              hkdf_migrated: 1,
              status: "HEALTHY",
            };
          },
        }),
      }),
    };

    const env = {
      DB: mockDb,
      KC_MASTER_KEY: MASTER_KEY,
    } as unknown as WorkerEnv;

    const first = await resolveLeasedKey(
      { keyId: "key_cached_test", ownerTenantId: TENANT_A, provider: "google" },
      env
    );
    expect(first).toBe(rawPlaintext);

    // Second call hits cache
    const second = await resolveLeasedKey(
      { keyId: "key_cached_test", ownerTenantId: TENANT_A, provider: "google" },
      env
    );
    expect(second).toBe(rawPlaintext);

    // Evict key from cache
    evict("key_cached_test");

    const third = await resolveLeasedKey(
      { keyId: "key_cached_test", ownerTenantId: TENANT_A, provider: "google" },
      env
    );
    expect(third).toBe(rawPlaintext);
  });

  it("AC-07: throws KeyDecryptionError and quarantines key if ciphertext of tenant A is accessed with tenant B ownerTenantId", async () => {
    const rawPlaintext = "AIzaSyTenantASecretKey001";
    const tenantKeyA = await deriveTenantKey(MASTER_KEY, TENANT_A);
    const { ciphertextB64, nonceB64 } = await encrypt(rawPlaintext, tenantKeyA);

    let quarantinedKeyId: string | null = null;
    const mockDb = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: unknown[]) => ({
          first: async () => ({
            id: "key_tenant_a",
            tenant_id: TENANT_A,
            provider: "google",
            encrypted_key_b64: ciphertextB64,
            nonce_b64: nonceB64,
            hkdf_migrated: 1,
            status: "HEALTHY",
          }),
          run: async () => {
            if (sql.includes("QUARANTINED")) {
              quarantinedKeyId = args[1] as string;
            }
            return { success: true };
          },
        })),
      })),
    };

    const env = {
      DB: mockDb,
      KC_MASTER_KEY: MASTER_KEY,
    } as unknown as WorkerEnv;

    await expect(
      resolveLeasedKey(
        { keyId: "key_tenant_a", ownerTenantId: TENANT_B, provider: "google" },
        env
      )
    ).rejects.toThrow(KeyDecryptionError);

    expect(quarantinedKeyId).toBe("key_tenant_a");
  });

  it("corrupted ciphertext: throws KeyDecryptionError and quarantines key without returning key ID", async () => {
    let quarantined = false;
    const mockDb = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: async () => ({
            id: "key_corrupt_001",
            tenant_id: TENANT_A,
            provider: "groq",
            encrypted_key_b64: "not-valid-base64-or-corrupted-ciphertext",
            nonce_b64: "bm9uY2UxMjM0NTY=",
            hkdf_migrated: 1,
            status: "HEALTHY",
          }),
          run: async () => {
            if (sql.includes("QUARANTINED")) {
              quarantined = true;
            }
            return { success: true };
          },
        })),
      })),
    };

    const env = {
      DB: mockDb,
      KC_MASTER_KEY: MASTER_KEY,
    } as unknown as WorkerEnv;

    await expect(
      resolveLeasedKey(
        { keyId: "key_corrupt_001", ownerTenantId: TENANT_A, provider: "groq" },
        env
      )
    ).rejects.toThrow(KeyDecryptionError);

    expect(quarantined).toBe(true);
  });
});
