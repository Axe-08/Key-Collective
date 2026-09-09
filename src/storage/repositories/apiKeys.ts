/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Storage Layer: API Key D1 Repository
 *
 * Invariants & Standards:
 * - No Plaintext Keys: AES-256-GCM encryption via Web Crypto API with unique 12-byte nonces.
 * - Ciphertext (`encrypted_key_b64`) and nonce (`nonce_b64`) stored in Cloudflare D1. Plaintext is NEVER persisted.
 * - Per-Tenant Isolation: All queries are strictly scoped by `tenant_id`.
 * - UI Masking: First 6 characters (`key_prefix`) and last 4 characters (`key_suffix`) stored for dashboard display (ADR 002).
 * - Strict TypeScript: No `any`, strict null checks, full type safety.
 */

import {
  KEY_MASK_PREFIX_LENGTH,
  KEY_MASK_SUFFIX_LENGTH,
  NONCE_LENGTH_BYTES,
  isValidNonceLength,
  maskApiKey,
} from "../../constants/crypto";
import {
  DEFAULT_RPD_LIMIT,
  DEFAULT_RPM_LIMIT,
  MAX_RPM_LIMIT,
  MIN_RPM_LIMIT,
  isValidRpmLimit,
} from "../../constants/limits";
import {
  KeyInput,
  base64ToUint8Array,
  decrypt,
  encrypt,
} from "../../crypto/encryption";
import {
  DecryptionError,
  EncryptionError,
  InvalidKeyError,
  KeyNotFoundError,
} from "../../errors/key_errors";
import {
  APIKey,
  KeyStatus,
  ModelProvider,
  isKeyStatus,
  isModelProvider,
} from "../../types/models";

/**
 * Raw database row structure for table `api_keys` in Cloudflare D1.
 * Conforms to `src/storage/migrations/0001_initial_schema.sql`.
 */
export interface APIKeyRow {
  id: string;
  tenant_id: string;
  label: string;
  provider: string;
  encrypted_key_b64: string;
  nonce_b64: string;
  key_prefix: string;
  key_suffix: string;
  rpm_limit: number;
  rpd_limit: number;
  priority: number;
  status: string;
  circuit_open_until: string | null;
  last_used_at: string | null;
  created_at: string;
}

/**
 * Input for creating and encrypting a new API key record.
 */
export interface CreateApiKeyInput {
  /** Optional custom ID. If omitted, a cryptographically secure UUIDv4 is generated */
  id?: string;
  /** Tenant ID owning this key */
  tenantId: string;
  /** Human-readable key label (e.g. "Production OpenAI Primary") */
  label: string;
  /** Model provider this key is valid for */
  provider: ModelProvider;
  /** Plaintext upstream API key to be encrypted via AES-256-GCM. NEVER stored directly */
  plaintextKey: string;
  /** Requests per minute limit (defaults to 60) */
  rpmLimit?: number;
  /** Requests per day limit (defaults to 1500) */
  rpdLimit?: number;
  /** Priority tier for load balancing and routing (defaults to 0) */
  priority?: number;
  /** Health status (defaults to "Healthy") */
  status?: KeyStatus;
  /** Optional timestamp until which circuit breaker is open */
  circuitOpenUntil?: string | null;
  /** Optional creation timestamp (ISO-8601) */
  createdAt?: string;
}

/**
 * Input for inserting a pre-encrypted API key record.
 */
export interface InsertEncryptedApiKeyInput {
  /** Optional custom ID. If omitted, a cryptographically secure UUIDv4 is generated */
  id?: string;
  /** Tenant ID owning this key */
  tenantId: string;
  /** Human-readable key label */
  label: string;
  /** Model provider this key is valid for */
  provider: ModelProvider;
  /** AES-256-GCM ciphertext encoded as Base64 */
  encryptedKeyB64: string;
  /** 12-byte initialization vector encoded as Base64 */
  nonceB64: string;
  /** Key prefix for dashboard masking (defaults to masked placeholder if omitted) */
  keyPrefix?: string;
  /** Key suffix for dashboard masking (defaults to masked placeholder if omitted) */
  keySuffix?: string;
  /** Requests per minute limit (defaults to 60) */
  rpmLimit?: number;
  /** Requests per day limit (defaults to 1500) */
  rpdLimit?: number;
  /** Priority tier (defaults to 0) */
  priority?: number;
  /** Health status (defaults to "Healthy") */
  status?: KeyStatus;
  /** Optional timestamp until which circuit breaker is open */
  circuitOpenUntil?: string | null;
  /** Optional last used timestamp (ISO-8601) */
  lastUsedAt?: string | null;
  /** Optional creation timestamp (ISO-8601) */
  createdAt?: string;
}

/**
 * Partial update fields for an existing API key.
 */
export interface UpdateApiKeyInput {
  /** Updated human-readable label */
  label?: string;
  /** Updated requests-per-minute limit */
  rpmLimit?: number;
  /** Updated requests-per-day limit */
  rpdLimit?: number;
  /** Updated priority tier */
  priority?: number;
  /** Updated health / circuit breaker status */
  status?: KeyStatus;
  /** Updated circuit breaker cooldown timestamp */
  circuitOpenUntil?: string | null;
  /** If provided, rotates the key by encrypting with a fresh 12-byte nonce */
  plaintextKey?: string;
}

/**
 * Query options for filtering and paginating tenant API keys.
 */
export interface ListApiKeysOptions {
  /** Filter by model provider */
  provider?: ModelProvider;
  /** Filter by key status */
  status?: KeyStatus;
  /** Maximum number of records to return */
  limit?: number;
  /** Number of records to skip for pagination */
  offset?: number;
}

/**
 * Query options for counting tenant API keys.
 */
export interface CountApiKeysOptions {
  /** Filter by model provider */
  provider?: ModelProvider;
  /** Filter by key status */
  status?: KeyStatus;
}

/**
 * Maps a raw D1 `api_keys` row to the domain `APIKey` interface.
 */
export function mapRowToAPIKey(row: APIKeyRow): APIKey {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    label: row.label,
    provider: row.provider as ModelProvider,
    encryptedKeyB64: row.encrypted_key_b64,
    nonceB64: row.nonce_b64,
    keyPrefix: row.key_prefix,
    keySuffix: row.key_suffix,
    rpmLimit: row.rpm_limit,
    rpdLimit: row.rpd_limit,
    priority: row.priority,
    status: row.status as KeyStatus,
    circuitOpenUntil: row.circuit_open_until ?? null,
    lastUsedAt: row.last_used_at ?? null,
    createdAt: row.created_at,
  };
}

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
   * Resolves the encryption key secret, throwing EncryptionError if missing.
   */
  private resolveMasterKeyForEncryption(overrideKey?: KeyInput): KeyInput {
    const key = overrideKey ?? this.masterKey;
    if (!key) {
      throw new EncryptionError(
        "Master encryption key not configured for ApiKeyRepository. Provide masterKey in constructor or method call."
      );
    }
    return key;
  }

  /**
   * Resolves the decryption key secret, throwing DecryptionError if missing.
   */
  private resolveMasterKeyForDecryption(overrideKey?: KeyInput): KeyInput {
    const key = overrideKey ?? this.masterKey;
    if (!key) {
      throw new DecryptionError(
        "Master encryption key not configured for ApiKeyRepository. Provide masterKey in constructor or method call."
      );
    }
    return key;
  }

  /**
   * Validates creation input parameters.
   */
  private validateCreateInput(input: CreateApiKeyInput): void {
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new InvalidKeyError("Tenant ID cannot be empty", {
        reason: "missing_tenant_id",
      });
    }
    if (!input.plaintextKey || input.plaintextKey.trim().length === 0) {
      throw new InvalidKeyError("Plaintext API key cannot be empty", {
        reason: "missing_plaintext_key",
      });
    }
    if (!input.provider || !isModelProvider(input.provider)) {
      throw new InvalidKeyError(`Invalid model provider: '${input.provider}'`, {
        provider: String(input.provider),
        reason: "invalid_provider",
      });
    }
    if (!input.label || input.label.trim().length === 0) {
      throw new InvalidKeyError("Key label cannot be empty", {
        reason: "missing_label",
      });
    }
    if (input.rpmLimit !== undefined && !isValidRpmLimit(input.rpmLimit)) {
      throw new InvalidKeyError(
        `Invalid RPM limit: ${input.rpmLimit}. Must be an integer between ${MIN_RPM_LIMIT} and ${MAX_RPM_LIMIT}.`,
        { reason: "invalid_rpm_limit" }
      );
    }
    if (
      input.rpdLimit !== undefined &&
      (!Number.isInteger(input.rpdLimit) || input.rpdLimit < 1)
    ) {
      throw new InvalidKeyError(
        `Invalid RPD limit: ${input.rpdLimit}. Must be a positive integer.`,
        { reason: "invalid_rpd_limit" }
      );
    }
    if (input.status !== undefined && !isKeyStatus(input.status)) {
      throw new InvalidKeyError(`Invalid key status: '${input.status}'`, {
        reason: "invalid_status",
      });
    }
  }

  /**
   * Encrypts and persists a new API key into Cloudflare D1.
   * Plaintext keys are NEVER written to the database.
   *
   * @param input Creation payload including plaintext key
   * @param masterKey Optional override for master key secret
   * @returns Persisted APIKey metadata record
   */
  async create(input: CreateApiKeyInput, masterKey?: KeyInput): Promise<APIKey> {
    this.validateCreateInput(input);

    const keySecret = this.resolveMasterKeyForEncryption(masterKey);
    const encrypted = await encrypt(input.plaintextKey, keySecret);

    const masked = maskApiKey(
      input.plaintextKey,
      KEY_MASK_PREFIX_LENGTH,
      KEY_MASK_SUFFIX_LENGTH
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
        encrypted.ciphertextB64,
        encrypted.nonceB64,
        masked.prefix,
        masked.suffix,
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
      encryptedKeyB64: encrypted.ciphertextB64,
      nonceB64: encrypted.nonceB64,
      keyPrefix: masked.prefix,
      keySuffix: masked.suffix,
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
    if (!input.provider || !isModelProvider(input.provider)) {
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

    let nonceBytes: Uint8Array;
    try {
      nonceBytes = base64ToUint8Array(input.nonceB64);
    } catch {
      throw new InvalidKeyError("Invalid nonce Base64 encoding", {
        reason: "invalid_nonce_base64",
      });
    }

    if (!isValidNonceLength(nonceBytes.byteLength)) {
      throw new InvalidKeyError(
        `Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes (96 bits), got ${nonceBytes.byteLength} bytes`,
        { reason: "invalid_nonce_length" }
      );
    }

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
   *
   * @param id Unique key identifier
   * @param tenantId Optional tenant ID for boundary enforcement
   * @returns APIKey or null if not found
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
   * Results are ordered by priority DESC (highest priority first), then created_at ASC.
   *
   * @param tenantId Tenant identifier
   * @param options Optional provider, status, and pagination options
   * @returns Array of APIKey records
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
   * Ordered by priority tier DESC, created_at ASC.
   * Suitable for hydrating Durable Object key pools.
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
   *
   * @param key APIKey record containing encryptedKeyB64 and nonceB64
   * @param masterKey Optional master encryption secret override
   * @returns Decrypted plaintext API key string
   * @throws DecryptionError if verification tag fails or key is invalid
   */
  async decryptKey(key: APIKey, masterKey?: KeyInput): Promise<string> {
    const keySecret = this.resolveMasterKeyForDecryption(masterKey);
    try {
      return await decrypt(
        {
          ciphertext: key.encryptedKeyB64,
          nonce: key.nonceB64,
        },
        keySecret
      );
    } catch (err) {
      if (err instanceof DecryptionError) {
        throw err;
      }
      throw new DecryptionError(
        `Failed to decrypt API key '${key.id}': ${err instanceof Error ? err.message : String(err)}`,
        { keyId: key.id, provider: key.provider }
      );
    }
  }

  /**
   * Alias for `decryptKey`.
   */
  async decryptApiKey(key: APIKey, masterKey?: KeyInput): Promise<string> {
    return this.decryptKey(key, masterKey);
  }

  /**
   * Fetches an API key from D1 and decrypts its ciphertext into plaintext.
   *
   * @param id Key identifier
   * @param tenantId Tenant identifier for boundary check
   * @param masterKey Optional master encryption secret override
   * @returns Plaintext API key string
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
   * If `plaintextKey` is provided, generates a fresh 12-byte nonce, re-encrypts the key,
   * updates the masked prefix/suffix, and replaces the stored ciphertext.
   *
   * @param id Key identifier
   * @param tenantId Tenant identifier
   * @param updates Updated fields
   * @param masterKey Optional master encryption key override
   * @returns Updated APIKey record
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
      const keySecret = this.resolveMasterKeyForEncryption(masterKey);
      const encrypted = await encrypt(updates.plaintextKey, keySecret);
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
   * Typically called when circuit breaker transitions state in Durable Objects.
   *
   * @param id Key identifier
   * @param tenantId Tenant identifier
   * @param status New status
   * @param circuitOpenUntil Cooldown timestamp (ISO-8601 or null)
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
   *
   * @param id Key identifier
   * @param tenantId Optional tenant identifier for boundary check
   * @param timestamp ISO-8601 timestamp (defaults to current time)
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
   * Strict tenant scoping ensures cross-tenant deletion is impossible.
   *
   * @param id Key identifier
   * @param tenantId Tenant identifier
   * @returns true if deleted, false if key was not found
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
