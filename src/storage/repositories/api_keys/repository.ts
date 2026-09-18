/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Storage Layer: API Key D1 Repository Class
 */

import {
  KEY_MASK_PREFIX_LENGTH,
  KEY_MASK_SUFFIX_LENGTH,
  maskApiKey,
} from "../../../constants/crypto";
import {
  DEFAULT_RPD_LIMIT,
  DEFAULT_RPM_LIMIT,
  MAX_RPM_LIMIT,
  MIN_RPM_LIMIT,
  isValidRpmLimit,
} from "../../../constants/limits";
import {
  KeyInput,
  deriveTenantKey,
  encrypt,
} from "../../../crypto/encryption/index";
import {
  InvalidKeyError,
  KeyNotFoundError,
} from "../../../errors/key_errors";
import {
  APIKey,
  KeyStatus,
  ModelProvider,
  isKeyStatus,
} from "../../../types/models";
import {
  decryptApiKeyRecord,
  encryptPlaintextKey,
  resolveMasterKeyForDecryption,
  resolveMasterKeyForEncryption,
  validatePreEncryptedNonce,
} from "./crypto";
import {
  APIKeyRow,
  CountApiKeysOptions,
  CreateApiKeyInput,
  InsertEncryptedApiKeyInput,
  ListApiKeysOptions,
  UpdateApiKeyInput,
  mapRowToAPIKey,
} from "./types";
import { validateCreateApiKeyInput } from "./validation";

/**
 * Repository layer for managing provider API keys in Cloudflare D1.
 * Enforces AES-256-GCM encryption with unique 12-byte nonces and strict tenant boundaries.
 */
export class ApiKeyRepository {
  constructor(
    private readonly db: D1Database,
    private readonly masterKey?: KeyInput
  ) {}

  /**
   * Encrypts and persists a new API key into Cloudflare D1.
   * Plaintext keys are NEVER written to the database.
   */
  async create(input: CreateApiKeyInput, masterKey?: KeyInput): Promise<APIKey> {
    validateCreateApiKeyInput(input);

    const keySecret = resolveMasterKeyForEncryption(this.masterKey, masterKey);
    const { ciphertextB64, nonceB64, prefix, suffix } = await encryptPlaintextKey(
      input.plaintextKey,
      input.tenantId,
      keySecret
    );

    const id = input.id ?? crypto.randomUUID();
    const rpmLimit = input.rpmLimit ?? DEFAULT_RPM_LIMIT;
    const rpdLimit = input.rpdLimit ?? DEFAULT_RPD_LIMIT;
    const priority = input.priority ?? 0;
    const status: KeyStatus = input.status ?? "Healthy";
    const circuitOpenUntil = input.circuitOpenUntil ?? null;
    const createdAt = input.createdAt ?? new Date().toISOString();

    const sql = `
      INSERT INTO api_keys (
        id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
        key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
        circuit_open_until, last_used_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `;

    await this.db
      .prepare(sql)
      .bind(
        id,
        input.tenantId,
        input.label.trim(),
        input.provider,
        ciphertextB64,
        nonceB64,
        prefix,
        suffix,
        rpmLimit,
        rpdLimit,
        priority,
        status,
        circuitOpenUntil,
        createdAt
      )
      .run();

    return {
      id,
      tenantId: input.tenantId,
      label: input.label.trim(),
      provider: input.provider,
      encryptedKeyB64: ciphertextB64,
      nonceB64: nonceB64,
      keyPrefix: prefix,
      keySuffix: suffix,
      rpmLimit,
      rpdLimit,
      priority,
      status,
      circuitOpenUntil,
      lastUsedAt: null,
      createdAt,
    };
  }

  /**
   * Alias for `create`.
   */
  async createApiKey(input: CreateApiKeyInput, masterKey?: KeyInput): Promise<APIKey> {
    return this.create(input, masterKey);
  }

  /**
   * Alias for `create`.
   */
  async insertKey(input: CreateApiKeyInput, masterKey?: KeyInput): Promise<APIKey> {
    return this.create(input, masterKey);
  }

  /**
   * Inserts an already-encrypted API key into Cloudflare D1.
   * Validates that the nonce is exactly 12 bytes (96 bits) and ciphertext is valid base64.
   */
  async insertEncryptedKey(input: InsertEncryptedApiKeyInput): Promise<APIKey> {
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new InvalidKeyError("Tenant ID cannot be empty", {
        reason: "missing_tenant_id",
      });
    }
    if (!input.label || input.label.trim().length === 0) {
      throw new InvalidKeyError("Key label cannot be empty", {
        reason: "missing_label",
      });
    }
    if (!input.provider) {
      throw new InvalidKeyError(`Invalid model provider: '${input.provider}'`, {
        provider: String(input.provider),
        reason: "invalid_provider",
      });
    }
    if (!input.encryptedKeyB64 || input.encryptedKeyB64.trim().length === 0) {
      throw new InvalidKeyError("Encrypted key Base64 cannot be empty", {
        reason: "missing_ciphertext",
      });
    }
    if (!input.nonceB64 || input.nonceB64.trim().length === 0) {
      throw new InvalidKeyError("Nonce Base64 cannot be empty", {
        reason: "missing_nonce",
      });
    }

    validatePreEncryptedNonce(input.nonceB64);

    const id = input.id ?? crypto.randomUUID();
    const rpmLimit = input.rpmLimit ?? DEFAULT_RPM_LIMIT;
    const rpdLimit = input.rpdLimit ?? DEFAULT_RPD_LIMIT;
    const priority = input.priority ?? 0;
    const status: KeyStatus = input.status ?? "Healthy";
    const circuitOpenUntil = input.circuitOpenUntil ?? null;
    const lastUsedAt = input.lastUsedAt ?? null;
    const createdAt = input.createdAt ?? new Date().toISOString();
    const keyPrefix = input.keyPrefix ?? "sk-...";
    const keySuffix = input.keySuffix ?? "...";

    const sql = `
      INSERT INTO api_keys (
        id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
        key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
        circuit_open_until, last_used_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.db
      .prepare(sql)
      .bind(
        id,
        input.tenantId,
        input.label.trim(),
        input.provider,
        input.encryptedKeyB64,
        input.nonceB64,
        keyPrefix,
        keySuffix,
        rpmLimit,
        rpdLimit,
        priority,
        status,
        circuitOpenUntil,
        lastUsedAt,
        createdAt
      )
      .run();

    return {
      id,
      tenantId: input.tenantId,
      label: input.label.trim(),
      provider: input.provider,
      encryptedKeyB64: input.encryptedKeyB64,
      nonceB64: input.nonceB64,
      keyPrefix,
      keySuffix,
      rpmLimit,
      rpdLimit,
      priority,
      status,
      circuitOpenUntil,
      lastUsedAt,
      createdAt,
    };
  }

  /**
   * Retrieves an API key by unique identifier.
   * If `tenantId` is supplied, enforces tenant boundary checks.
   */
  async getById(id: string, tenantId?: string): Promise<APIKey | null> {
    let sql = `SELECT * FROM api_keys WHERE id = ?`;
    const params: unknown[] = [id];

    if (tenantId !== undefined) {
      sql += ` AND tenant_id = ?`;
      params.push(tenantId);
    }

    const row = await this.db
      .prepare(sql)
      .bind(...params)
      .first<APIKeyRow>();

    if (!row) {
      return null;
    }

    return mapRowToAPIKey(row);
  }

  /**
   * Alias for `getById`.
   */
  async getApiKeyById(id: string, tenantId?: string): Promise<APIKey | null> {
    return this.getById(id, tenantId);
  }

  /**
   * Retrieves an API key by unique identifier or throws KeyNotFoundError.
   */
  async getByIdOrThrow(id: string, tenantId?: string): Promise<APIKey> {
    const key = await this.getById(id, tenantId);
    if (!key) {
      throw new KeyNotFoundError(id, `API key '${id}' not found in pool`, {
        tenantId,
      });
    }
    return key;
  }

  /**
   * Alias for `getByIdOrThrow`.
   */
  async getApiKeyByIdOrThrow(id: string, tenantId?: string): Promise<APIKey> {
    return this.getByIdOrThrow(id, tenantId);
  }

  /**
   * Lists all API keys for a specific tenant with optional provider and status filters.
   */
  async listByTenant(
    tenantId: string,
    options?: ListApiKeysOptions
  ): Promise<APIKey[]> {
    let sql = `SELECT * FROM api_keys WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (options?.provider) {
      sql += ` AND provider = ?`;
      params.push(options.provider);
    }

    if (options?.status) {
      sql += ` AND status = ?`;
      params.push(options.status);
    }

    sql += ` ORDER BY priority DESC, created_at ASC`;

    if (options?.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
      if (options?.offset !== undefined) {
        sql += ` OFFSET ?`;
        params.push(options.offset);
      }
    }

    const result = await this.db
      .prepare(sql)
      .bind(...params)
      .all<APIKeyRow>();

    const rows = result.results ?? [];
    return rows.map(mapRowToAPIKey);
  }

  /**
   * Alias for `listByTenant`.
   */
  async listApiKeysByTenant(
    tenantId: string,
    options?: ListApiKeysOptions
  ): Promise<APIKey[]> {
    return this.listByTenant(tenantId, options);
  }

  /**
   * Alias for `listByTenant`.
   */
  async getKeysByTenant(
    tenantId: string,
    options?: ListApiKeysOptions
  ): Promise<APIKey[]> {
    return this.listByTenant(tenantId, options);
  }

  /**
   * Retrieves active, non-disabled keys for a given tenant and model provider.
   */
  async getActiveKeysForProvider(
    tenantId: string,
    provider: ModelProvider
  ): Promise<APIKey[]> {
    const sql = `
      SELECT * FROM api_keys
      WHERE tenant_id = ? AND provider = ? AND status NOT IN ('Disabled', 'disabled')
      ORDER BY priority DESC, created_at ASC
    `;

    const result = await this.db
      .prepare(sql)
      .bind(tenantId, provider)
      .all<APIKeyRow>();

    const rows = result.results ?? [];
    return rows.map(mapRowToAPIKey);
  }

  /**
   * Decrypts an APIKey record's ciphertext into plaintext using AES-256-GCM.
   */
  async decryptKey(key: APIKey, masterKey?: KeyInput): Promise<string> {
    const keySecret = resolveMasterKeyForDecryption(this.masterKey, masterKey);
    return decryptApiKeyRecord(key, keySecret);
  }

  /**
   * Alias for `decryptKey`.
   */
  async decryptApiKey(key: APIKey, masterKey?: KeyInput): Promise<string> {
    return this.decryptKey(key, masterKey);
  }

  /**
   * Fetches an API key from D1 and decrypts its ciphertext into plaintext.
   */
  async getDecryptedKey(
    id: string,
    tenantId: string,
    masterKey?: KeyInput
  ): Promise<string> {
    const key = await this.getByIdOrThrow(id, tenantId);
    return this.decryptKey(key, masterKey);
  }

  /**
   * Alias for `getDecryptedKey`.
   */
  async getDecryptedApiKey(
    id: string,
    tenantId: string,
    masterKey?: KeyInput
  ): Promise<string> {
    return this.getDecryptedKey(id, tenantId, masterKey);
  }

  /**
   * Updates an existing API key's configuration or rotates its plaintext key.
   */
  async update(
    id: string,
    tenantId: string,
    updates: UpdateApiKeyInput,
    masterKey?: KeyInput
  ): Promise<APIKey> {
    const existing = await this.getByIdOrThrow(id, tenantId);

    let encryptedKeyB64 = existing.encryptedKeyB64;
    let nonceB64 = existing.nonceB64;
    let keyPrefix = existing.keyPrefix;
    let keySuffix = existing.keySuffix;

    if (updates.plaintextKey !== undefined) {
      if (updates.plaintextKey.trim().length === 0) {
        throw new InvalidKeyError(
          "Plaintext API key cannot be empty when rotating key",
          { details: { keyId: id }, reason: "empty_plaintext_key" }
        );
      }
      const keySecret = resolveMasterKeyForEncryption(this.masterKey, masterKey);
      const tenantKey = await deriveTenantKey(keySecret as string | Uint8Array, tenantId);
      const encrypted = await encrypt(updates.plaintextKey, tenantKey);
      encryptedKeyB64 = encrypted.ciphertextB64;
      nonceB64 = encrypted.nonceB64;
      const masked = maskApiKey(
        updates.plaintextKey,
        KEY_MASK_PREFIX_LENGTH,
        KEY_MASK_SUFFIX_LENGTH
      );
      keyPrefix = masked.prefix;
      keySuffix = masked.suffix;
    }

    const label = updates.label !== undefined ? updates.label.trim() : existing.label;
    if (label.length === 0) {
      throw new InvalidKeyError("Key label cannot be empty", {
        reason: "missing_label",
      });
    }

    const rpmLimit =
      updates.rpmLimit !== undefined ? updates.rpmLimit : existing.rpmLimit;
    if (updates.rpmLimit !== undefined && !isValidRpmLimit(updates.rpmLimit)) {
      throw new InvalidKeyError(
        `Invalid RPM limit: ${updates.rpmLimit}. Must be an integer between ${MIN_RPM_LIMIT} and ${MAX_RPM_LIMIT}.`,
        { reason: "invalid_rpm_limit" }
      );
    }

    const rpdLimit =
      updates.rpdLimit !== undefined ? updates.rpdLimit : existing.rpdLimit;
    if (
      updates.rpdLimit !== undefined &&
      (!Number.isInteger(updates.rpdLimit) || updates.rpdLimit < 1)
    ) {
      throw new InvalidKeyError(
        `Invalid RPD limit: ${updates.rpdLimit}. Must be a positive integer.`,
        { reason: "invalid_rpd_limit" }
      );
    }

    const priority =
      updates.priority !== undefined ? updates.priority : existing.priority;

    const status =
      updates.status !== undefined ? updates.status : existing.status;
    if (updates.status !== undefined && !isKeyStatus(updates.status)) {
      throw new InvalidKeyError(`Invalid key status: '${updates.status}'`, {
        reason: "invalid_status",
      });
    }

    const circuitOpenUntil =
      updates.circuitOpenUntil !== undefined
        ? updates.circuitOpenUntil
        : existing.circuitOpenUntil;

    const sql = `
      UPDATE api_keys
      SET label = ?, encrypted_key_b64 = ?, nonce_b64 = ?, key_prefix = ?, key_suffix = ?,
          rpm_limit = ?, rpd_limit = ?, priority = ?, status = ?, circuit_open_until = ?
      WHERE id = ? AND tenant_id = ?
    `;

    await this.db
      .prepare(sql)
      .bind(
        label,
        encryptedKeyB64,
        nonceB64,
        keyPrefix,
        keySuffix,
        rpmLimit,
        rpdLimit,
        priority,
        status,
        circuitOpenUntil,
        id,
        tenantId
      )
      .run();

    return {
      ...existing,
      label,
      encryptedKeyB64,
      nonceB64,
      keyPrefix,
      keySuffix,
      rpmLimit,
      rpdLimit,
      priority,
      status,
      circuitOpenUntil,
    };
  }

  /**
   * Alias for `update`.
   */
  async updateApiKey(
    id: string,
    tenantId: string,
    updates: UpdateApiKeyInput,
    masterKey?: KeyInput
  ): Promise<APIKey> {
    return this.update(id, tenantId, updates, masterKey);
  }

  /**
   * Updates an API key's status and circuit breaker timeout.
   */
  async updateStatus(
    id: string,
    tenantId: string,
    status: KeyStatus,
    circuitOpenUntil: string | null = null
  ): Promise<void> {
    if (!isKeyStatus(status)) {
      throw new InvalidKeyError(`Invalid key status: '${status}'`, {
        reason: "invalid_status",
      });
    }

    // Verify key exists before updating
    await this.getByIdOrThrow(id, tenantId);

    const sql = `
      UPDATE api_keys
      SET status = ?, circuit_open_until = ?
      WHERE id = ? AND tenant_id = ?
    `;

    await this.db.prepare(sql).bind(status, circuitOpenUntil, id, tenantId).run();
  }

  /**
   * Alias for `updateStatus`.
   */
  async updateKeyStatus(
    id: string,
    tenantId: string,
    status: KeyStatus,
    circuitOpenUntil: string | null = null
  ): Promise<void> {
    return this.updateStatus(id, tenantId, status, circuitOpenUntil);
  }

  /**
   * Updates the `last_used_at` timestamp for a key.
   */
  async recordUsage(
    id: string,
    tenantId?: string,
    timestamp?: string
  ): Promise<void> {
    const ts = timestamp ?? new Date().toISOString();
    let sql = `UPDATE api_keys SET last_used_at = ? WHERE id = ?`;
    const params: unknown[] = [ts, id];

    if (tenantId !== undefined) {
      sql += ` AND tenant_id = ?`;
      params.push(tenantId);
    }

    await this.db.prepare(sql).bind(...params).run();
  }

  /**
   * Alias for `recordUsage`.
   */
  async recordKeyUsage(
    id: string,
    tenantId?: string,
    timestamp?: string
  ): Promise<void> {
    return this.recordUsage(id, tenantId, timestamp);
  }

  /**
   * Deletes an API key from Cloudflare D1.
   */
  async delete(id: string, tenantId: string): Promise<boolean> {
    const existing = await this.getById(id, tenantId);
    if (!existing) {
      return false;
    }

    const sql = `DELETE FROM api_keys WHERE id = ? AND tenant_id = ?`;
    await this.db.prepare(sql).bind(id, tenantId).run();
    return true;
  }

  /**
   * Alias for `delete`.
   */
  async deleteApiKey(id: string, tenantId: string): Promise<boolean> {
    return this.delete(id, tenantId);
  }

  /**
   * Alias for `delete`.
   */
  async deleteKey(id: string, tenantId: string): Promise<boolean> {
    return this.delete(id, tenantId);
  }

  /**
   * Counts the total number of API keys for a tenant with optional filtering.
   */
  async countByTenant(
    tenantId: string,
    options?: CountApiKeysOptions
  ): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM api_keys WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (options?.provider) {
      sql += ` AND provider = ?`;
      params.push(options.provider);
    }

    if (options?.status) {
      sql += ` AND status = ?`;
      params.push(options.status);
    }

    const row = await this.db
      .prepare(sql)
      .bind(...params)
      .first<{ count: number }>();

    return row?.count ?? 0;
  }

  /**
   * Alias for `countByTenant`.
   */
  async countApiKeysByTenant(
    tenantId: string,
    options?: CountApiKeysOptions
  ): Promise<number> {
    return this.countByTenant(tenantId, options);
  }
}

/**
 * Backward compatibility and alternate naming alias.
 */
export const ApiKeysRepository = ApiKeyRepository;
export type ApiKeysRepository = ApiKeyRepository;
