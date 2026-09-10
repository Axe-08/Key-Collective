/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Durable Object Key Decryption Helper (AES-256-GCM)
 *
 * Conforms to TASK-DOP-02 & LLD 1.2 / 3.4:
 * - Implement helper to decrypt keys using Web Crypto API.
 * - Nonce must strictly be 12-bytes (96 bits) as mandated by AES-GCM standard & GEMINI.md.
 * - Strict TypeScript: No `any`, strict mode, strict null checks.
 * - Per-Tenant DO Isolation: Operates on tenant-isolated EncryptedKey records.
 * - Fixed-Point Microdollars: Ecosystem alignment with zero floating-point math.
 */

import {
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_KEY_LENGTH,
  ENCRYPTION_KEY_LENGTH_BYTES,
  MASTER_KEY_ENV_VAR,
  NONCE_LENGTH_BYTES,
  TAG_LENGTH_BITS,
  TAG_LENGTH_BYTES,
  isValidKeyLength,
  isValidNonceLength,
} from "../constants/crypto";
import {
  DecryptionError,
  EncryptionError,
  InvalidKeyError,
} from "../errors/key_errors";
import {
  base64ToUint8Array,
  deriveKey,
  generateNonce,
  generateNonceB64,
  importRawKey,
  uint8ArrayToBase64,
  type KeyInput,
} from "../crypto/encryption";

/**
 * EncryptedKey contract definition.
 * Matches TASK-DOP-02 exact signatures:
 * export interface EncryptedKey { id: string; tenantId: string; provider: string; ciphertext: string; nonce: string; }
 */
export interface EncryptedKey {
  id: string;
  tenantId: string;
  provider: string;
  ciphertext: string;
  nonce: string;
  label?: string;
  priority?: number;
  rpmLimit?: number;
  rpdLimit?: number;
  status?: string;
  circuitOpenUntil?: string | null;
  lastUsedAt?: string | number | null;
}

/**
 * Resolves the master encryption secret key for decryption.
 * Inspects explicit parameter, then falls back to environment variable (KC_MASTER_KEY).
 *
 * @param masterKey Optional master secret passphrase, raw bytes, or CryptoKey
 * @throws DecryptionError if master key is missing or empty
 */
export function resolveMasterKey(masterKey?: KeyInput): KeyInput {
  if (masterKey !== undefined && masterKey !== null) {
    if (typeof masterKey === "string") {
      if (masterKey.trim().length === 0) {
        throw new DecryptionError("Master encryption key cannot be empty");
      }
      return masterKey;
    }
    if (masterKey instanceof Uint8Array) {
      if (masterKey.byteLength === 0) {
        throw new DecryptionError("Master encryption key bytes cannot be empty");
      }
      return masterKey;
    }
    return masterKey;
  }

  // Fallback to environment variable if available in runtime
  const envKey =
    typeof process !== "undefined" && process.env
      ? process.env[MASTER_KEY_ENV_VAR] || process.env.MASTER_KEY
      : undefined;

  if (envKey && envKey.trim().length > 0) {
    return envKey;
  }

  throw new DecryptionError(
    `Master encryption key not provided. Supply masterKey or set ${MASTER_KEY_ENV_VAR} environment variable.`
  );
}

/**
 * Resolves a KeyInput into an AES-GCM CryptoKey for Web Crypto decryption.
 */
async function resolveCryptoKey(key: KeyInput): Promise<CryptoKey> {
  if (
    typeof key === "object" &&
    key !== null &&
    "type" in key &&
    "algorithm" in key &&
    (key as CryptoKey).type === "secret"
  ) {
    return key as CryptoKey;
  }

  if (typeof key === "string") {
    try {
      return await deriveKey(key);
    } catch (err) {
      throw new DecryptionError(
        `Failed to derive AES-256-GCM key: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (key instanceof Uint8Array) {
    try {
      if (key.byteLength === ENCRYPTION_KEY_LENGTH_BYTES) {
        return await importRawKey(key);
      }
      return await deriveKey(key);
    } catch (err) {
      throw new DecryptionError(
        `Failed to resolve AES-256-GCM key: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  throw new DecryptionError(
    "Invalid key type: expected CryptoKey, string passphrase, or 32-byte Uint8Array"
  );
}

/**
 * Validates whether a given nonce (Uint8Array or base64 string) is exactly 12 bytes (96 bits).
 *
 * @param nonce Nonce bytes or base64 encoded string
 * @returns true if nonce is exactly 12 bytes, false otherwise
 */
export function validateNonce(nonce: Uint8Array | string): boolean {
  try {
    const bytes = typeof nonce === "string" ? base64ToUint8Array(nonce) : nonce;
    return isValidNonceLength(bytes.byteLength);
  } catch {
    return false;
  }
}

/**
 * Type guard for EncryptedKey interface.
 */
export function isEncryptedKey(value: unknown): value is EncryptedKey {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    typeof candidate.tenantId === "string" &&
    typeof candidate.provider === "string" &&
    candidate.provider.trim().length > 0 &&
    typeof candidate.ciphertext === "string" &&
    candidate.ciphertext.trim().length > 0 &&
    typeof candidate.nonce === "string" &&
    candidate.nonce.trim().length > 0
  );
}

/**
 * Decrypts an EncryptedKey record or separated ciphertext/nonce into raw plaintext bytes.
 * Enforces strictly that the nonce must be 12-bytes (96 bits) and authentication tag is 128-bit.
 *
 * @param key EncryptedKey record containing ciphertext and nonce
 * @param masterKey Optional master secret passphrase, raw bytes, or CryptoKey
 * @returns Raw decrypted plaintext bytes
 * @throws DecryptionError if nonce is not 12 bytes, ciphertext is corrupted, or auth tag fails
 */
export async function decryptKeyRaw(
  key: EncryptedKey,
  masterKey?: KeyInput
): Promise<Uint8Array> {
  if (typeof key !== "object" || key === null) {
    throw new DecryptionError(
      `Invalid encrypted key payload: expected object, got ${key === null ? "null" : typeof key}`
    );
  }

  if (!key.ciphertext || typeof key.ciphertext !== "string" || key.ciphertext.trim().length === 0) {
    throw new DecryptionError("Ciphertext is required for decryption", {
      keyId: key.id,
      provider: key.provider,
    });
  }

  if (!key.nonce || typeof key.nonce !== "string" || key.nonce.trim().length === 0) {
    throw new DecryptionError(
      `Nonce is required and must be exactly ${NONCE_LENGTH_BYTES} bytes`,
      { keyId: key.id, provider: key.provider }
    );
  }

  // Parse and validate 12-byte nonce
  let nonceBytes: Uint8Array;
  try {
    nonceBytes = base64ToUint8Array(key.nonce);
  } catch (err) {
    throw new DecryptionError(
      `Failed to decode base64 nonce: ${err instanceof Error ? err.message : String(err)}`,
      { keyId: key.id, provider: key.provider }
    );
  }

  if (nonceBytes.byteLength !== NONCE_LENGTH_BYTES) {
    throw new DecryptionError(
      `Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes (96 bits), got ${nonceBytes.byteLength} bytes`,
      {
        keyId: key.id,
        provider: key.provider,
        nonceLengthBytes: nonceBytes.byteLength,
      }
    );
  }

  // Parse and validate ciphertext bytes
  let ciphertextBytes: Uint8Array;
  try {
    ciphertextBytes = base64ToUint8Array(key.ciphertext);
  } catch (err) {
    throw new DecryptionError(
      `Failed to decode base64 ciphertext: ${err instanceof Error ? err.message : String(err)}`,
      { keyId: key.id, provider: key.provider }
    );
  }

  if (ciphertextBytes.byteLength < TAG_LENGTH_BYTES) {
    throw new DecryptionError(
      `Ciphertext too short: missing ${TAG_LENGTH_BYTES}-byte authentication tag`,
      {
        keyId: key.id,
        provider: key.provider,
        nonceLengthBytes: nonceBytes.byteLength,
      }
    );
  }

  // Resolve master key and derive CryptoKey
  const resolvedKey = resolveMasterKey(masterKey);
  const cryptoKey = await resolveCryptoKey(resolvedKey);

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: nonceBytes,
        tagLength: TAG_LENGTH_BITS,
      },
      cryptoKey,
      ciphertextBytes
    );
  } catch (err) {
    throw new DecryptionError(
      "AES-GCM decryption failed: invalid ciphertext or corrupted nonce tag",
      {
        keyId: key.id,
        provider: key.provider,
        nonceLengthBytes: nonceBytes.byteLength,
        details: {
          cause: err instanceof Error ? err.message : String(err),
        },
      }
    );
  }

  return new Uint8Array(decryptedBuffer);
}

/**
 * Decrypts an EncryptedKey record into a UTF-8 plaintext string.
 *
 * Overload 1: decryptKey(key: EncryptedKey, masterKey?: KeyInput)
 * Overload 2: decryptKey(ciphertext: string, nonce: string, masterKey?: KeyInput)
 *
 * @param keyOrCiphertext EncryptedKey object or base64 ciphertext string
 * @param masterKeyOrNonce Master key secret OR base64 nonce string if using positional args
 * @param maybeMasterKey Master key secret when using positional args
 * @returns Plaintext API key string
 * @throws DecryptionError if verification tag fails, nonce is not 12-bytes, or data is corrupted
 */
export async function decryptKey(
  key: EncryptedKey,
  masterKey?: KeyInput
): Promise<string>;
export async function decryptKey(
  ciphertext: string,
  nonce: string,
  masterKey?: KeyInput
): Promise<string>;
export async function decryptKey(
  keyOrCiphertext: EncryptedKey | string,
  masterKeyOrNonce?: KeyInput | string,
  maybeMasterKey?: KeyInput
): Promise<string> {
  let targetKey: EncryptedKey;
  let masterKey: KeyInput | undefined;

  if (typeof keyOrCiphertext === "string") {
    if (typeof masterKeyOrNonce !== "string") {
      throw new DecryptionError(
        "Positional decryptKey requires (ciphertext: string, nonce: string, masterKey?: KeyInput)"
      );
    }
    targetKey = {
      id: "ephemeral-key",
      tenantId: "ephemeral-tenant",
      provider: "unknown",
      ciphertext: keyOrCiphertext,
      nonce: masterKeyOrNonce,
    };
    masterKey = maybeMasterKey;
  } else {
    targetKey = keyOrCiphertext;
    masterKey = masterKeyOrNonce as KeyInput | undefined;
  }

  const rawBytes = await decryptKeyRaw(targetKey, masterKey);

  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    return decoder.decode(rawBytes);
  } catch (err) {
    throw new DecryptionError(
      `Failed to decode decrypted plaintext as UTF-8: ${err instanceof Error ? err.message : String(err)}`,
      { keyId: targetKey.id, provider: targetKey.provider }
    );
  }
}

/**
 * Alias for `decryptKey` conforming to naming conventions.
 */
export async function decryptApiKey(
  key: EncryptedKey,
  masterKey?: KeyInput
): Promise<string> {
  return decryptKey(key, masterKey);
}

/**
 * Direct `decrypt` helper for EncryptedKey.
 */
export async function decrypt(
  key: EncryptedKey,
  masterKey?: KeyInput
): Promise<string> {
  return decryptKey(key, masterKey);
}

/**
 * Helper to encrypt a plaintext key into an EncryptedKey record.
 * Generates a cryptographically random 12-byte nonce (96 bits) by default.
 *
 * @param plaintext Plaintext API key
 * @param tenantId Tenant identifier owning this key
 * @param provider Target LLM provider (e.g. "openai", "anthropic")
 * @param masterKey Master key secret passphrase, raw bytes, or CryptoKey
 * @param options Optional metadata overrides (id, nonce, label, priority)
 * @returns Complete EncryptedKey record ready for DO or D1 storage
 */
export async function encryptKey(
  plaintext: string | Uint8Array,
  tenantId: string,
  provider: string,
  masterKey: KeyInput,
  options?: {
    id?: string;
    nonce?: Uint8Array | string;
    label?: string;
    priority?: number;
    rpmLimit?: number;
    rpdLimit?: number;
  }
): Promise<EncryptedKey> {
  if (!plaintext || (typeof plaintext === "string" && plaintext.length === 0)) {
    throw new EncryptionError("Plaintext cannot be empty");
  }
  if (!tenantId || tenantId.trim().length === 0) {
    throw new InvalidKeyError("tenantId cannot be empty");
  }
  if (!provider || provider.trim().length === 0) {
    throw new InvalidKeyError("provider cannot be empty");
  }

  const plaintextBytes =
    typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext;

  let nonceBytes: Uint8Array;
  if (options?.nonce === undefined) {
    nonceBytes = generateNonce(NONCE_LENGTH_BYTES);
  } else if (typeof options.nonce === "string") {
    nonceBytes = base64ToUint8Array(options.nonce);
  } else if (options.nonce instanceof Uint8Array) {
    nonceBytes = options.nonce;
  } else {
    throw new EncryptionError("Invalid nonce type: expected Uint8Array or base64 string");
  }

  if (nonceBytes.byteLength !== NONCE_LENGTH_BYTES) {
    throw new EncryptionError(
      `Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes, got ${nonceBytes.byteLength} bytes`
    );
  }

  const resolvedKey = resolveMasterKey(masterKey);
  const cryptoKey = await resolveCryptoKey(resolvedKey);

  let encryptedBuffer: ArrayBuffer;
  try {
    encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: nonceBytes,
        tagLength: TAG_LENGTH_BITS,
      },
      cryptoKey,
      plaintextBytes
    );
  } catch (err) {
    throw new EncryptionError(
      `AES-256-GCM encryption failed: ${err instanceof Error ? err.message : String(err)}`,
      { provider }
    );
  }

  const ciphertextBytes = new Uint8Array(encryptedBuffer);
  const ciphertextB64 = uint8ArrayToBase64(ciphertextBytes);
  const nonceB64 = uint8ArrayToBase64(nonceBytes);
  const keyId = options?.id ?? `key_${provider}_${crypto.randomUUID().slice(0, 8)}`;

  return {
    id: keyId,
    tenantId,
    provider,
    ciphertext: ciphertextB64,
    nonce: nonceB64,
    label: options?.label,
    priority: options?.priority ?? 100,
    rpmLimit: options?.rpmLimit,
    rpdLimit: options?.rpdLimit,
    status: "active",
  };
}

// Re-export core constants and types for complete convenience
export {
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_KEY_LENGTH,
  ENCRYPTION_KEY_LENGTH_BYTES,
  NONCE_LENGTH_BYTES,
  TAG_LENGTH_BITS,
  TAG_LENGTH_BYTES,
  MASTER_KEY_ENV_VAR,
  DecryptionError,
  EncryptionError,
  InvalidKeyError,
  generateNonce,
  generateNonceB64,
  uint8ArrayToBase64,
  base64ToUint8Array,
  deriveKey,
  importRawKey,
};
export type { KeyInput };
