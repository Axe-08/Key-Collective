/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Repository Tests: API Key D1 Repository (on real D1)
 *
 * Invariants & Standards:
 * - No Plaintext Keys: AES-256-GCM encryption via Web Crypto API with unique 12-byte nonces.
 * - Raw database storage never contains plaintext keys.
 * - Per-Tenant Isolation: Complete compute & memory separation.
 * - Strict TypeScript: No `any`, strict null checks.
 * - Real D1 execution via Cloudflare Workers Vitest Pool.
 */

// @ts-expect-error - cloudflare:test provided by @cloudflare/vitest-pool-workers
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { NONCE_LENGTH_BYTES } from "../../../src/constants/crypto";
import { base64ToUint8Array } from "../../../src/crypto/encryption/index";
import {
  DecryptionError,
  EncryptionError,
  InvalidKeyError,
  KeyNotFoundError,
} from "../../../src/errors/key_errors";
import {
  APIKeyRow,
  ApiKeyRepository,
  ApiKeysRepository,
  mapRowToAPIKey,
} from "../../../src/storage/repositories/api_keys/index";
import { KeyStatus } from "../../../src/types/models";

const canonicalStatus = (status: "HEALTHY" | "COOLDOWN" | "QUARANTINED" | "REVOKED"): KeyStatus =>
  status as unknown as KeyStatus;

describe("ApiKeyRepository (storage-repo-keys on real D1)", () => {
  const MASTER_KEY = "test-super-secret-master-key-32bytes!";
  const ALT_MASTER_KEY = "alternative-master-secret-key-32b!";
  const TENANT_A = "tenant-alpha";
  const TENANT_B = "tenant-beta";
  const SAMPLE_API_KEY = "sk-ant-test-abcdef123456-998877";

  let repo: ApiKeyRepository;

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM api_keys").run();
    repo = new ApiKeyRepository(env.DB, MASTER_KEY);
  });

  describe("Architectural Invariant: No Plaintext Keys in D1 (AES-256-GCM)", () => {
    it("encrypts plaintext API keys with AES-256-GCM and unique 12-byte nonces", async () => {
      const key = await repo.create({
        tenantId: TENANT_A,
        label: "Anthropic Main",
        provider: "anthropic",
        plaintextKey: SAMPLE_API_KEY,
      });

      expect(key.id).toBeDefined();
      expect(key.tenantId).toBe(TENANT_A);
      expect(key.provider).toBe("anthropic");

      // Verify raw database row has NO plaintext
      const rawRow = await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?")
        .bind(key.id)
        .first<Record<string, unknown>>();
      expect(rawRow).toBeDefined();
      if (!rawRow) return;

      const encryptedKeyB64 = rawRow.encrypted_key_b64 as string;
      const nonceB64 = rawRow.nonce_b64 as string;

      expect(encryptedKeyB64).toBeDefined();
      expect(encryptedKeyB64).not.toBe(SAMPLE_API_KEY);
      expect(encryptedKeyB64.length).toBeGreaterThan(0);

      // Verify 12-byte nonce (96-bit AES-GCM requirement)
      const nonceBytes = base64ToUint8Array(nonceB64);
      expect(nonceBytes.byteLength).toBe(NONCE_LENGTH_BYTES);
      expect(nonceBytes.byteLength).toBe(12);

      // Ensure plaintext does NOT appear anywhere in the database row values
      const rowValues = Object.values(rawRow).join(" ");
      expect(rowValues).not.toContain(SAMPLE_API_KEY);

      // Verify masking (first 6 chars, last 4 chars)
      expect(rawRow.key_prefix).toBe("sk-ant");
      expect(rawRow.key_suffix).toBe("8877");
    });

    it("generates distinct nonces and ciphertexts for identical plaintext keys (IV uniqueness)", async () => {
      const key1 = await repo.create({
        tenantId: TENANT_A,
        label: "Key 1",
        provider: "openai",
        plaintextKey: "sk-proj-duplicate-secret-key-123456",
      });

      const key2 = await repo.create({
        tenantId: TENANT_A,
        label: "Key 2",
        provider: "openai",
        plaintextKey: "sk-proj-duplicate-secret-key-123456",
      });

      expect(key1.nonceB64).not.toBe(key2.nonceB64);
      expect(key1.encryptedKeyB64).not.toBe(key2.encryptedKeyB64);
    });

    it("allows ApiKeysRepository alias instantiation", () => {
      const aliasRepo = new ApiKeysRepository(env.DB, MASTER_KEY);
      expect(aliasRepo).toBeInstanceOf(ApiKeyRepository);
    });
  });

  describe("CRUD: Creation & Defaults", () => {
    it("applies default values for rpmLimit (60), rpdLimit (1500), priority (0), status (HEALTHY)", async () => {
      const key = await repo.create({
        tenantId: TENANT_A,
        label: "Default Config Key",
        provider: "gemini",
        plaintextKey: "AIzaSy-gemini-sample-key-12345678",
      });

      expect(key.rpmLimit).toBe(60);
      expect(key.rpdLimit).toBe(1500);
      expect(key.priority).toBe(0);
      expect(key.status).toBe("HEALTHY");
      expect(key.circuitOpenUntil).toBeNull();
      expect(key.lastUsedAt).toBeNull();
      expect(typeof key.createdAt).toBe("number");
      expect(key.createdAt as unknown as number).toBeGreaterThan(1700000000000);

      const rawRow = await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?")
        .bind(key.id)
        .first<Record<string, unknown>>();
      expect(rawRow?.status).toBe("HEALTHY");
      expect(rawRow?.pool_type).toBe("PRIVATE");
      expect(typeof rawRow?.created_at).toBe("number");
      expect(rawRow?.created_at).toBe(key.createdAt);
    });

    it("persists custom configuration values when specified", async () => {
      const customId = "custom-uuid-001";
      const key = await repo.create({
        id: customId,
        tenantId: TENANT_A,
        label: "High Throughput Groq",
        provider: "groq",
        plaintextKey: "gsk_groq_api_key_production_high_rpm",
        rpmLimit: 600,
        rpdLimit: 20000,
        priority: 50,
        status: canonicalStatus("HEALTHY"),
        circuitOpenUntil: "2026-09-10T00:00:00Z",
      });

      expect(key.id).toBe(customId);
      expect(key.rpmLimit).toBe(600);
      expect(key.rpdLimit).toBe(20000);
      expect(key.priority).toBe(50);
      expect(key.status).toBe("HEALTHY");
      const expectedCircuitEpoch = Date.parse("2026-09-10T00:00:00Z");
      expect(key.circuitOpenUntil).toBe(expectedCircuitEpoch);

      const rawRow = await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?")
        .bind(customId)
        .first<Record<string, unknown>>();
      expect(rawRow?.circuit_open_until).toBe(expectedCircuitEpoch);
      expect(typeof rawRow?.circuit_open_until).toBe("number");
    });

    it("supports insertEncryptedKey for pre-encrypted records", async () => {
      // 12 bytes dummy nonce
      const validNonceB64 = btoa("123456789012");
      const validCiphertextB64 = btoa("dummy-ciphertext-payload-bytes");

      const key = await repo.insertEncryptedKey({
        tenantId: TENANT_A,
        label: "Pre-encrypted Key",
        provider: "cohere",
        encryptedKeyB64: validCiphertextB64,
        nonceB64: validNonceB64,
        keyPrefix: "coh-pr",
        keySuffix: "XYZ9",
      });

      expect(key.id).toBeDefined();
      expect(key.tenantId).toBe(TENANT_A);
      expect(key.status).toBe("HEALTHY");
      expect(key.encryptedKeyB64).toBe(validCiphertextB64);
      expect(key.nonceB64).toBe(validNonceB64);
      expect(typeof key.createdAt).toBe("number");
      expect(key.poolType).toBe("PRIVATE");

      const rawRow = await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?")
        .bind(key.id)
        .first<Record<string, unknown>>();
      expect(rawRow?.status).toBe("HEALTHY");
      expect(rawRow?.pool_type).toBe("PRIVATE");
      expect(typeof rawRow?.created_at).toBe("number");
    });

    it("rejects insertEncryptedKey if nonce length is not 12 bytes", async () => {
      const invalidNonceB64 = btoa("short-nonce"); // 11 bytes
      await expect(
        repo.insertEncryptedKey({
          tenantId: TENANT_A,
          label: "Invalid Nonce",
          provider: "openai",
          encryptedKeyB64: btoa("ciphertext"),
          nonceB64: invalidNonceB64,
        })
      ).rejects.toThrow(InvalidKeyError);
    });
  });

  describe("Decryption & Key Recovery", () => {
    it("successfully decrypts stored key using decryptKey and getDecryptedKey", async () => {
      const created = await repo.create({
        tenantId: TENANT_A,
        label: "OpenAI Secret",
        provider: "openai",
        plaintextKey: SAMPLE_API_KEY,
      });

      const decryptedViaEntity = await repo.decryptKey(created);
      expect(decryptedViaEntity).toBe(SAMPLE_API_KEY);

      const decryptedViaLookup = await repo.getDecryptedKey(created.id, TENANT_A);
      expect(decryptedViaLookup).toBe(SAMPLE_API_KEY);
    });

    it("allows method-level override of master key during decryption", async () => {
      const repoNoKey = new ApiKeyRepository(env.DB);

      const created = await repoNoKey.create(
        {
          tenantId: TENANT_A,
          label: "Method Key Secret",
          provider: "anthropic",
          plaintextKey: "sk-ant-method-key-plaintext-value-1234",
        },
        ALT_MASTER_KEY
      );

      const decrypted = await repoNoKey.decryptKey(created, ALT_MASTER_KEY);
      expect(decrypted).toBe("sk-ant-method-key-plaintext-value-1234");
    });

    it("throws DecryptionError when attempting to decrypt with incorrect master key", async () => {
      const created = await repo.create({
        tenantId: TENANT_A,
        label: "Encrypted With Key 1",
        provider: "openai",
        plaintextKey: SAMPLE_API_KEY,
      });

      await expect(repo.decryptKey(created, "wrong-master-key-passphrase-here!!")).rejects.toThrow(
        DecryptionError
      );
    });

    it("throws DecryptionError if ciphertext is tampered", async () => {
      const created = await repo.create({
        tenantId: TENANT_A,
        label: "Tampered Target",
        provider: "gemini",
        plaintextKey: SAMPLE_API_KEY,
      });

      // Tamper ciphertext
      const tamperedKey = {
        ...created,
        encryptedKeyB64: btoa("corrupted-ciphertext-garbage-bytes-tag-invalid"),
      };

      await expect(repo.decryptKey(tamperedKey)).rejects.toThrow(DecryptionError);
    });

    it("throws DecryptionError if no master key is supplied", async () => {
      const repoNoKey = new ApiKeyRepository(env.DB);
      const created = await repo.create({
        tenantId: TENANT_A,
        label: "No Key Test",
        provider: "groq",
        plaintextKey: SAMPLE_API_KEY,
      });

      await expect(repoNoKey.decryptKey(created)).rejects.toThrow(DecryptionError);
    });
  });

  describe("Retrieval: getById, getByIdOrThrow & Tenant Boundary Isolation", () => {
    it("retrieves an existing key by ID", async () => {
      const created = await repo.create({
        tenantId: TENANT_A,
        label: "Lookup Key",
        provider: "deepseek",
        plaintextKey: "ds-api-key-1234567890",
      });

      const fetched = await repo.getById(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.label).toBe("Lookup Key");
      expect(fetched?.status).toBe("HEALTHY");
      expect(typeof fetched?.createdAt).toBe("number");
    });

    it("returns null for non-existent key with getById", async () => {
      const result = await repo.getById("non-existent-uuid");
      expect(result).toBeNull();
    });

    it("throws KeyNotFoundError for non-existent key with getByIdOrThrow", async () => {
      await expect(repo.getByIdOrThrow("missing-uuid")).rejects.toThrow(KeyNotFoundError);
    });

    it("enforces tenant boundary on getById and getByIdOrThrow (cross-tenant isolation)", async () => {
      const keyA = await repo.create({
        tenantId: TENANT_A,
        label: "Tenant A Secret Key",
        provider: "openai",
        plaintextKey: "sk-proj-tenant-a-private-key-1234",
      });

      // Fetching with Tenant B scoping must return null / throw KeyNotFoundError
      const crossTenantFetch = await repo.getById(keyA.id, TENANT_B);
      expect(crossTenantFetch).toBeNull();

      await expect(repo.getByIdOrThrow(keyA.id, TENANT_B)).rejects.toThrow(KeyNotFoundError);
    });
  });

  describe("Listing & Active Key Filtering", () => {
    beforeEach(async () => {
      // Seed keys for Tenant A
      await repo.create({
        tenantId: TENANT_A,
        label: "OpenAI Primary",
        provider: "openai",
        plaintextKey: "sk-proj-openai-pri-1234567890",
        priority: 10,
        status: canonicalStatus("HEALTHY"),
        createdAt: "2026-09-01T10:00:00Z",
      });
      await repo.create({
        tenantId: TENANT_A,
        label: "OpenAI Fallback",
        provider: "openai",
        plaintextKey: "sk-proj-openai-sec-1234567890",
        priority: 5,
        status: canonicalStatus("HEALTHY"),
        createdAt: "2026-09-01T11:00:00Z",
      });
      await repo.create({
        tenantId: TENANT_A,
        label: "OpenAI Quarantined",
        provider: "openai",
        plaintextKey: "sk-proj-openai-dis-1234567890",
        priority: 1,
        status: canonicalStatus("QUARANTINED"),
        createdAt: "2026-09-01T12:00:00Z",
      });
      await repo.create({
        tenantId: TENANT_A,
        label: "Anthropic Primary",
        provider: "anthropic",
        plaintextKey: "sk-ant-primary-123456789012",
        priority: 20,
        status: canonicalStatus("COOLDOWN"),
        createdAt: "2026-09-01T09:00:00Z",
      });

      // Seed key for Tenant B (should be completely isolated)
      await repo.create({
        tenantId: TENANT_B,
        label: "Tenant B OpenAI",
        provider: "openai",
        plaintextKey: "sk-proj-tenant-b-only-123456",
        priority: 100,
        status: canonicalStatus("HEALTHY"),
      });
    });

    it("lists only keys belonging to the requested tenant", async () => {
      const tenantAKeys = await repo.listByTenant(TENANT_A);
      expect(tenantAKeys.length).toBe(4);
      expect(tenantAKeys.every((k) => k.tenantId === TENANT_A)).toBe(true);

      const tenantBKeys = await repo.listByTenant(TENANT_B);
      expect(tenantBKeys.length).toBe(1);
      expect(tenantBKeys[0].tenantId).toBe(TENANT_B);
      expect(tenantBKeys[0].label).toBe("Tenant B OpenAI");
    });

    it("filters keys by provider", async () => {
      const openaiKeys = await repo.listByTenant(TENANT_A, { provider: "openai" });
      expect(openaiKeys.length).toBe(3);
      expect(openaiKeys.every((k) => k.provider === "openai")).toBe(true);
    });

    it("filters keys by status", async () => {
      const healthyKeys = await repo.listByTenant(TENANT_A, { status: canonicalStatus("HEALTHY") });
      expect(healthyKeys.length).toBe(2);

      const cooldownKeys = await repo.listByTenant(TENANT_A, { status: canonicalStatus("COOLDOWN") });
      expect(cooldownKeys.length).toBe(1);
      expect(cooldownKeys[0].provider).toBe("anthropic");
    });

    it("orders keys by priority DESC, created_at ASC", async () => {
      const keys = await repo.listByTenant(TENANT_A);
      expect(keys[0].priority).toBe(20); // Anthropic Primary
      expect(keys[1].priority).toBe(10); // OpenAI Primary
      expect(keys[2].priority).toBe(5);  // OpenAI Fallback
      expect(keys[3].priority).toBe(1);  // OpenAI Quarantined
    });

    it("supports pagination with limit and offset", async () => {
      const page1 = await repo.listByTenant(TENANT_A, { limit: 2, offset: 0 });
      expect(page1.length).toBe(2);
      expect(page1[0].label).toBe("Anthropic Primary");
      expect(page1[1].label).toBe("OpenAI Primary");

      const page2 = await repo.listByTenant(TENANT_A, { limit: 2, offset: 2 });
      expect(page2.length).toBe(2);
      expect(page2[0].label).toBe("OpenAI Fallback");
      expect(page2[1].label).toBe("OpenAI Quarantined");
    });

    it("getActiveKeysForProvider filters out non-active keys and sorts by priority", async () => {
      const activeOpenai = await repo.getActiveKeysForProvider(TENANT_A, "openai");
      // OpenAI has 2 healthy and 1 quarantined
      expect(activeOpenai.length).toBe(3);
      expect(activeOpenai[0].priority).toBe(10);
      expect(activeOpenai[1].priority).toBe(5);
    });
  });

  describe("Update, Status Mutation & Key Rotation", () => {
    it("updates metadata fields (label, rpmLimit, rpdLimit, priority, status)", async () => {
      const created = await repo.create({
        tenantId: TENANT_A,
        label: "Initial Label",
        provider: "gemini",
        plaintextKey: "AIzaSy-gemini-initial-12345678",
        rpmLimit: 60,
        rpdLimit: 1500,
        priority: 0,
      });

      const updated = await repo.update(created.id, TENANT_A, {
        label: "Renamed Production Gemini",
        rpmLimit: 300,
        rpdLimit: 5000,
        priority: 25,
        status: canonicalStatus("COOLDOWN"),
        circuitOpenUntil: "2026-09-15T12:00:00Z",
      });

      expect(updated.label).toBe("Renamed Production Gemini");
      expect(updated.rpmLimit).toBe(300);
      expect(updated.rpdLimit).toBe(5000);
      expect(updated.priority).toBe(25);
      expect(updated.status).toBe("COOLDOWN");
      const expectedCircuit = Date.parse("2026-09-15T12:00:00Z");
      expect(updated.circuitOpenUntil).toBe(expectedCircuit);

      // Verify persistent in real D1
      const fetched = await repo.getByIdOrThrow(created.id, TENANT_A);
      expect(fetched.label).toBe("Renamed Production Gemini");
      expect(fetched.rpmLimit).toBe(300);
      expect(fetched.status).toBe("COOLDOWN");
      expect(fetched.circuitOpenUntil).toBe(expectedCircuit);

      const rawRow = await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?")
        .bind(created.id)
        .first<Record<string, unknown>>();
      expect(rawRow?.status).toBe("COOLDOWN");
      expect(rawRow?.circuit_open_until).toBe(expectedCircuit);
      expect(typeof rawRow?.circuit_open_until).toBe("number");
    });

    it("rotates key plaintext when plaintextKey is passed to update", async () => {
      const originalKey = "sk-ant-original-key-1234567890";
      const rotatedKey = "sk-ant-rotated-new-key-0987654321";

      const created = await repo.create({
        tenantId: TENANT_A,
        label: "Rotatable Key",
        provider: "anthropic",
        plaintextKey: originalKey,
      });

      const oldCiphertext = created.encryptedKeyB64;
      const oldNonce = created.nonceB64;

      const updated = await repo.update(created.id, TENANT_A, {
        plaintextKey: rotatedKey,
      });

      expect(updated.encryptedKeyB64).not.toBe(oldCiphertext);
      expect(updated.nonceB64).not.toBe(oldNonce);

      // Verify decrypting now yields the new key
      const decrypted = await repo.decryptKey(updated);
      expect(decrypted).toBe(rotatedKey);
    });

    it("updates status and circuit cooldown via updateStatus", async () => {
      const created = await repo.create({
        tenantId: TENANT_A,
        label: "Circuit Breaker Key",
        provider: "openai",
        plaintextKey: SAMPLE_API_KEY,
      });

      const cooldown = "2026-09-09T23:59:59Z";
      await repo.updateStatus(created.id, TENANT_A, canonicalStatus("COOLDOWN"), cooldown);

      const fetched = await repo.getByIdOrThrow(created.id, TENANT_A);
      expect(fetched.status).toBe("COOLDOWN");
      expect(fetched.circuitOpenUntil).toBe(Date.parse(cooldown));

      const rawRow = await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?")
        .bind(created.id)
        .first<Record<string, unknown>>();
      expect(rawRow?.status).toBe("COOLDOWN");
      expect(rawRow?.circuit_open_until).toBe(Date.parse(cooldown));
      expect(typeof rawRow?.circuit_open_until).toBe("number");
    });

    it("records last used timestamp via recordUsage", async () => {
      const created = await repo.create({
        tenantId: TENANT_A,
        label: "Usage Tracking Key",
        provider: "together",
        plaintextKey: "together-api-key-sample-1234",
      });

      expect(created.lastUsedAt).toBeNull();

      const timestamp = "2026-09-09T22:30:00Z";
      await repo.recordUsage(created.id, TENANT_A, timestamp);

      const fetched = await repo.getByIdOrThrow(created.id, TENANT_A);
      expect(fetched.lastUsedAt).toBe(Date.parse(timestamp));

      const rawRow = await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?")
        .bind(created.id)
        .first<Record<string, unknown>>();
      expect(rawRow?.last_used_at).toBe(Date.parse(timestamp));
      expect(typeof rawRow?.last_used_at).toBe("number");
    });

    it("throws KeyNotFoundError when updating non-existent key or wrong tenant", async () => {
      await expect(
        repo.update("missing-key", TENANT_A, { label: "Test" })
      ).rejects.toThrow(KeyNotFoundError);

      const created = await repo.create({
        tenantId: TENANT_A,
        label: "Tenant A Only",
        provider: "openai",
        plaintextKey: SAMPLE_API_KEY,
      });

      // Tenant B cannot update Tenant A's key
      await expect(
        repo.update(created.id, TENANT_B, { label: "Hacked" })
      ).rejects.toThrow(KeyNotFoundError);
    });
  });

  describe("Deletion & Counting", () => {
    it("deletes a key within tenant boundary", async () => {
      const created = await repo.create({
        tenantId: TENANT_A,
        label: "To Delete",
        provider: "openai",
        plaintextKey: SAMPLE_API_KEY,
      });

      const deleted = await repo.delete(created.id, TENANT_A);
      expect(deleted).toBe(true);

      const check = await repo.getById(created.id, TENANT_A);
      expect(check).toBeNull();
    });

    it("returns false and preserves key if delete attempted with mismatched tenant ID", async () => {
      const created = await repo.create({
        tenantId: TENANT_A,
        label: "Tenant A Guarded",
        provider: "openai",
        plaintextKey: SAMPLE_API_KEY,
      });

      const deleted = await repo.delete(created.id, TENANT_B);
      expect(deleted).toBe(false);

      const stillExists = await repo.getById(created.id, TENANT_A);
      expect(stillExists).not.toBeNull();
    });

    it("accurately counts tenant keys with countByTenant", async () => {
      expect(await repo.countByTenant(TENANT_A)).toBe(0);

      await repo.create({
        tenantId: TENANT_A,
        label: "Key 1",
        provider: "openai",
        plaintextKey: SAMPLE_API_KEY,
        status: canonicalStatus("HEALTHY"),
      });
      await repo.create({
        tenantId: TENANT_A,
        label: "Key 2",
        provider: "openai",
        plaintextKey: SAMPLE_API_KEY,
        status: canonicalStatus("QUARANTINED"),
      });
      await repo.create({
        tenantId: TENANT_A,
        label: "Key 3",
        provider: "anthropic",
        plaintextKey: SAMPLE_API_KEY,
        status: canonicalStatus("HEALTHY"),
      });

      expect(await repo.countByTenant(TENANT_A)).toBe(3);
      expect(await repo.countByTenant(TENANT_A, { provider: "openai" })).toBe(2);
      expect(await repo.countByTenant(TENANT_A, { provider: "anthropic" })).toBe(1);
      expect(await repo.countByTenant(TENANT_A, { status: canonicalStatus("HEALTHY") })).toBe(2);
      expect(await repo.countByTenant(TENANT_A, { status: canonicalStatus("QUARANTINED") })).toBe(1);
    });
  });

  describe("Input Validation & Error Edge Cases", () => {
    it("rejects empty tenantId with InvalidKeyError", async () => {
      await expect(
        repo.create({
          tenantId: "",
          label: "Test",
          provider: "openai",
          plaintextKey: SAMPLE_API_KEY,
        })
      ).rejects.toThrow(InvalidKeyError);
    });

    it("rejects empty plaintextKey with InvalidKeyError", async () => {
      await expect(
        repo.create({
          tenantId: TENANT_A,
          label: "Test",
          provider: "openai",
          plaintextKey: "   ",
        })
      ).rejects.toThrow(InvalidKeyError);
    });

    it("rejects empty label with InvalidKeyError", async () => {
      await expect(
        repo.create({
          tenantId: TENANT_A,
          label: "",
          provider: "openai",
          plaintextKey: SAMPLE_API_KEY,
        })
      ).rejects.toThrow(InvalidKeyError);
    });

    it("rejects invalid rpmLimit with InvalidKeyError", async () => {
      await expect(
        repo.create({
          tenantId: TENANT_A,
          label: "Test",
          provider: "openai",
          plaintextKey: SAMPLE_API_KEY,
          rpmLimit: 0,
        })
      ).rejects.toThrow(InvalidKeyError);

      await expect(
        repo.create({
          tenantId: TENANT_A,
          label: "Test",
          provider: "openai",
          plaintextKey: SAMPLE_API_KEY,
          rpmLimit: -10,
        })
      ).rejects.toThrow(InvalidKeyError);
    });

    it("rejects invalid status with InvalidKeyError", async () => {
      await expect(
        repo.create({
          tenantId: TENANT_A,
          label: "Test",
          provider: "openai",
          plaintextKey: SAMPLE_API_KEY,
          status: "BogusStatus" as unknown as KeyStatus,
        })
      ).rejects.toThrow(InvalidKeyError);
    });

    it("throws EncryptionError if master key is missing when encrypting", async () => {
      const repoNoKey = new ApiKeyRepository(env.DB);
      await expect(
        repoNoKey.create({
          tenantId: TENANT_A,
          label: "No Master Key",
          provider: "openai",
          plaintextKey: SAMPLE_API_KEY,
        })
      ).rejects.toThrow(EncryptionError);
    });
  });

  describe("mapRowToAPIKey Helper", () => {
    it("maps snake_case D1 row to camelCase domain APIKey", () => {
      const row: APIKeyRow = {
        id: "row-1",
        tenant_id: "tenant-x",
        label: "Row Label",
        provider: "groq",
        encrypted_key_b64: "Y2lwaGVydGV4dA==",
        nonce_b64: "MTIzNDU2Nzg5MDEy",
        key_prefix: "gsk_12",
        key_suffix: "9900",
        rpm_limit: 120,
        rpd_limit: 3000,
        priority: 15,
        status: "Healthy",
        circuit_open_until: null,
        last_used_at: "2026-09-01T00:00:00Z",
        created_at: "2026-08-01T00:00:00Z",
      };

      const mapped = mapRowToAPIKey(row);
      expect(mapped.id).toBe("row-1");
      expect(mapped.tenantId).toBe("tenant-x");
      expect(mapped.encryptedKeyB64).toBe("Y2lwaGVydGV4dA==");
      expect(mapped.nonceB64).toBe("MTIzNDU2Nzg5MDEy");
      expect(mapped.keyPrefix).toBe("gsk_12");
      expect(mapped.keySuffix).toBe("9900");
      expect(mapped.rpmLimit).toBe(120);
      expect(mapped.rpdLimit).toBe(3000);
      expect(mapped.priority).toBe(15);
      // status is normalised via normaliseKeyStatus: raw "Healthy" -> canonical "HEALTHY"
      expect(mapped.status).toBe("HEALTHY");
      expect(mapped.status).not.toBe("Healthy");
      expect(mapped.circuitOpenUntil).toBeNull();
      // timestamps are normalised via toEpochMs: ISO-8601 strings -> epoch-ms numbers
      expect(mapped.lastUsedAt).toBe(Date.parse("2026-09-01T00:00:00Z"));
      expect(mapped.lastUsedAt).not.toBe("2026-09-01T00:00:00Z");
      expect(typeof mapped.lastUsedAt).toBe("number");
      expect(mapped.createdAt).toBe(Date.parse("2026-08-01T00:00:00Z"));
      expect(mapped.createdAt).not.toBe("2026-08-01T00:00:00Z");
      expect(typeof mapped.createdAt).toBe("number");
    });

    it("normalises pool_type and preserves null passthrough for optional timestamps", () => {
      const row: APIKeyRow = {
        id: "row-2",
        tenant_id: "tenant-y",
        label: "Row Label 2",
        provider: "groq",
        encrypted_key_b64: "Y2lwaGVydGV4dA==",
        nonce_b64: "MTIzNDU2Nzg5MDEy",
        key_prefix: "gsk_12",
        key_suffix: "9900",
        rpm_limit: 60,
        rpd_limit: 1500,
        priority: 0,
        status: "quarantined",
        circuit_open_until: null,
        last_used_at: null,
        created_at: "2026-08-01T00:00:00Z",
        pool_type: "community",
        observation_until: null,
      };

      const mapped = mapRowToAPIKey(row);
      expect(mapped.status).toBe("QUARANTINED");
      expect(mapped.poolType).toBe("COMMUNITY");
      expect(mapped.poolType).not.toBe("community");
      expect(mapped.circuitOpenUntil).toBeNull();
      expect(mapped.lastUsedAt).toBeNull();
      expect(mapped.observationUntil).toBeNull();
    });
  });
});
