/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * API Key Repository Types & Interfaces
 */

import { APIKey, KeyStatus, ModelProvider } from "../../../types/models";

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
