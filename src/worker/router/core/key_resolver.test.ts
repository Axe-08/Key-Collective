import { beforeEach, describe, expect, it } from "vitest";
import { deriveTenantKey, encrypt } from "../../../crypto/encryption";
import { encryptKey } from "../../../durable_objects/crypto";
import { clearDecryptedKeyCache, resolvePlaintextKey } from "./key_resolver";

describe("Upstream Key Decryption & Resolution (resolvePlaintextKey)", () => {
  const MASTER_KEY = "super-secret-master-key-for-tests-12345";
  const TEST_TENANT = "usr_gh_123456";

  beforeEach(() => {
    clearDecryptedKeyCache();
  });

  it("passes through raw API keys directly without DB lookup", async () => {
    const googleKey = "AIzaSyDummyGoogleKey123456789";
    const groqKey = "gsk_DummyGroqKey123456789";
    const openaiKey = "sk-proj-DummyOpenAIKey123456789";

    const emptyEnv = {} as any;

    expect(await resolvePlaintextKey(googleKey, "google", TEST_TENANT, emptyEnv, MASTER_KEY)).toBe(googleKey);
    expect(await resolvePlaintextKey(groqKey, "groq", TEST_TENANT, emptyEnv, MASTER_KEY)).toBe(groqKey);
    expect(await resolvePlaintextKey(openaiKey, "openai", TEST_TENANT, emptyEnv, MASTER_KEY)).toBe(openaiKey);
  });

  it("decrypts keys encrypted with deriveTenantKey from D1", async () => {
    const rawPlaintext = "AIzaSyRealDecryptedSecretKey999";
    const tenantKey = await deriveTenantKey(MASTER_KEY, TEST_TENANT);
    const { ciphertextB64, nonceB64 } = await encrypt(rawPlaintext, tenantKey);

    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => ({
            id: "key_gemini_test",
            encrypted_key_b64: ciphertextB64,
            nonce_b64: nonceB64,
            tenant_id: TEST_TENANT,
            provider: "google",
          }),
        }),
      }),
    };

    const env = {
      DB: mockDb,
      KC_MASTER_KEY: MASTER_KEY,
    } as any;

    const resolved = await resolvePlaintextKey("key_gemini_test", "google", TEST_TENANT, env);
    expect(resolved).toBe(rawPlaintext);
  });

  it("decrypts keys encrypted directly with masterKey from D1", async () => {
    const rawPlaintext = "gsk_AnotherRealSecretKey888";
    const encrypted = await encryptKey(rawPlaintext, "default", "groq", MASTER_KEY);

    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => ({
            id: "key_groq_direct",
            encrypted_key_b64: encrypted.ciphertext,
            nonce_b64: encrypted.nonce,
            tenant_id: "default",
            provider: "groq",
          }),
        }),
      }),
    };

    const env = {
      DB: mockDb,
      KC_MASTER_KEY: MASTER_KEY,
    } as any;

    const resolved = await resolvePlaintextKey("key_groq_direct", "groq", TEST_TENANT, env);
    expect(resolved).toBe(rawPlaintext);
  });

  it("caches decrypted key in-memory for subsequent calls", async () => {
    const rawPlaintext = "AIzaSyCachedKey777";
    const tenantKey = await deriveTenantKey(MASTER_KEY, TEST_TENANT);
    const { ciphertextB64, nonceB64 } = await encrypt(rawPlaintext, tenantKey);

    let queryCount = 0;
    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            queryCount++;
            return {
              id: "key_cached_test",
              encrypted_key_b64: ciphertextB64,
              nonce_b64: nonceB64,
              tenant_id: TEST_TENANT,
              provider: "google",
            };
          },
        }),
      }),
    };

    const env = {
      DB: mockDb,
      KC_MASTER_KEY: MASTER_KEY,
    } as any;

    const first = await resolvePlaintextKey("key_cached_test", "google", TEST_TENANT, env);
    expect(first).toBe(rawPlaintext);
    expect(queryCount).toBe(1);

    // Second call should hit in-memory cache without D1 query
    const second = await resolvePlaintextKey("key_cached_test", "google", TEST_TENANT, env);
    expect(second).toBe(rawPlaintext);
    expect(queryCount).toBe(1);
  });
});
