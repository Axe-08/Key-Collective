/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Cryptographic System Constants (AES-256-GCM Invariant)
 *
 * Invariants:
 * - No Plaintext Keys: AES-256-GCM encryption via Web Crypto API with unique 12-byte nonces.
 * - Zero cross-tenant state leakage.
 * - Conforms to LLD 1.2:
 *   - ENCRYPTION_ALGORITHM: "AES-GCM"
 *   - ENCRYPTION_KEY_LENGTH: 256
 *   - NONCE_LENGTH_BYTES: 12
 * - Conforms to ADR 002:
 *   - Master key environment variable: "KC_MASTER_KEY"
 *   - Masking: first 6 chars and last 4 chars in plaintext for dashboard display.
 */

/**
 * Cryptographic cipher algorithm identifier for Web Crypto API.
 * As defined in LLD 1.2: ENCRYPTION_ALGORITHM = "AES-GCM".
 */
export const ENCRYPTION_ALGORITHM = "AES-GCM" as const;

/**
 * Cryptographic key bit length for AES-256.
 * As defined in LLD 1.2: ENCRYPTION_KEY_LENGTH = 256.
 */
export const ENCRYPTION_KEY_LENGTH = 256 as const;

/**
 * Cryptographic key byte length (256 bits = 32 bytes).
 */
export const ENCRYPTION_KEY_LENGTH_BYTES = 32 as const;

/**
 * Cryptographic nonce (Initialization Vector) byte length for AES-GCM.
 * As defined in LLD 1.2: NONCE_LENGTH_BYTES = 12 (96 bits), strictly required by Web Crypto API.
 */
export const NONCE_LENGTH_BYTES = 12 as const;

/**
 * Authentication tag length in bits for AES-GCM (128 bits = 16 bytes).
 */
export const TAG_LENGTH_BITS = 128 as const;

/**
 * Authentication tag length in bytes for AES-GCM (16 bytes).
 */
export const TAG_LENGTH_BYTES = 16 as const;

/**
 * Environment variable name containing the master encryption key secret.
 * Conforms to ADR 002.
 */
export const MASTER_KEY_ENV_VAR = "KC_MASTER_KEY" as const;

/**
 * Plaintext prefix length in characters retained for UI/dashboard key identification.
 * Conforms to ADR 002 (first 6 chars).
 */
export const KEY_MASK_PREFIX_LENGTH = 6 as const;

/**
 * Plaintext suffix length in characters retained for UI/dashboard key identification.
 * Conforms to ADR 002 (last 4 chars).
 */
export const KEY_MASK_SUFFIX_LENGTH = 4 as const;

/**
 * Structure containing masked API key components for secure UI presentation.
 */
export interface MaskedKeyParts {
  prefix: string;
  suffix: string;
  masked: string;
}

/**
 * Validates whether a byte length matches the required AES-GCM nonce length (12 bytes).
 */
export function isValidNonceLength(lengthBytes: number): boolean {
  return lengthBytes === NONCE_LENGTH_BYTES;
}

/**
 * Validates whether a key bit length matches the required AES-256 key length (256 bits).
 */
export function isValidKeyLength(lengthBits: number): boolean {
  return lengthBits === ENCRYPTION_KEY_LENGTH;
}

/**
 * Masks an API key for safe UI dashboard display and logging.
 * Retains KEY_MASK_PREFIX_LENGTH (first 6) and KEY_MASK_SUFFIX_LENGTH (last 4),
 * replacing the interior characters with bullet / ellipsis characters.
 *
 * If the key is shorter than prefix + suffix length, handles securely without throwing.
 */
export function maskApiKey(
  key: string,
  prefixLength: number = KEY_MASK_PREFIX_LENGTH,
  suffixLength: number = KEY_MASK_SUFFIX_LENGTH
): MaskedKeyParts {
  if (!key || key.length === 0) {
    return { prefix: "", suffix: "", masked: "" };
  }

  if (key.length <= prefixLength + suffixLength) {
    const prefix = key.slice(0, Math.min(prefixLength, key.length));
    return {
      prefix,
      suffix: "",
      masked: `${prefix}...`,
    };
  }

  const prefix = key.slice(0, prefixLength);
  const suffix = key.slice(-suffixLength);
  const masked = `${prefix}...${suffix}`;

  return { prefix, suffix, masked };
}
