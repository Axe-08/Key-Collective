import { DEFAULT_RPM_LIMIT, isValidRpmLimit } from "../../../constants/limits";
import { decrypt, encrypt, hashToken, KeyInput } from "../../../crypto";
import { timingSafeEqualStrings } from "../../../crypto/utils";
import { AuthenticationError, TenantIsolationError } from "../../../errors/auth_errors";
import { DecryptionError } from "../../../errors/key_errors";
import type {
  AuthTokenRow,
  AuthTokenRecord,
  CreateAuthTokenParams,
  AuthTokenRepositoryConfig,
  TokenValidationResult,
  UpdateAuthTokenParams,
  Microdollars,
} from "./types";
import { DEFAULT_AUTH_TOKEN_MASTER_KEY } from "./types";
import { mapRowToAuthTokenRecord } from "./mapper";

/**
 * AuthTokensRepository
 *
 * Provides repository methods for persisting, querying, verifying,
 * and managing tenant authentication tokens in Cloudflare D1 with mandatory AES-256-GCM
 * encryption at rest and SHA-256 constant-time hash indexing.
 */
export class AuthTokensRepository {
  private readonly db: D1Database;
  private readonly masterKey?: KeyInput;

  constructor(db: D1Database, config?: AuthTokenRepositoryConfig | KeyInput) {
    this.db = db;
    if (config) {
      if (
        typeof config === "string" ||
        config instanceof Uint8Array ||
        (typeof config === "object" && "type" in config && config.type === "secret")
      ) {
        this.masterKey = config as KeyInput;
      } else if (typeof config === "object" && "masterKey" in config && config.masterKey) {
        this.masterKey = config.masterKey;
      }
    }
  }

  /**
   * Resolves the encryption key to use for AES-256-GCM operations.
   */
  private resolveKey(overrideKey?: KeyInput): KeyInput {
    if (overrideKey) {
      return overrideKey;
    }
    if (this.masterKey) {
      return this.masterKey;
    }
    const g = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
    if (g.process?.env?.KC_MASTER_KEY) {
      return g.process.env.KC_MASTER_KEY;
    }
    return DEFAULT_AUTH_TOKEN_MASTER_KEY;
  }

  /**
   * Creates a new authentication token for a tenant.
   *
   * Invariant: Plaintext token is encrypted via AES-256-GCM before storage.
   * A unique 12-byte nonce is generated, and only ciphertext and nonce are stored in D1.
   * In addition, a SHA-256 hash is computed for indexed lookup.
   */
  public async createToken(params: CreateAuthTokenParams): Promise<AuthTokenRecord> {
    const rawToken = params.token ? params.token.trim() : "";
    if (!rawToken) {
      throw new AuthenticationError("Bearer token cannot be empty", { reason: "invalid_token" });
    }

    const tenantId = params.tenantId ? params.tenantId.trim() : "";
    if (!tenantId) {
      throw new TenantIsolationError("Tenant ID cannot be empty");
    }

    const id = params.id?.trim() || crypto.randomUUID();

    // 1. SHA-256 Hashing for indexed lookup
    const hashSha256 = await hashToken(rawToken);

    // 2. AES-256-GCM Encryption before storage (GEMINI.md Invariant)
    const effectiveKey = this.resolveKey(params.encryptionKey);
    const encrypted = await encrypt(rawToken, effectiveKey);
    const encryptedTokenB64 = encrypted.ciphertextB64;
    const nonceB64 = encrypted.nonceB64;

    // 3. Normalize financial values (Fixed-Point microdollars, no floats)
    let budgetMicro = 0n;
    if (params.budgetMicrodollars !== undefined) {
      budgetMicro =
        typeof params.budgetMicrodollars === "bigint"
          ? params.budgetMicrodollars
          : BigInt(params.budgetMicrodollars);
      if (budgetMicro < 0n) {
        throw new TypeError("budgetMicrodollars cannot be negative");
      }
    }

    let spentMicro = 0n;
    if (params.spentMicrodollars !== undefined) {
      spentMicro =
        typeof params.spentMicrodollars === "bigint"
          ? params.spentMicrodollars
          : BigInt(params.spentMicrodollars);
      if (spentMicro < 0n) {
        throw new TypeError("spentMicrodollars cannot be negative");
      }
    }

    // 4. Rate limits & Allowed Providers
    const rpmLimit = params.rpmLimit ?? DEFAULT_RPM_LIMIT;
    if (!isValidRpmLimit(rpmLimit)) {
      throw new RangeError(`Invalid rpmLimit: ${rpmLimit}. Must be between 1 and 100,000.`);
    }

    const allowedProviders = params.allowedProviders ? [...params.allowedProviders] : [];
    const allowedProvidersJson = JSON.stringify(allowedProviders);

    // 5. Expiration timestamp
    let expiresAtIso: string | null = null;
    if (params.expiresAt) {
      expiresAtIso = new Date(params.expiresAt).toISOString();
    }
    const createdAtIso = new Date().toISOString();

    // 6. Insert into D1 database
    const query = `
      INSERT INTO auth_tokens (
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
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const stmt = this.db.prepare(query).bind(
      id,
      hashSha256,
      tenantId,
      encryptedTokenB64,
      nonceB64,
      Number(budgetMicro),
      Number(spentMicro),
      allowedProvidersJson,
      rpmLimit,
      expiresAtIso,
      createdAtIso
    );

    await stmt.run();

    return {
      id,
      hashSha256,
      tenantId,
      encryptedTokenB64,
      nonceB64,
      budgetMicrodollars: budgetMicro,
      spentMicrodollars: spentMicro,
      allowedProviders,
      rpmLimit,
      expiresAt: expiresAtIso,
      createdAt: createdAtIso,
    };
  }

  /**
   * Finds an auth token by plaintext bearer token on the proxy hot path.
   */
  public async findByToken(plainToken: string): Promise<AuthTokenRecord | null> {
    if (!plainToken || typeof plainToken !== "string") {
      return null;
    }

    const computedHash = await hashToken(plainToken);
    const query = "SELECT * FROM auth_tokens WHERE hash_sha256 = ? LIMIT 1";
    const row = await this.db.prepare(query).bind(computedHash).first<AuthTokenRow>();

    if (!row) {
      return null;
    }

    // Constant-time comparison to prevent timing attacks
    if (!timingSafeEqualStrings(computedHash, row.hash_sha256.toLowerCase())) {
      return null;
    }

    return mapRowToAuthTokenRecord(row);
  }

  /**
   * Finds an auth token directly by its SHA-256 hash.
   */
  public async findByHash(hashSha256: string): Promise<AuthTokenRecord | null> {
    if (!hashSha256 || typeof hashSha256 !== "string") {
      return null;
    }

    const query = "SELECT * FROM auth_tokens WHERE hash_sha256 = ? LIMIT 1";
    const row = await this.db.prepare(query).bind(hashSha256.toLowerCase().trim()).first<AuthTokenRow>();

    if (!row) {
      return null;
    }

    return mapRowToAuthTokenRecord(row);
  }

  /**
   * Finds an auth token by ID, optionally enforcing tenant isolation.
   */
  public async findById(id: string, tenantId?: string): Promise<AuthTokenRecord | null> {
    if (!id || typeof id !== "string") {
      return null;
    }

    if (tenantId !== undefined) {
      const cleanTenantId = tenantId.trim();
      if (!cleanTenantId) {
        throw new TenantIsolationError("Tenant ID cannot be empty");
      }

      const query = "SELECT * FROM auth_tokens WHERE id = ? AND tenant_id = ? LIMIT 1";
      const row = await this.db.prepare(query).bind(id.trim(), cleanTenantId).first<AuthTokenRow>();
      if (row) {
        return mapRowToAuthTokenRecord(row);
      }

      // Check if ID exists under another tenant to detect cross-tenant access violation
      const crossTenantQuery = "SELECT tenant_id FROM auth_tokens WHERE id = ? LIMIT 1";
      const crossRow = await this.db.prepare(crossTenantQuery).bind(id.trim()).first<{ tenant_id: string }>();
      if (crossRow && crossRow.tenant_id !== cleanTenantId) {
        throw new TenantIsolationError(
          `Token '${id}' belongs to another tenant. Cross-tenant access forbidden.`,
          { tenantId: cleanTenantId, attemptedTenantId: crossRow.tenant_id, resourceId: id.trim() }
        );
      }
      return null;
    }

    const query = "SELECT * FROM auth_tokens WHERE id = ? LIMIT 1";
    const row = await this.db.prepare(query).bind(id.trim()).first<AuthTokenRow>();
    return row ? mapRowToAuthTokenRecord(row) : null;
  }

  /**
   * Lists all tokens belonging to a tenant with pagination support.
   */
  public async listByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AuthTokenRecord[]> {
    const cleanTenantId = tenantId ? tenantId.trim() : "";
    if (!cleanTenantId) {
      throw new TenantIsolationError("Tenant ID cannot be empty");
    }

    const limit = Math.max(1, Math.min(1000, options?.limit ?? 50));
    const offset = Math.max(0, options?.offset ?? 0);

    const query = `
      SELECT * FROM auth_tokens
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const res = await this.db.prepare(query).bind(cleanTenantId, limit, offset).all<AuthTokenRow>();
    const rows = res.results ?? [];
    return rows.map(mapRowToAuthTokenRecord);
  }

  /**
   * Counts the total number of auth tokens for a tenant.
   */
  public async countByTenant(tenantId: string): Promise<number> {
    const cleanTenantId = tenantId ? tenantId.trim() : "";
    if (!cleanTenantId) {
      throw new TenantIsolationError("Tenant ID cannot be empty");
    }

    const query = "SELECT COUNT(*) as count FROM auth_tokens WHERE tenant_id = ?";
    const row = await this.db.prepare(query).bind(cleanTenantId).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  /**
   * Deletes an auth token by ID, optionally scoping to tenant.
   */
  public async deleteToken(id: string, tenantId?: string): Promise<boolean> {
    if (!id || typeof id !== "string") {
      return false;
    }

    if (tenantId !== undefined) {
      const cleanTenantId = tenantId.trim();
      if (!cleanTenantId) {
        throw new TenantIsolationError("Tenant ID cannot be empty");
      }

      const existing = await this.findById(id, cleanTenantId);
      if (!existing) {
        return false;
      }

      const query = "DELETE FROM auth_tokens WHERE id = ? AND tenant_id = ?";
      const res = await this.db.prepare(query).bind(id.trim(), cleanTenantId).run();
      return (res.meta?.changes ?? 0) > 0;
    }

    const query = "DELETE FROM auth_tokens WHERE id = ?";
    const res = await this.db.prepare(query).bind(id.trim()).run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /**
   * Revokes a token by setting its expiration to the current timestamp.
   */
  public async revokeToken(id: string, tenantId?: string): Promise<boolean> {
    if (!id || typeof id !== "string") {
      return false;
    }

    const nowIso = new Date().toISOString();
    if (tenantId !== undefined) {
      const cleanTenantId = tenantId.trim();
      if (!cleanTenantId) {
        throw new TenantIsolationError("Tenant ID cannot be empty");
      }

      const existing = await this.findById(id, cleanTenantId);
      if (!existing) {
        return false;
      }
      const query = "UPDATE auth_tokens SET expires_at = ? WHERE id = ? AND tenant_id = ?";
      const res = await this.db.prepare(query).bind(nowIso, id.trim(), cleanTenantId).run();
      return (res.meta?.changes ?? 0) > 0;
    }

    const query = "UPDATE auth_tokens SET expires_at = ? WHERE id = ?";
    const res = await this.db.prepare(query).bind(nowIso, id.trim()).run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /**
   * Updates the budget ceiling of a token in fixed-point int64 microdollars.
   */
  public async updateBudget(
    id: string,
    tenantId: string,
    budgetMicrodollars: Microdollars | number
  ): Promise<boolean> {
    const budget =
      typeof budgetMicrodollars === "bigint"
        ? budgetMicrodollars
        : BigInt(budgetMicrodollars);

    if (budget < 0n) {
      throw new TypeError("budgetMicrodollars cannot be negative");
    }

    const existing = await this.findById(id, tenantId);
    if (!existing) {
      return false;
    }

    const query = "UPDATE auth_tokens SET budget_microdollars = ? WHERE id = ? AND tenant_id = ?";
    const res = await this.db.prepare(query).bind(Number(budget), id.trim(), tenantId.trim()).run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /**
   * Records financial expenditure against a token in fixed-point int64 microdollars.
   */
  public async recordSpend(
    id: string,
    tenantId: string,
    spendMicrodollars: Microdollars | number
  ): Promise<Microdollars> {
    const spend =
      typeof spendMicrodollars === "bigint"
        ? spendMicrodollars
        : BigInt(spendMicrodollars);

    if (spend < 0n) {
      throw new TypeError("spendMicrodollars cannot be negative");
    }

    const existing = await this.findById(id, tenantId);
    if (!existing) {
      throw new AuthenticationError(`Token '${id}' not found for tenant '${tenantId}'`, {
        reason: "invalid_token",
      });
    }

    const newSpent = existing.spentMicrodollars + spend;
    const query = "UPDATE auth_tokens SET spent_microdollars = ? WHERE id = ? AND tenant_id = ?";
    await this.db.prepare(query).bind(Number(newSpent), id.trim(), tenantId.trim()).run();
    return newSpent;
  }

  /**
   * Updates arbitrary token properties with strict tenant scoping.
   */
  public async updateToken(
    id: string,
    tenantId: string,
    params: UpdateAuthTokenParams
  ): Promise<AuthTokenRecord | null> {
    const existing = await this.findById(id, tenantId);
    if (!existing) {
      return null;
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.budgetMicrodollars !== undefined) {
      const b =
        typeof params.budgetMicrodollars === "bigint"
          ? params.budgetMicrodollars
          : BigInt(params.budgetMicrodollars);
      if (b < 0n) throw new TypeError("budgetMicrodollars cannot be negative");
      updates.push("budget_microdollars = ?");
      values.push(Number(b));
    }

    if (params.allowedProviders !== undefined) {
      updates.push("allowed_providers = ?");
      values.push(JSON.stringify(params.allowedProviders));
    }

    if (params.rpmLimit !== undefined) {
      if (!isValidRpmLimit(params.rpmLimit)) {
        throw new RangeError(`Invalid rpmLimit: ${params.rpmLimit}`);
      }
      updates.push("rpm_limit = ?");
      values.push(params.rpmLimit);
    }

    if (params.expiresAt !== undefined) {
      updates.push("expires_at = ?");
      values.push(params.expiresAt ? new Date(params.expiresAt).toISOString() : null);
    }

    if (updates.length === 0) {
      return existing;
    }

    values.push(id.trim(), tenantId.trim());
    const query = `UPDATE auth_tokens SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`;
    await this.db.prepare(query).bind(...values).run();

    return await this.findById(id, tenantId);
  }

  /**
   * Decrypts an encrypted token record back into its raw plaintext bearer token.
   */
  public async decryptToken(record: AuthTokenRecord, key?: KeyInput): Promise<string> {
    if (!record.encryptedTokenB64 || !record.nonceB64) {
      throw new DecryptionError("Token record does not contain encrypted ciphertext and nonce");
    }

    const effectiveKey = this.resolveKey(key);
    return await decrypt(record.encryptedTokenB64, effectiveKey, record.nonceB64);
  }

  /**
   * Validates an incoming bearer token for edge authentication.
   */
  public async validateToken(
    plainToken: string,
    options?: { requiredProvider?: string; now?: Date | string }
  ): Promise<TokenValidationResult> {
    const record = await this.findByToken(plainToken);
    if (!record) {
      return { valid: false, reason: "invalid_token" };
    }

    // Check expiration
    if (record.expiresAt) {
      const nowMs = (options?.now ? new Date(options.now) : new Date()).getTime();
      const expMs = new Date(record.expiresAt).getTime();
      if (nowMs >= expMs) {
        return { valid: false, reason: "expired_token", token: record };
      }
    }

    // Check allowed providers
    if (options?.requiredProvider && record.allowedProviders.length > 0) {
      const provider = options.requiredProvider.toLowerCase().trim();
      const isAllowed = record.allowedProviders.some(
        (p) => p.toLowerCase().trim() === provider
      );
      if (!isAllowed) {
        return { valid: false, reason: "provider_not_allowed", token: record };
      }
    }

    // Check budget exhaustion (int64 microdollars)
    if (record.budgetMicrodollars > 0n && record.spentMicrodollars >= record.budgetMicrodollars) {
      return { valid: false, reason: "budget_exceeded", token: record };
    }

    return { valid: true, token: record };
  }
}
