/**
 * Unit Tests for AuthTokensRepository (Micro-task SEC-CORE-001)
 *
 * Acceptance Criteria Verified:
 * 1. AuthTokenRecord properly types microdollars as bigint
 * 2. AuthTokensRepository.createToken encrypts tokens with AES-256-GCM and unique 12-byte nonce
 * 3. AuthTokensRepository.validateToken hashes plaintext with SHA-256 for fast D1 lookups
 * 4. Repository enforces strict tenant isolation on list/delete
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AuthTokensRepository,
  AuthTokenRow,
  AuthTokenRecord,
  Microdollars,
} from "./index";
import { hashToken, decrypt } from "../../../crypto";
import { AuthenticationError, TenantIsolationError } from "../../../errors/auth_errors";

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
  async raw<T = unknown[]>(_options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]> {
    throw new Error("raw not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    const trimmed = this.query.trim().replace(/\s+/g, " ");
    const upper = trimmed.toUpperCase();

    // INSERT INTO auth_tokens
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
        if (existing.hash_sha256 === hash_sha256) {
          throw new Error("UNIQUE constraint failed: auth_tokens.hash_sha256");
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
      return { success: true, meta: createMeta(1), results: [] };
    }

    // SELECT * FROM auth_tokens WHERE hash_sha256 = ?
    if (upper.startsWith("SELECT * FROM AUTH_TOKENS WHERE HASH_SHA256 = ?")) {
      const hash = String(this.boundParams[0]).toLowerCase();
      const match = Array.from(this.db.rows.values()).find(
        (r) => r.hash_sha256.toLowerCase() === hash
      );
      return {
        success: true,
        meta: createMeta(0),
        results: match ? [match as unknown as T] : [],
      };
    }

    // SELECT tenant_id FROM auth_tokens WHERE id = ?
    if (upper.startsWith("SELECT TENANT_ID FROM AUTH_TOKENS WHERE ID = ?")) {
      const id = String(this.boundParams[0]);
      const found = this.db.rows.get(id);
      return {
        success: true,
        meta: createMeta(0),
        results: found ? [{ tenant_id: found.tenant_id } as unknown as T] : [],
      };
    }

    // SELECT * FROM auth_tokens WHERE id = ? AND tenant_id = ?
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

    // SELECT * FROM auth_tokens WHERE id = ?
    if (upper.startsWith("SELECT * FROM AUTH_TOKENS WHERE ID = ?")) {
      const id = String(this.boundParams[0]);
      const found = this.db.rows.get(id);
      return {
        success: true,
        meta: createMeta(0),
        results: found ? [found as unknown as T] : [],
      };
    }

    // SELECT * FROM auth_tokens WHERE tenant_id = ?
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

    // DELETE FROM auth_tokens WHERE id = ? AND tenant_id = ?
    if (upper === "DELETE FROM AUTH_TOKENS WHERE ID = ? AND TENANT_ID = ?") {
      const id = String(this.boundParams[0]);
      const tenantId = String(this.boundParams[1]);

      const found = this.db.rows.get(id);
      if (found && found.tenant_id === tenantId) {
        this.db.rows.delete(id);
        return { success: true, meta: createMeta(1), results: [] };
      }
      return { success: true, meta: createMeta(0), results: [] };
    }

    // DELETE FROM auth_tokens WHERE id = ?
    if (upper === "DELETE FROM AUTH_TOKENS WHERE ID = ?") {
      const id = String(this.boundParams[0]);
      const found = this.db.rows.get(id);
      if (found) {
        this.db.rows.delete(id);
        return { success: true, meta: createMeta(1), results: [] };
      }
      return { success: true, meta: createMeta(0), results: [] };
    }

    return { success: true, meta: createMeta(0), results: [] };
  }
}

describe("SEC-CORE-001: AuthTokensRepository", () => {
  let db: MockD1Database;
  let repo: AuthTokensRepository;
  const MASTER_KEY = "test-master-secret-key-32-bytes!";

  beforeEach(() => {
    db = new MockD1Database();
    repo = new AuthTokensRepository(db, MASTER_KEY);
  });

  describe("1. AuthTokenRecord properly types microdollars as bigint", () => {
    it("stores and returns budgetMicrodollars and spentMicrodollars as bigint", async () => {
      const record: AuthTokenRecord = await repo.createToken({
        token: "kc_token_microdollar_check",
        tenantId: "tenant_fin",
        budgetMicrodollars: 5_000_000n,
        spentMicrodollars: 1_250_000n,
      });

      expect(typeof record.budgetMicrodollars).toBe("bigint");
      expect(typeof record.spentMicrodollars).toBe("bigint");
      expect(record.budgetMicrodollars).toBe(5_000_000n);
      expect(record.spentMicrodollars).toBe(1_250_000n);

      const typeCheck: Microdollars = record.budgetMicrodollars;
      expect(typeCheck).toBe(5_000_000n);
    });
  });

  describe("2. AuthTokensRepository.createToken encrypts tokens with AES-256-GCM and unique 12-byte nonce", () => {
    it("encrypts plaintext with AES-256-GCM and generates a unique 12-byte nonce", async () => {
      const plain = "kc_secret_token_to_encrypt";
      const token1 = await repo.createToken({ token: plain, tenantId: "tenant_crypto" });
      const token2 = await repo.createToken({ token: "kc_another_secret_token", tenantId: "tenant_crypto" });

      expect(token1.encryptedTokenB64).toBeDefined();
      expect(token1.nonceB64).toBeDefined();
      expect(token1.encryptedTokenB64).not.toContain(plain);

      // Base64-encoded 12 bytes is 16 characters
      const nonceBytes = Buffer.from(token1.nonceB64!, "base64");
      expect(nonceBytes.length).toBe(12);

      // Unique nonces per encryption
      expect(token1.nonceB64).not.toBe(token2.nonceB64);

      // Plaintext can be decrypted back with the master key
      const decrypted = await decrypt(token1.encryptedTokenB64!, MASTER_KEY, token1.nonceB64!);
      expect(decrypted).toBe(plain);
    });
  });

  describe("3. AuthTokensRepository.validateToken hashes plaintext with SHA-256 for fast D1 lookups", () => {
    it("hashes plaintext with SHA-256 to look up and validate the token", async () => {
      const plain = "kc_live_test_validation_token";
      const expectedHash = await hashToken(plain);

      const created = await repo.createToken({
        token: plain,
        tenantId: "tenant_val",
        budgetMicrodollars: 10_000_000n,
      });

      expect(created.hashSha256).toBe(expectedHash);

      const validResult = await repo.validateToken(plain);
      expect(validResult.valid).toBe(true);
      expect(validResult.token?.id).toBe(created.id);
      expect(validResult.token?.tenantId).toBe("tenant_val");

      const invalidResult = await repo.validateToken("kc_invalid_plain_token");
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.reason).toBe("invalid_token");
    });
  });

  describe("4. Repository enforces strict tenant isolation on list/delete", () => {
    it("strictly isolates listByTenant to the specified tenant", async () => {
      await repo.createToken({ token: "kc_tok_alpha_1", tenantId: "tenant_A" });
      await repo.createToken({ token: "kc_tok_alpha_2", tenantId: "tenant_A" });
      await repo.createToken({ token: "kc_tok_beta_1", tenantId: "tenant_B" });

      const listA = await repo.listByTenant("tenant_A");
      expect(listA).toHaveLength(2);
      expect(listA.every((t) => t.tenantId === "tenant_A")).toBe(true);

      const listB = await repo.listByTenant("tenant_B");
      expect(listB).toHaveLength(1);
      expect(listB[0].tenantId).toBe("tenant_B");

      await expect(repo.listByTenant("")).rejects.toThrow(TenantIsolationError);
      await expect(repo.listByTenant("   ")).rejects.toThrow(TenantIsolationError);
    });

    it("enforces strict tenant isolation on deleteToken and throws TenantIsolationError on cross-tenant attempt", async () => {
      const tokenA = await repo.createToken({ token: "kc_tok_isolate_del", tenantId: "tenant_A" });

      await expect(repo.deleteToken(tokenA.id, "tenant_B")).rejects.toThrow(TenantIsolationError);
      await expect(repo.deleteToken(tokenA.id, "")).rejects.toThrow(TenantIsolationError);

      const stillExists = await repo.findById(tokenA.id, "tenant_A");
      expect(stillExists).not.toBeNull();

      const deleted = await repo.deleteToken(tokenA.id, "tenant_A");
      expect(deleted).toBe(true);

      const nowGone = await repo.findById(tokenA.id, "tenant_A");
      expect(nowGone).toBeNull();
    });
  });
});
