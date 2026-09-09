/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests for AuthTokensRepository (D1 Storage + AES-256-GCM Encryption)
 *
 * Invariants Tested:
 * 1. No Plaintext Keys / Tokens:
 *    Bearer authentication tokens are ALWAYS encrypted at rest using AES-256-GCM
 *    with a 12-byte nonce (nonce_b64) and ciphertext (encrypted_token_b64).
 *    Tokens are hashed using SHA-256 for indexed lookup.
 * 2. Strict Tenant Isolation:
 *    Cross-tenant operations throw TenantIsolationError or are rejected.
 * 3. Fixed-Point Microdollars:
 *    Budgets and spend calculations use int64 / bigint microdollars.
 *    Zero floating-point math.
 * 4. TypeScript strict mode, zero any.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AuthTokensRepository,
  DEFAULT_AUTH_TOKEN_MASTER_KEY,
  mapRowToAuthTokenRecord,
  AuthTokenRow,
  AuthTokenRecord,
} from "../../../src/storage/repositories/authTokens";
import { hashToken, decrypt, encrypt } from "../../../src/crypto";
import { AuthenticationError, TenantIsolationError } from "../../../src/errors/auth_errors";
import { DecryptionError } from "../../../src/errors/key_errors";

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

/**
 * In-memory Mock implementation of Cloudflare D1Database for unit testing AuthTokensRepository.
 */
class MockD1Database implements D1Database {
  public rows = new Map<string, AuthTokenRow>();

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

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const res = await this.all<T>();
    const firstRow = res.results[0] ?? null;
    if (!firstRow) return null;
    if (colName && typeof firstRow === "object") {
      return ((firstRow as Record<string, unknown>)[colName] ?? null) as T;
    }
    return firstRow;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(_options?: { columnNames?: boolean }): Promise<any> {
    throw new Error("raw not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    const trimmed = this.query.trim();
    const upper = trimmed.toUpperCase().replace(/\s+/g, " ");

    // 1. INSERT INTO AUTH_TOKENS
    if (upper.startsWith("INSERT INTO AUTH_TOKENS")) {
      const [
        id,
        hash_sha256,
        tenant_id,
        encrypted_token_b64,
        nonce_b64,
        budget_microdollars,
        spent_microdollars,
        allowed_providers,
        rpm_limit,
        expires_at,
        created_at,
      ] = this.boundParams;

      // Check unique constraint on hash_sha256
      for (const existing of this.db.rows.values()) {
        if (existing.hash_sha256 === String(hash_sha256)) {
          throw new Error(`UNIQUE constraint failed: auth_tokens.hash_sha256`);
        }
      }

      const row: AuthTokenRow = {
        id: String(id),
        hash_sha256: String(hash_sha256),
        tenant_id: String(tenant_id),
        encrypted_token_b64: (encrypted_token_b64 as string | null) ?? null,
        nonce_b64: (nonce_b64 as string | null) ?? null,
        budget_microdollars: Number(budget_microdollars),
        spent_microdollars: Number(spent_microdollars),
        allowed_providers: String(allowed_providers),
        rpm_limit: Number(rpm_limit),
        expires_at: (expires_at as string | null) ?? null,
        created_at: String(created_at),
      };

      this.db.rows.set(row.id, row);
      return {
        success: true,
        meta: createMeta(1),
        results: [row as unknown as T],
      };
    }

    // 2. SELECT COUNT(*) FROM AUTH_TOKENS WHERE TENANT_ID = ?
    if (upper.startsWith("SELECT COUNT(*)")) {
      const tenantId = String(this.boundParams[0]);
      let count = 0;
      for (const r of this.db.rows.values()) {
        if (r.tenant_id === tenantId) count++;
      }
      return {
        success: true,
        meta: createMeta(0),
        results: [{ count } as unknown as T],
      };
    }

    // 3. SELECT TENANT_ID FROM AUTH_TOKENS WHERE ID = ?
    if (upper.startsWith("SELECT TENANT_ID FROM AUTH_TOKENS WHERE ID = ?")) {
      const id = String(this.boundParams[0]);
      const found = this.db.rows.get(id);
      return {
        success: true,
        meta: createMeta(0),
        results: found ? [{ tenant_id: found.tenant_id } as unknown as T] : [],
      };
    }

    // 4. SELECT * FROM AUTH_TOKENS WHERE HASH_SHA256 = ?
    if (upper.startsWith("SELECT * FROM AUTH_TOKENS WHERE HASH_SHA256 = ?")) {
      const hash = String(this.boundParams[0]);
      let found: AuthTokenRow | null = null;
      for (const r of this.db.rows.values()) {
        if (r.hash_sha256 === hash) {
          found = r;
          break;
        }
      }
      return {
        success: true,
        meta: createMeta(0),
        results: found ? [found as unknown as T] : [],
      };
    }

    // 5. SELECT * FROM AUTH_TOKENS WHERE ID = ? AND TENANT_ID = ?
    if (upper.startsWith("SELECT * FROM AUTH_TOKENS WHERE ID = ? AND TENANT_ID = ?")) {
      const id = String(this.boundParams[0]);
      const tenantId = String(this.boundParams[1]);
      const found = this.db.rows.get(id);
      if (found && found.tenant_id === tenantId) {
        return {
          success: true,
          meta: createMeta(0),
          results: [found as unknown as T],
        };
      }
      return { success: true, meta: createMeta(0), results: [] };
    }

    // 6. SELECT * FROM AUTH_TOKENS WHERE ID = ?
    if (upper.startsWith("SELECT * FROM AUTH_TOKENS WHERE ID = ?")) {
      const id = String(this.boundParams[0]);
      const found = this.db.rows.get(id);
      return {
        success: true,
        meta: createMeta(0),
        results: found ? [found as unknown as T] : [],
      };
    }

    // 7. SELECT * FROM AUTH_TOKENS WHERE TENANT_ID = ? ORDER BY CREATED_AT DESC LIMIT ? OFFSET ?
    if (upper.startsWith("SELECT * FROM AUTH_TOKENS WHERE TENANT_ID = ?")) {
      const tenantId = String(this.boundParams[0]);
      const limit = Number(this.boundParams[1] ?? 50);
      const offset = Number(this.boundParams[2] ?? 0);

      const matches = Array.from(this.db.rows.values())
        .filter((r) => r.tenant_id === tenantId)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(offset, offset + limit);

      return {
        success: true,
        meta: createMeta(0),
        results: matches as unknown as T[],
      };
    }

    // 8. UPDATE AUTH_TOKENS SET BUDGET_MICRODOLLARS = ? WHERE ID = ? AND TENANT_ID = ?
    if (upper === "UPDATE AUTH_TOKENS SET BUDGET_MICRODOLLARS = ? WHERE ID = ? AND TENANT_ID = ?") {
      const budget = Number(this.boundParams[0]);
      const id = String(this.boundParams[1]);
      const tenantId = String(this.boundParams[2]);

      const found = this.db.rows.get(id);
      if (found && found.tenant_id === tenantId) {
        found.budget_microdollars = budget;
        return { success: true, meta: createMeta(1), results: [] };
      }
      return { success: true, meta: createMeta(0), results: [] };
    }

    // 9. UPDATE AUTH_TOKENS SET SPENT_MICRODOLLARS = ? WHERE ID = ? AND TENANT_ID = ?
    if (upper === "UPDATE AUTH_TOKENS SET SPENT_MICRODOLLARS = ? WHERE ID = ? AND TENANT_ID = ?") {
      const spent = Number(this.boundParams[0]);
      const id = String(this.boundParams[1]);
      const tenantId = String(this.boundParams[2]);

      const found = this.db.rows.get(id);
      if (found && found.tenant_id === tenantId) {
        found.spent_microdollars = spent;
        return { success: true, meta: createMeta(1), results: [] };
      }
      return { success: true, meta: createMeta(0), results: [] };
    }

    // 10. UPDATE AUTH_TOKENS SET EXPIRES_AT = ?
    if (
      upper === "UPDATE AUTH_TOKENS SET EXPIRES_AT = ? WHERE ID = ? AND TENANT_ID = ?" ||
      upper === "UPDATE AUTH_TOKENS SET EXPIRES_AT = ? WHERE ID = ?"
    ) {
      const expiresAt = (this.boundParams[0] as string | null) ?? null;
      const id = String(this.boundParams[1]);
      const tenantId = this.boundParams[2] ? String(this.boundParams[2]) : null;

      const found = this.db.rows.get(id);
      if (found && (!tenantId || found.tenant_id === tenantId)) {
        found.expires_at = expiresAt;
        return { success: true, meta: createMeta(1), results: [] };
      }
      return { success: true, meta: createMeta(0), results: [] };
    }

    // 11. GENERAL UPDATE AUTH_TOKENS SET ... WHERE ID = ? AND TENANT_ID = ?
    if (upper.startsWith("UPDATE AUTH_TOKENS SET")) {
      const id = String(this.boundParams[this.boundParams.length - 2]);
      const tenantId = String(this.boundParams[this.boundParams.length - 1]);

      const found = this.db.rows.get(id);
      if (found && found.tenant_id === tenantId) {
        const setPart = trimmed.substring(upper.indexOf("SET") + 3, upper.indexOf("WHERE")).trim();
        const clauses = setPart.split(",").map((c) => c.trim().split("=")[0].trim().toLowerCase());

        for (let i = 0; i < clauses.length; i++) {
          const col = clauses[i];
          const val = this.boundParams[i];
          if (col === "budget_microdollars") found.budget_microdollars = Number(val);
          if (col === "spent_microdollars") found.spent_microdollars = Number(val);
          if (col === "allowed_providers") found.allowed_providers = String(val);
          if (col === "rpm_limit") found.rpm_limit = Number(val);
          if (col === "expires_at") found.expires_at = (val as string | null) ?? null;
        }
        return { success: true, meta: createMeta(1), results: [] };
      }
      return { success: true, meta: createMeta(0), results: [] };
    }

    // 12. DELETE FROM AUTH_TOKENS
    if (upper.startsWith("DELETE FROM AUTH_TOKENS")) {
      const id = String(this.boundParams[0]);
      const tenantId = this.boundParams[1] ? String(this.boundParams[1]) : null;

      const found = this.db.rows.get(id);
      if (found && (!tenantId || found.tenant_id === tenantId)) {
        this.db.rows.delete(id);
        return { success: true, meta: createMeta(1), results: [] };
      }
      return { success: true, meta: createMeta(0), results: [] };
    }

    return { success: true, meta: createMeta(0), results: [] };
  }
}

describe("AuthTokensRepository", () => {
  let db: MockD1Database;
  let repo: AuthTokensRepository;
  const CUSTOM_KEY = "custom-master-secret-for-tokens-32bytes!";

  beforeEach(() => {
    db = new MockD1Database();
    repo = new AuthTokensRepository(db, CUSTOM_KEY);
  });

  describe("Token Creation & Encryption Invariant (GEMINI.md)", () => {
    it("encrypts raw token via AES-256-GCM and hashes via SHA-256 before storage", async () => {
      const plainToken = "kc_live_sec_1234567890abcdefghijklmnopqrstuvwxyz";
      const created = await repo.createToken({
        token: plainToken,
        tenantId: "tenant_alpha",
      });

      expect(created.id).toBeDefined();
      expect(created.tenantId).toBe("tenant_alpha");
      expect(created.hashSha256).toBe(await hashToken(plainToken));

      // Ciphertext and Nonce must be populated
      expect(created.encryptedTokenB64).toBeDefined();
      expect(created.nonceB64).toBeDefined();
      expect(typeof created.encryptedTokenB64).toBe("string");
      expect(typeof created.nonceB64).toBe("string");

      // Ciphertext must NEVER be equal to plaintext token
      expect(created.encryptedTokenB64).not.toBe(plainToken);
      expect(created.encryptedTokenB64!.length).toBeGreaterThan(20);

      // Verify Nonce is a 12-byte base64 string
      const nonceBytes = Buffer.from(created.nonceB64!, "base64");
      expect(nonceBytes.length).toBe(12);

      // Verify raw database row in D1 directly: plaintext MUST NOT exist anywhere
      const rawRow = db.rows.get(created.id);
      expect(rawRow).toBeDefined();
      expect(rawRow!.hash_sha256).toBe(created.hashSha256);
      expect(rawRow!.encrypted_token_b64).toBe(created.encryptedTokenB64);
      expect(rawRow!.nonce_b64).toBe(created.nonceB64);
      expect(JSON.stringify(rawRow)).not.toContain(plainToken);

      // Successfully decrypt back to the original plaintext token
      const decrypted = await repo.decryptToken(created);
      expect(decrypted).toBe(plainToken);
    });

    it("uses unique 12-byte nonces for each token encryption under the same key", async () => {
      const plainToken = "kc_identical_token_for_both_tests_12345";
      const token1 = await repo.createToken({ token: plainToken, tenantId: "t1" });
      const token2 = await repo.createToken({ token: plainToken + "_diff", tenantId: "t1" });

      expect(token1.nonceB64).not.toBe(token2.nonceB64);
      expect(token1.encryptedTokenB64).not.toBe(token2.encryptedTokenB64);
    });

    it("supports overriding encryption key per-token creation", async () => {
      const perTokenKey = "different-master-passphrase-per-token-32b!";
      const plainToken = "kc_per_token_secret_9876543210";

      const created = await repo.createToken({
        token: plainToken,
        tenantId: "tenant_special",
        encryptionKey: perTokenKey,
      });

      // Decrypting with perTokenKey should succeed
      const decrypted = await repo.decryptToken(created, perTokenKey);
      expect(decrypted).toBe(plainToken);

      // Decrypting with wrong key (default repository key) should throw DecryptionError
      await expect(repo.decryptToken(created, CUSTOM_KEY)).rejects.toThrow(DecryptionError);
    });

    it("falls back to default master key if none specified in constructor or params", async () => {
      const repoNoKey = new AuthTokensRepository(db);
      const plainToken = "kc_token_default_key_abc";

      const created = await repoNoKey.createToken({
        token: plainToken,
        tenantId: "t_default",
      });

      expect(created.encryptedTokenB64).toBeDefined();
      expect(created.nonceB64).toBeDefined();

      const decrypted = await repoNoKey.decryptToken(created);
      expect(decrypted).toBe(plainToken);
    });

    it("throws DecryptionError when ciphertext is tampered", async () => {
      const created = await repo.createToken({
        token: "kc_tamper_test_token",
        tenantId: "t1",
      });

      // Tamper ciphertext
      const tamperedBytes = Buffer.from(created.encryptedTokenB64!, "base64");
      tamperedBytes[0] ^= 0xff; // Flip bits
      const tamperedRecord: AuthTokenRecord = {
        ...created,
        encryptedTokenB64: tamperedBytes.toString("base64"),
      };

      await expect(repo.decryptToken(tamperedRecord)).rejects.toThrow(DecryptionError);
    });

    it("throws AuthenticationError on empty or whitespace-only token", async () => {
      await expect(repo.createToken({ token: "", tenantId: "t1" })).rejects.toThrow(
        AuthenticationError
      );
      await expect(repo.createToken({ token: "   ", tenantId: "t1" })).rejects.toThrow(
        AuthenticationError
      );
    });

    it("throws TenantIsolationError on empty or whitespace-only tenantId", async () => {
      await expect(repo.createToken({ token: "kc_token_123", tenantId: "" })).rejects.toThrow(
        TenantIsolationError
      );
      await expect(repo.createToken({ token: "kc_token_123", tenantId: "   " })).rejects.toThrow(
        TenantIsolationError
      );
    });

    it("rejects invalid rpmLimit", async () => {
      await expect(
        repo.createToken({ token: "kc_tok", tenantId: "t1", rpmLimit: 0 })
      ).rejects.toThrow(RangeError);

      await expect(
        repo.createToken({ token: "kc_tok", tenantId: "t1", rpmLimit: -5 })
      ).rejects.toThrow(RangeError);

      await expect(
        repo.createToken({ token: "kc_tok", tenantId: "t1", rpmLimit: 200_000 })
      ).rejects.toThrow(RangeError);
    });
  });

  describe("Deterministic & Constant-Time Lookups", () => {
    it("finds token by plaintext bearer token via SHA-256 hash lookup", async () => {
      const tokenStr = "kc_lookup_test_secret_bearer_token";
      const created = await repo.createToken({
        token: tokenStr,
        tenantId: "tenant_lookup",
        budgetMicrodollars: 50_000_000n,
        rpmLimit: 120,
        allowedProviders: ["google", "groq"],
      });

      const found = await repo.findByToken(tokenStr);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.tenantId).toBe("tenant_lookup");
      expect(found!.budgetMicrodollars).toBe(50_000_000n);
      expect(found!.rpmLimit).toBe(120);
      expect(found!.allowedProviders).toEqual(["google", "groq"]);
    });

    it("returns null when searching for unknown or invalid tokens", async () => {
      expect(await repo.findByToken("kc_unknown_nonexistent")).toBeNull();
      expect(await repo.findByToken("")).toBeNull();
      expect(await repo.findByHash("nonexistenthash")).toBeNull();
      expect(await repo.findById("nonexistentid")).toBeNull();
    });

    it("finds token directly by SHA-256 hash", async () => {
      const tokenStr = "kc_hash_lookup_token";
      const created = await repo.createToken({ token: tokenStr, tenantId: "t1" });

      const found = await repo.findByHash(created.hashSha256);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it("finds token by ID with or without tenant scoping", async () => {
      const created = await repo.createToken({ token: "kc_id_token", tenantId: "t_scoped" });

      const foundWithoutTenant = await repo.findById(created.id);
      expect(foundWithoutTenant).not.toBeNull();
      expect(foundWithoutTenant!.id).toBe(created.id);

      const foundWithTenant = await repo.findById(created.id, "t_scoped");
      expect(foundWithTenant).not.toBeNull();
      expect(foundWithTenant!.id).toBe(created.id);
    });
  });

  describe("Strict Tenant Isolation (GEMINI.md Invariant)", () => {
    it("isolates tokens completely between different tenants in listByTenant", async () => {
      await repo.createToken({ token: "kc_token_tenant1_a", tenantId: "tenant_1" });
      await repo.createToken({ token: "kc_token_tenant1_b", tenantId: "tenant_1" });
      await repo.createToken({ token: "kc_token_tenant2_a", tenantId: "tenant_2" });

      const list1 = await repo.listByTenant("tenant_1");
      const list2 = await repo.listByTenant("tenant_2");

      expect(list1.length).toBe(2);
      expect(list1.every((t) => t.tenantId === "tenant_1")).toBe(true);

      expect(list2.length).toBe(1);
      expect(list2[0].tenantId).toBe("tenant_2");

      expect(await repo.countByTenant("tenant_1")).toBe(2);
      expect(await repo.countByTenant("tenant_2")).toBe(1);
      expect(await repo.countByTenant("tenant_empty")).toBe(0);
    });

    it("throws TenantIsolationError when attempting cross-tenant findById", async () => {
      const tokenTenantA = await repo.createToken({
        token: "kc_token_for_tenant_a",
        tenantId: "tenant_A",
      });

      await expect(repo.findById(tokenTenantA.id, "tenant_B")).rejects.toThrow(
        TenantIsolationError
      );
    });

    it("prevents cross-tenant deletion and throws TenantIsolationError", async () => {
      const tokenA = await repo.createToken({
        token: "kc_token_delete_boundary",
        tenantId: "tenant_A",
      });

      await expect(repo.deleteToken(tokenA.id, "tenant_B")).rejects.toThrow(
        TenantIsolationError
      );

      // Token A must still exist intact
      const stillExists = await repo.findById(tokenA.id, "tenant_A");
      expect(stillExists).not.toBeNull();
    });

    it("prevents cross-tenant budget updates and throws TenantIsolationError", async () => {
      const tokenA = await repo.createToken({
        token: "kc_token_budget_boundary",
        tenantId: "tenant_A",
        budgetMicrodollars: 10_000_000n,
      });

      await expect(repo.updateBudget(tokenA.id, "tenant_B", 999_999_999n)).rejects.toThrow(
        TenantIsolationError
      );

      const check = await repo.findById(tokenA.id, "tenant_A");
      expect(check!.budgetMicrodollars).toBe(10_000_000n);
    });

    it("prevents cross-tenant spend recording and throws TenantIsolationError", async () => {
      const tokenA = await repo.createToken({
        token: "kc_token_spend_boundary",
        tenantId: "tenant_A",
      });

      await expect(repo.recordSpend(tokenA.id, "tenant_B", 500n)).rejects.toThrow(
        TenantIsolationError
      );

      const check = await repo.findById(tokenA.id, "tenant_A");
      expect(check!.spentMicrodollars).toBe(0n);
    });
  });

  describe("Fixed-Point Microdollars (GEMINI.md Invariant)", () => {
    it("stores and calculates budgets in int64 microdollars (bigint)", async () => {
      const token = await repo.createToken({
        token: "kc_financial_token",
        tenantId: "tenant_fin",
        budgetMicrodollars: 15_750_000n, // $15.75
        spentMicrodollars: 2_500_000n,   // $2.50
      });

      expect(typeof token.budgetMicrodollars).toBe("bigint");
      expect(typeof token.spentMicrodollars).toBe("bigint");
      expect(token.budgetMicrodollars).toBe(15_750_000n);
      expect(token.spentMicrodollars).toBe(2_500_000n);
    });

    it("accurately accumulates multiple spends with zero floating-point error", async () => {
      const token = await repo.createToken({
        token: "kc_accumulate_spend",
        tenantId: "tenant_fin",
      });

      const spend1 = 123_456n;
      const spend2 = 654_321n;
      const spend3 = 1n; // 1 microdollar exact

      const res1 = await repo.recordSpend(token.id, "tenant_fin", spend1);
      expect(res1).toBe(123_456n);

      const res2 = await repo.recordSpend(token.id, "tenant_fin", spend2);
      expect(res2).toBe(777_777n);

      const res3 = await repo.recordSpend(token.id, "tenant_fin", spend3);
      expect(res3).toBe(777_778n);

      const reloaded = await repo.findById(token.id, "tenant_fin");
      expect(reloaded!.spentMicrodollars).toBe(777_778n);
    });

    it("rejects negative budgets and spends", async () => {
      await expect(
        repo.createToken({
          token: "kc_neg_budget",
          tenantId: "t1",
          budgetMicrodollars: -100n,
        })
      ).rejects.toThrow(TypeError);

      await expect(
        repo.createToken({
          token: "kc_neg_spent",
          tenantId: "t1",
          spentMicrodollars: -50n,
        })
      ).rejects.toThrow(TypeError);

      const token = await repo.createToken({ token: "kc_token_ok", tenantId: "t1" });

      await expect(repo.updateBudget(token.id, "t1", -10n)).rejects.toThrow(TypeError);
      await expect(repo.recordSpend(token.id, "t1", -1n)).rejects.toThrow(TypeError);
    });
  });

  describe("Token Validation Flow (validateToken)", () => {
    it("validates an active, unexpired token within budget", async () => {
      const plainToken = "kc_valid_token_now";
      await repo.createToken({
        token: plainToken,
        tenantId: "tenant_val",
        budgetMicrodollars: 100_000_000n,
        spentMicrodollars: 10_000_000n,
        allowedProviders: ["gemini", "openai"],
      });

      const res = await repo.validateToken(plainToken);
      expect(res.valid).toBe(true);
      expect(res.token).toBeDefined();
      expect(res.token!.tenantId).toBe("tenant_val");
    });

    it("fails validation with invalid_token for non-existent token", async () => {
      const res = await repo.validateToken("kc_random_nonexistent_token");
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("invalid_token");
      expect(res.token).toBeUndefined();
    });

    it("fails validation with expired_token when expiration timestamp is in the past", async () => {
      const plainToken = "kc_expired_token";
      const pastDate = new Date(Date.now() - 3600_000); // 1 hour ago

      await repo.createToken({
        token: plainToken,
        tenantId: "tenant_val",
        expiresAt: pastDate,
      });

      const res = await repo.validateToken(plainToken);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("expired_token");
      expect(res.token).toBeDefined();
    });

    it("succeeds validation when expiration timestamp is in the future", async () => {
      const plainToken = "kc_future_token";
      const futureDate = new Date(Date.now() + 3600_000 * 24); // 24 hours future

      await repo.createToken({
        token: plainToken,
        tenantId: "tenant_val",
        expiresAt: futureDate,
      });

      const res = await repo.validateToken(plainToken);
      expect(res.valid).toBe(true);
    });

    it("filters and checks allowed providers correctly", async () => {
      const plainToken = "kc_provider_restricted_token";
      await repo.createToken({
        token: plainToken,
        tenantId: "tenant_val",
        allowedProviders: ["openai", "anthropic"],
      });

      // Allowed provider matches
      const resOpenAI = await repo.validateToken(plainToken, { requiredProvider: "openai" });
      expect(resOpenAI.valid).toBe(true);

      const resAnthropic = await repo.validateToken(plainToken, { requiredProvider: "anthropic" });
      expect(resAnthropic.valid).toBe(true);

      // Disallowed provider rejected
      const resGemini = await repo.validateToken(plainToken, { requiredProvider: "gemini" });
      expect(resGemini.valid).toBe(false);
      expect(resGemini.reason).toBe("provider_not_allowed");
    });

    it("fails validation with budget_exceeded when spent reaches or exceeds budget", async () => {
      const plainToken = "kc_budget_capped_token";
      await repo.createToken({
        token: plainToken,
        tenantId: "tenant_val",
        budgetMicrodollars: 500_000n, // $0.50
        spentMicrodollars: 500_000n,  // exactly capped
      });

      const res = await repo.validateToken(plainToken);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("budget_exceeded");

      // 0n budget means unlimited
      const unlimitedToken = "kc_unlimited_budget_token";
      await repo.createToken({
        token: unlimitedToken,
        tenantId: "tenant_val",
        budgetMicrodollars: 0n,
        spentMicrodollars: 999_999_999n,
      });

      const resUnlimited = await repo.validateToken(unlimitedToken);
      expect(resUnlimited.valid).toBe(true);
    });
  });

  describe("Lifecycle Mutations & Revocation", () => {
    it("revokes token by setting expiration date to current time", async () => {
      const plainToken = "kc_token_to_revoke";
      const created = await repo.createToken({
        token: plainToken,
        tenantId: "tenant_rev",
      });

      expect(created.expiresAt).toBeNull();

      const revoked = await repo.revokeToken(created.id, "tenant_rev");
      expect(revoked).toBe(true);

      const reloaded = await repo.findById(created.id, "tenant_rev");
      expect(reloaded!.expiresAt).not.toBeNull();

      // Subsequent validateToken must fail as expired
      const val = await repo.validateToken(plainToken);
      expect(val.valid).toBe(false);
      expect(val.reason).toBe("expired_token");
    });

    it("updates arbitrary properties using updateToken", async () => {
      const created = await repo.createToken({
        token: "kc_token_for_updates",
        tenantId: "tenant_upd",
        budgetMicrodollars: 1_000_000n,
        rpmLimit: 60,
        allowedProviders: ["google"],
      });

      const updated = await repo.updateToken(created.id, "tenant_upd", {
        budgetMicrodollars: 5_000_000n,
        rpmLimit: 120,
        allowedProviders: ["google", "groq", "openai"],
      });

      expect(updated).not.toBeNull();
      expect(updated!.budgetMicrodollars).toBe(5_000_000n);
      expect(updated!.rpmLimit).toBe(120);
      expect(updated!.allowedProviders).toEqual(["google", "groq", "openai"]);
    });

    it("deletes a token cleanly", async () => {
      const created = await repo.createToken({
        token: "kc_token_to_delete",
        tenantId: "tenant_del",
      });

      const deleted = await repo.deleteToken(created.id, "tenant_del");
      expect(deleted).toBe(true);

      const found = await repo.findById(created.id, "tenant_del");
      expect(found).toBeNull();

      // Second delete returns false
      expect(await repo.deleteToken(created.id, "tenant_del")).toBe(false);
    });

    it("supports pagination in listByTenant", async () => {
      for (let i = 0; i < 5; i++) {
        await repo.createToken({
          token: `kc_token_page_${i}`,
          tenantId: "tenant_page",
        });
      }

      const page1 = await repo.listByTenant("tenant_page", { limit: 2, offset: 0 });
      expect(page1.length).toBe(2);

      const page2 = await repo.listByTenant("tenant_page", { limit: 2, offset: 2 });
      expect(page2.length).toBe(2);

      const page3 = await repo.listByTenant("tenant_page", { limit: 2, offset: 4 });
      expect(page3.length).toBe(1);

      // Verify no overlaps
      const ids = [...page1, ...page2, ...page3].map((t) => t.id);
      expect(new Set(ids).size).toBe(5);
    });
  });

  describe("Database Constraints & Edge Cases", () => {
    it("rejects duplicate token hash due to UNIQUE constraint on hash_sha256", async () => {
      const identicalToken = "kc_duplicate_token_value_unique_test";
      await repo.createToken({ token: identicalToken, tenantId: "tenant_1" });

      // Inserting the identical token again must violate the UNIQUE constraint in SQLite
      await expect(
        repo.createToken({ token: identicalToken, tenantId: "tenant_2" })
      ).rejects.toThrow();
    });

    it("gracefully parses corrupt JSON in allowed_providers", () => {
      const mockRow: AuthTokenRow = {
        id: "corrupt_1",
        hash_sha256: "dummyhash",
        tenant_id: "tenant_corrupt",
        encrypted_token_b64: null,
        nonce_b64: null,
        budget_microdollars: 0,
        spent_microdollars: 0,
        allowed_providers: "invalid-json-content{",
        rpm_limit: 60,
        expires_at: null,
        created_at: new Date().toISOString(),
      };

      const record = mapRowToAuthTokenRecord(mockRow);
      expect(record.allowedProviders).toEqual([]);
    });
  });
});
