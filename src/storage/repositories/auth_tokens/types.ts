import type { KeyInput } from "../../../crypto";

/**
 * Fixed-point int64 microdollars (1 USD = 1,000,000 µ$).
 * Zero floating-point math allowed for financial values (GEMINI.md Invariant).
 */
export type Microdollars = bigint;


/**
 * Raw database row shape for the `auth_tokens` table in Cloudflare D1.
 */
export interface AuthTokenRow {
  id: string;
  hash_sha256: string;
  tenant_id: string;
  encrypted_token_b64: string | null;
  nonce_b64: string | null;
  budget_microdollars: number | bigint;
  spent_microdollars: number | bigint;
  allowed_providers: string;
  rpm_limit: number;
  expires_at: string | null;
  created_at: string;
}

/**
 * Domain representation of an AuthToken record in memory.
 */
export interface AuthTokenRecord {
  /** Unique token identifier (UUID) */
  id: string;
  /** SHA-256 lowercase hex hash of the raw token for O(1) lookup */
  hashSha256: string;
  /** Tenant ID owning this token (strict tenant isolation boundary) */
  tenantId: string;
  /** AES-256-GCM encrypted ciphertext in base64 format */
  encryptedTokenB64?: string | null;
  /** 12-byte initialization vector / nonce in base64 format */
  nonceB64?: string | null;
  /** Spending budget ceiling in int64 microdollars (0n = unlimited / no ceiling) */
  budgetMicrodollars: Microdollars;
  /** Total spend accumulated in int64 microdollars */
  spentMicrodollars: Microdollars;
  /** List of allowed model provider names (empty array means all providers allowed) */
  allowedProviders: string[];
  /** Requests-per-minute rate limit */
  rpmLimit: number;
  /** ISO-8601 expiration timestamp (or null if indefinite) */
  expiresAt: string | null;
  /** ISO-8601 creation timestamp */
  createdAt: string;
}

/**
 * Parameters for creating a new authentication token.
 */
export interface CreateAuthTokenParams {
  /** Optional custom UUID. Generated automatically if omitted. */
  id?: string;
  /** Plaintext bearer token to encrypt and hash. Plaintext is NEVER stored in D1. */
  token: string;
  /** Tenant ID to associate with the token. */
  tenantId: string;
  /** Optional encryption master key or secret passphrase. Overrides repository default. */
  encryptionKey?: KeyInput;
  /** Spending budget ceiling in int64 microdollars (defaults to 0n = unlimited). */
  budgetMicrodollars?: Microdollars | number;
  /** Initial spend in int64 microdollars (defaults to 0n). */
  spentMicrodollars?: Microdollars | number;
  /** List of allowed providers (e.g. ['google', 'openai']). Defaults to [] (all allowed). */
  allowedProviders?: string[];
  /** Requests-per-minute rate limit (defaults to DEFAULT_RPM_LIMIT = 60). */
  rpmLimit?: number;
  /** Optional expiration timestamp (ISO string, Date, or null). */
  expiresAt?: string | Date | null;
}

/**
 * Configuration options for AuthTokensRepository.
 */
export interface AuthTokenRepositoryConfig {
  /** Default AES-256-GCM master key for encrypting tokens. */
  masterKey?: KeyInput;
}

/**
 * Result of validating an incoming bearer token.
 */
export interface TokenValidationResult {
  /** Whether the token is valid, active, within budget, and allowed for requested provider */
  valid: boolean;
  /** Failure reason code if validation failed */
  reason?: "invalid_token" | "expired_token" | "provider_not_allowed" | "budget_exceeded" | string;
  /** Loaded AuthToken record if found */
  token?: AuthTokenRecord;
}

/**
 * Parameters for updating an existing auth token.
 */
export interface UpdateAuthTokenParams {
  budgetMicrodollars?: bigint | number;
  allowedProviders?: string[];
  rpmLimit?: number;
  expiresAt?: string | Date | null;
}
