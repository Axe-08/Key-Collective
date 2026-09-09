/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: API Key D1 Repository (storage-repo-keys)
 *
 * Invariants & Standards:
 * - No Plaintext Keys: AES-256-GCM encryption via Web Crypto API with unique 12-byte nonces.
 * - Raw database storage never contains plaintext keys.
 * - Per-Tenant Isolation: Complete compute & memory separation.
 * - Strict TypeScript: No `any`, strict null checks.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { NONCE_LENGTH_BYTES } from "../../../src/constants/crypto";
import { base64ToUint8Array } from "../../../src/crypto/encryption";
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
  CreateApiKeyInput,
  mapRowToAPIKey,
} from "../../../src/storage/repositories/apiKeys";
import { KeyStatus, isAPIKey } from "../../../src/types/models";

/**
 * In-memory Mock implementation of Cloudflare D1Database for unit testing.
 */
class MockD1Database implements D1Database {
  public rows = new Map<string, APIKeyRow>();

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const stmt of statements) {
      results.push(await stmt.run<T>());
    }
    return results;
  }

  async exec(_query: string): Promise<D1ExecResult> {
    return { count: 1, duration: 1 };
  }

  withSession(): D1DatabaseSession {
    throw new Error("withSession not implemented in mock");
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}


function createMeta(changes = 0): D1Meta & Record<string, unknown> {
  return {
    changes,
    duration: 1,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: 0,
    changed_db: changes > 0,
  };
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private boundParams: unknown[] = [];

  constructor(
    private readonly query: string,
    private readonly db: MockD1Database
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundParams = values;
    return this;
  }

  async first<T = Record<string, unknown>>(_colName?: string): Promise<T | null> {
    const res = await this.all<T>();
    return res.results[0] ?? null;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(_options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]> {
    throw new Error("raw not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    const trimmed = this.query.trim();
    const upper = trimmed.toUpperCase().replace(/\s+/g, " ");

    if (upper.startsWith("INSERT INTO API_KEYS")) {
      const [
        id,
        tenant_id,
        label,
        provider,
        encrypted_key_b64,
        nonce_b64,
        key_prefix,
        key_suffix,
        rpm_limit,
        rpd_limit,
        priority,
        status,
        circuit_open_until,
        created_at_or_last_used,
        created_at_if_15,
      ] = this.boundParams;

      let last_used_at: string | null = null;
      let created_at: string;
      if (this.boundParams.length === 15) {
        last_used_at = (created_at_or_last_used as string | null) ?? null;
        created_at = created_at_if_15 as string;
      } else {
        created_at = created_at_or_last_used as string;
      }

      const row: APIKeyRow = {
        id: String(id),
        tenant_id: String(tenant_id),
        label: String(label),
        provider: String(provider),
        encrypted_key_b64: String(encrypted_key_b64),
        nonce_b64: String(nonce_b64),
        key_prefix: String(key_prefix),
        key_suffix: String(key_suffix),
        rpm_limit: Number(rpm_limit),
        rpd_limit: Number(rpd_limit),
        priority: Number(priority),
        status: String(status),
        circuit_open_until: (circuit_open_until as string | null) ?? null,
        last_used_at,
        created_at: String(created_at),
      };

      this.db.rows.set(row.id, row);
      return {
        success: true,
        meta: createMeta(1),
        results: [row as unknown as T],
      };
    }

    if (upper.startsWith("SELECT COUNT(*)")) {
      const tenantId = this.boundParams[0] as string;
      let rows = Array.from(this.db.rows.values()).filter(
        (r) => r.tenant_id === tenantId
      );
      if (upper.includes("AND PROVIDER = ?")) {
        const provider = this.boundParams[1] as string;
        rows = rows.filter((r) => r.provider === provider);
      }
      if (upper.includes("AND STATUS = ?")) {
        const statusIdx = upper.includes("AND PROVIDER = ?") ? 2 : 1;
        const status = this.boundParams[statusIdx] as string;
        rows = rows.filter((r) => r.status === status);
      }
      return {
        success: true,
        meta: createMeta(0),
        results: [{ count: rows.length } as unknown as T],
      };
    }

    if (upper.startsWith("SELECT * FROM API_KEYS WHERE ID = ?")) {
      const id = this.boundParams[0] as string;
      let row = this.db.rows.get(id);
      if (row && upper.includes("AND TENANT_ID = ?")) {
        const tenantId = this.boundParams[1] as string;
        if (row.tenant_id !== tenantId) {
          row = undefined;
        }
      }
      return {
        success: true,
        meta: createMeta(0),
        results: row ? [row as unknown as T] : [],
      };
    }

    if (upper.startsWith("SELECT * FROM API_KEYS WHERE TENANT_ID = ?")) {
      const tenantId = this.boundParams[0] as string;
      let rows = Array.from(this.db.rows.values()).filter(
        (r) => r.tenant_id === tenantId
      );

      let paramIdx = 1;
      if (upper.includes("AND PROVIDER = ?")) {
        const provider = this.boundParams[paramIdx++] as string;
        rows = rows.filter((r) => r.provider === provider);
      }
      if (upper.includes("AND STATUS = ?")) {
        const status = this.boundParams[paramIdx++] as string;
        rows = rows.filter((r) => r.status === status);
      }
      if (upper.includes("STATUS NOT IN ('DISABLED', 'DISABLED')")) {
        rows = rows.filter(
          (r) => r.status !== "Disabled" && r.status !== "disabled"
        );
      }

      // Order by priority DESC, created_at ASC
      rows.sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return a.created_at.localeCompare(b.created_at);
      });

      if (upper.includes("LIMIT ?")) {
        const limit = this.boundParams[paramIdx++] as number;
        if (upper.includes("OFFSET ?")) {
          const offset = this.boundParams[paramIdx++] as number;
          rows = rows.slice(offset, offset + limit);
        } else {
          rows = rows.slice(0, limit);
        }
      }

      return {
        success: true,
        meta: createMeta(0),
        results: rows as unknown as T[],
      };
    }

    if (upper.startsWith("UPDATE API_KEYS SET STATUS = ?")) {
      const status = this.boundParams[0] as string;
      const circuitOpenUntil = this.boundParams[1] as string | null;
      const id = this.boundParams[2] as string;
      const tenantId = this.boundParams[3] as string;

      const row = this.db.rows.get(id);
      if (row && row.tenant_id === tenantId) {
        row.status = status;
        row.circuit_open_until = circuitOpenUntil;
        return {
          success: true,
          meta: createMeta(1),
          results: [],
        };
      }
      return {
        success: true,
        meta: createMeta(0),
        results: [],
      };
    }

    if (upper.startsWith("UPDATE API_KEYS SET LAST_USED_AT = ?")) {
      const ts = this.boundParams[0] as string;
      const id = this.boundParams[1] as string;
      const row = this.db.rows.get(id);
      if (row) {
        if (this.boundParams.length > 2) {
          const tenantId = this.boundParams[2] as string;
          if (row.tenant_id !== tenantId) {
            return { success: true, meta: createMeta(0), results: [] };
          }
        }
        row.last_used_at = ts;
        return { success: true, meta: createMeta(1), results: [] };
      }
      return { success: true, meta: createMeta(0), results: [] };
    }

    if (upper.startsWith("UPDATE API_KEYS SET LABEL = ?")) {
      const [
        label,
        encrypted_key_b64,
        nonce_b64,
        key_prefix,
        key_suffix,
        rpm_limit,
        rpd_limit,
        priority,
        status,
        circuit_open_until,
        id,
        tenant_id,
      ] = this.boundParams;

      const row = this.db.rows.get(id as string);
      if (row && row.tenant_id === (tenant_id as string)) {
        row.label = String(label);
        row.encrypted_key_b64 = String(encrypted_key_b64);
        row.nonce_b64 = String(nonce_b64);
        row.key_prefix = String(key_prefix);
        row.key_suffix = String(key_suffix);
        row.rpm_limit = Number(rpm_limit);
        row.rpd_limit = Number(rpd_limit);
        row.priority = Number(priority);
        row.status = String(status);
        row.circuit_open_until = (circuit_open_until as string | null) ?? null;
        return { success: true, meta: createMeta(1), results: [] };
      }
      return { success: true, meta: createMeta(0), results: [] };
    }

    if (upper.startsWith("DELETE FROM API_KEYS WHERE ID = ? AND TENANT_ID = ?")) {
      const id = this.boundParams[0] as string;
      const tenantId = this.boundParams[1] as string;
      const row = this.db.rows.get(id);
      if (row && row.tenant_id === tenantId) {
        this.db.rows.delete(id);
        return { success: true, meta: createMeta(1), results: [] };
      }
      return { success: true, meta: createMeta(0), results: [] };
    }

    throw new Error(`Unhandled mock query: ${this.query}`);
  }
}

describe("ApiKeyRepository (storage-repo-keys)", () => {
  const MASTER_KEY = "test-super-secret-master-key-32bytes!";
  const ALT_MASTER_KEY = "alternative-master-secret-key-32b!";
  const TENANT_A = "tenant-alpha";
  const TENANT_B = "tenant-beta";
  const SAMPLE_API_KEY = "sk-ant-api03-abcdef1234567890XYZW-998877";

  let db: MockD1Database;
  let repo: ApiKeyRepository;

  beforeEach(() => {
    db = new MockD1Database();
    repo = new ApiKeyRepository(db, MASTER_KEY);
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
      const rawRow = db.rows.get(key.id);
      expect(rawRow).toBeDefined();
      if (!rawRow) return;

      expect(rawRow.encrypted_key_b64).toBeDefined();
      expect(rawRow.encrypted_key_b64).not.toBe(SAMPLE_API_KEY);
      expect(rawRow.encrypted_key_b64.length).toBeGreaterThan(0);

      // Verify 12-byte nonce (96-bit AES-GCM requirement)
      const nonceBytes = base64ToUint8Array(rawRow.nonce_b64);
      expect(nonceBytes.byteLength).toBe(NONCE_LENGTH_BYTES);
      expect(nonceBytes.byteLength).toBe(12);

      // Ensure plaintext does NOT appear anywhere in the database row values
      const rowValues = Object.values(rawRow).join(" ");
      expect(rowValues).not.toContain(SAMPLE_API_KEY);

      // Verify masking (first 6 chars, last 4 chars per ADR 002)
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
      const aliasRepo = new ApiKeysRepository(db, MASTER_KEY);
      expect(aliasRepo).toBeInstanceOf(ApiKeyRepository);
    });
  });

  describe("CRUD: Creation & Defaults", () => {
    it("applies default values for rpmLimit (60), rpdLimit (1500), priority (0), status (Healthy)", async () => {
      const key = await repo.create({
        tenantId: TENANT_A,
        label: "Default Config Key",
        provider: "gemini",
        plaintextKey: "AIzaSy-gemini-sample-key-12345678",
      });

      expect(key.rpmLimit).toBe(60);
      expect(key.rpdLimit).toBe(1500);
      expect(key.priority).toBe(0);
      expect(key.status).toBe("Healthy");
      expect(key.circuitOpenUntil).toBeNull();
      expect(key.lastUsedAt).toBeNull();
      expect(isAPIKey(key)).toBe(true);
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
        status: "Healthy",
        circuitOpenUntil: "2026-09-10T00:00:00Z",
      });

      expect(key.id).toBe(customId);
      expect(key.rpmLimit).toBe(600);
      expect(key.rpdLimit).toBe(20000);
      expect(key.priority).toBe(50);
      expect(key.circuitOpenUntil).toBe("2026-09-10T00:00:00Z");
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
      expect(key.encryptedKeyB64).toBe(validCiphertextB64);
      expect(key.nonceB64).toBe(validNonceB64);
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
      const repoNoKey = new ApiKeyRepository(db);

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
      const repoNoKey = new ApiKeyRepository(db);
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
        status: "Healthy",
        createdAt: "2026-09-01T10:00:00Z",
      });
      await repo.create({
        tenantId: TENANT_A,
        label: "OpenAI Fallback",
        provider: "openai",
        plaintextKey: "sk-proj-openai-sec-1234567890",
        priority: 5,
        status: "Healthy",
        createdAt: "2026-09-01T11:00:00Z",
      });
      await repo.create({
        tenantId: TENANT_A,
        label: "OpenAI Disabled",
        provider: "openai",
        plaintextKey: "sk-proj-openai-dis-1234567890",
        priority: 1,
        status: "Disabled",
        createdAt: "2026-09-01T12:00:00Z",
      });
      await repo.create({
        tenantId: TENANT_A,
        label: "Anthropic Primary",
        provider: "anthropic",
        plaintextKey: "sk-ant-primary-123456789012",
        priority: 20,
        status: "RateLimited",
        createdAt: "2026-09-01T09:00:00Z",
      });

      // Seed key for Tenant B (should be completely isolated)
      await repo.create({
        tenantId: TENANT_B,
        label: "Tenant B OpenAI",
        provider: "openai",
        plaintextKey: "sk-proj-tenant-b-only-123456",
        priority: 100,
        status: "Healthy",
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
      const healthyKeys = await repo.listByTenant(TENANT_A, { status: "Healthy" });
      expect(healthyKeys.length).toBe(2);

      const rateLimitedKeys = await repo.listByTenant(TENANT_A, { status: "RateLimited" });
      expect(rateLimitedKeys.length).toBe(1);
      expect(rateLimitedKeys[0].provider).toBe("anthropic");
    });

    it("orders keys by priority DESC, created_at ASC", async () => {
      const keys = await repo.listByTenant(TENANT_A);
      expect(keys[0].priority).toBe(20); // Anthropic Primary
      expect(keys[1].priority).toBe(10); // OpenAI Primary
      expect(keys[2].priority).toBe(5);  // OpenAI Fallback
      expect(keys[3].priority).toBe(1);  // OpenAI Disabled
    });

    it("supports pagination with limit and offset", async () => {
      const page1 = await repo.listByTenant(TENANT_A, { limit: 2, offset: 0 });
      expect(page1.length).toBe(2);
      expect(page1[0].label).toBe("Anthropic Primary");
      expect(page1[1].label).toBe("OpenAI Primary");

      const page2 = await repo.listByTenant(TENANT_A, { limit: 2, offset: 2 });
      expect(page2.length).toBe(2);
      expect(page2[0].label).toBe("OpenAI Fallback");
      expect(page2[1].label).toBe("OpenAI Disabled");
    });

    it("getActiveKeysForProvider filters out Disabled keys and sorts by priority", async () => {
      const activeOpenai = await repo.getActiveKeysForProvider(TENANT_A, "openai");
      // OpenAI has 2 healthy and 1 disabled
      expect(activeOpenai.length).toBe(2);
      expect(activeOpenai[0].priority).toBe(10);
      expect(activeOpenai[1].priority).toBe(5);
      expect(activeOpenai.map((k) => k.status)).not.toContain("Disabled");
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
        status: "Degraded",
        circuitOpenUntil: "2026-09-15T12:00:00Z",
      });

      expect(updated.label).toBe("Renamed Production Gemini");
      expect(updated.rpmLimit).toBe(300);
      expect(updated.rpdLimit).toBe(5000);
      expect(updated.priority).toBe(25);
      expect(updated.status).toBe("Degraded");
      expect(updated.circuitOpenUntil).toBe("2026-09-15T12:00:00Z");

      // Verify persistent in D1
      const fetched = await repo.getByIdOrThrow(created.id, TENANT_A);
      expect(fetched.label).toBe("Renamed Production Gemini");
      expect(fetched.rpmLimit).toBe(300);
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
      await repo.updateStatus(created.id, TENANT_A, "RateLimited", cooldown);

      const fetched = await repo.getByIdOrThrow(created.id, TENANT_A);
      expect(fetched.status).toBe("RateLimited");
      expect(fetched.circuitOpenUntil).toBe(cooldown);
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
      expect(fetched.lastUsedAt).toBe(timestamp);
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
        status: "Healthy",
      });
      await repo.create({
        tenantId: TENANT_A,
        label: "Key 2",
        provider: "openai",
        plaintextKey: SAMPLE_API_KEY,
        status: "Disabled",
      });
      await repo.create({
        tenantId: TENANT_A,
        label: "Key 3",
        provider: "anthropic",
        plaintextKey: SAMPLE_API_KEY,
        status: "Healthy",
      });

      expect(await repo.countByTenant(TENANT_A)).toBe(3);
      expect(await repo.countByTenant(TENANT_A, { provider: "openai" })).toBe(2);
      expect(await repo.countByTenant(TENANT_A, { provider: "anthropic" })).toBe(1);
      expect(await repo.countByTenant(TENANT_A, { status: "Healthy" })).toBe(2);
      expect(await repo.countByTenant(TENANT_A, { status: "Disabled" })).toBe(1);
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
      const repoNoKey = new ApiKeyRepository(db);
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
      expect(mapped.status).toBe("Healthy");
      expect(mapped.circuitOpenUntil).toBeNull();
      expect(mapped.lastUsedAt).toBe("2026-09-01T00:00:00Z");
      expect(mapped.createdAt).toBe("2026-08-01T00:00:00Z");
      expect(isAPIKey(mapped)).toBe(true);
    });
  });
});
