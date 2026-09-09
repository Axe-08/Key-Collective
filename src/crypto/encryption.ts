/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Web Crypto AES-256-GCM Encryption & Decryption Helpers
 *
 * Invariants & Standards:
 * - No Plaintext Keys: AES-256-GCM encryption via Web Crypto API with unique 12-byte nonces.
 * - Conforms to LLD 1.2:
 *   - ENCRYPTION_ALGORITHM: "AES-GCM"
 *   - ENCRYPTION_KEY_LENGTH: 256 bits (32 bytes)
 *   - NONCE_LENGTH_BYTES: 12 bytes (96 bits)
 *   - TAG_LENGTH_BITS: 128 bits (16 bytes)
 * - Conforms to ADR 002:
 *   - Master key environment secret: KC_MASTER_KEY
 *   - SHA-256 key derivation when passphrase secret is provided
 * - Strict TypeScript: No `any`, strict null checks, full type safety.
 */

import {
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_KEY_LENGTH,
  ENCRYPTION_KEY_LENGTH_BYTES,
  NONCE_LENGTH_BYTES,
  TAG_LENGTH_BITS,
  TAG_LENGTH_BYTES,
  isValidKeyLength,
  isValidNonceLength,
} from "../constants/crypto";
import { DecryptionError, EncryptionError } from "../errors/key_errors";

/**
 * Result of an AES-256-GCM encryption operation.
 * Provides both raw byte representations and base64 strings
 * suitable for D1 database columns and binary payloads.
 */
export interface EncryptedData {
  /** Raw ciphertext including the 16-byte authentication tag */
  ciphertext: Uint8Array;
  /** Cryptographically unique 12-byte initialization vector / nonce */
  nonce: Uint8Array;
  /** Base64-encoded ciphertext for D1 `encrypted_key_b64` */
  ciphertextB64: string;
  /** Base64-encoded 12-byte nonce for D1 `nonce_b64` */
  nonceB64: string;
  /** Combined binary payload: 12-byte nonce prepended to ciphertext */
  combined: Uint8Array;
  /** Base64-encoded combined payload */
  combinedB64: string;
}

/**
 * Encrypted payload containing separated ciphertext and nonce,
 * each either as a base64 string or Uint8Array.
 */
export interface EncryptedPayload {
  ciphertext: string | Uint8Array;
  nonce: string | Uint8Array;
}

/**
 * Acceptable key types:
 * - `CryptoKey`: Pre-imported AES-GCM CryptoKey
 * - `string`: Master secret passphrase (derived via SHA-256 to 256-bit AES key)
 * - `Uint8Array`: 32-byte raw key or arbitrary secret bytes (derived via SHA-256)
 */
export type KeyInput = string | Uint8Array | CryptoKey;

/**
 * Plaintext input: UTF-8 string or raw byte array.
 */
export type PlaintextInput = string | Uint8Array;

/**
 * Ciphertext input for decryption:
 * - base64 string or Uint8Array (combined payload or separate with positional nonce)
 * - `EncryptedPayload` object containing `{ ciphertext, nonce }`
 */
export type CiphertextInput = string | Uint8Array | EncryptedPayload;

/**
 * Encodes a Uint8Array into a standard Base64 string.
 * Uses Web Crypto / standard Web APIs compatible with Cloudflare Workers.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 string into a Uint8Array.
 * Handles padding and URL-safe base64 variants.
 * Throws DecryptionError if the string is not valid base64.
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  try {
    let normalized = b64.trim().replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4 !== 0) {
      normalized += "=";
    }
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    throw new DecryptionError(
      `Failed to decode base64 data: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Generates a cryptographically secure random 12-byte nonce for AES-256-GCM.
 * Nonces must be unique per encryption operation under the same key.
 *
 * @param lengthBytes Nonce length in bytes (defaults to 12 bytes / 96 bits)
 * @throws EncryptionError if lengthBytes is not equal to 12
 */
export function generateNonce(lengthBytes: number = NONCE_LENGTH_BYTES): Uint8Array {
  if (!isValidNonceLength(lengthBytes)) {
    throw new EncryptionError(
      `Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes (96 bits), got ${lengthBytes} bytes`
    );
  }
  const nonce = new Uint8Array(lengthBytes);
  crypto.getRandomValues(nonce);
  return nonce;
}

/**
 * Generates a 12-byte random nonce and returns it as a Base64 string.
 */
export function generateNonceB64(lengthBytes: number = NONCE_LENGTH_BYTES): string {
  return uint8ArrayToBase64(generateNonce(lengthBytes));
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from a secret passphrase or byte sequence using SHA-256.
 * Matches Key Collective architecture specification and Go reference implementation.
 *
 * @param secret Master key secret passphrase or byte array
 * @returns CryptoKey configured for AES-GCM encryption and decryption
 * @throws EncryptionError if secret is empty or Web Crypto import fails
 */
export async function deriveKey(secret: string | Uint8Array): Promise<CryptoKey> {
  const secretBytes = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  if (secretBytes.byteLength === 0) {
    throw new EncryptionError("Master key secret cannot be empty");
  }

  try {
    const keyDigest = await crypto.subtle.digest("SHA-256", secretBytes);
    return await crypto.subtle.importKey(
      "raw",
      keyDigest,
      { name: ENCRYPTION_ALGORITHM },
      false,
      ["encrypt", "decrypt"]
    );
  } catch (err) {
    if (err instanceof EncryptionError) {
      throw err;
    }
    throw new EncryptionError(
      `Failed to derive AES-256-GCM key: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Imports an existing 32-byte (256-bit) raw key directly as an AES-GCM CryptoKey.
 *
 * @param rawKey 32-byte key material
 * @throws EncryptionError if rawKey length is not exactly 32 bytes (256 bits)
 */
export async function importRawKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.byteLength !== ENCRYPTION_KEY_LENGTH_BYTES || !isValidKeyLength(rawKey.byteLength * 8)) {
    throw new EncryptionError(
      `Invalid raw key length: expected ${ENCRYPTION_KEY_LENGTH_BYTES} bytes (${ENCRYPTION_KEY_LENGTH} bits), got ${rawKey.byteLength} bytes`
    );
  }

  try {
    return await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: ENCRYPTION_ALGORITHM },
      false,
      ["encrypt", "decrypt"]
    );
  } catch (err) {
    throw new EncryptionError(
      `Failed to import raw AES-GCM key: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Determines whether a value is a valid Web Crypto CryptoKey.
 */
function isCryptoKey(value: unknown): value is CryptoKey {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "algorithm" in value &&
    (value as CryptoKey).type === "secret"
  );
}

/**
 * Resolves a KeyInput into an AES-GCM CryptoKey for encryption.
 */
async function resolveKeyForEncryption(key: KeyInput): Promise<CryptoKey> {
  if (isCryptoKey(key)) {
    return key;
  }
  if (typeof key === "string") {
    if (key.length === 0) {
      throw new EncryptionError("Encryption key cannot be empty");
    }
    return await deriveKey(key);
  }
  if (key instanceof Uint8Array) {
    if (key.byteLength === ENCRYPTION_KEY_LENGTH_BYTES) {
      return await importRawKey(key);
    }
    return await deriveKey(key);
  }
  throw new EncryptionError("Invalid key type: expected CryptoKey, string, or Uint8Array");
}

/**
 * Resolves a KeyInput into an AES-GCM CryptoKey for decryption.
 */
async function resolveKeyForDecryption(key: KeyInput): Promise<CryptoKey> {
  if (isCryptoKey(key)) {
    return key;
  }
  if (typeof key === "string") {
    if (key.length === 0) {
      throw new DecryptionError("Decryption key cannot be empty");
    }
    try {
      return await deriveKey(key);
    } catch (err) {
      throw new DecryptionError(
        `Failed to derive decryption key: ${err instanceof Error ? err.message : String(err)}`
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
        `Failed to resolve decryption key: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  throw new DecryptionError("Invalid key type: expected CryptoKey, string, or Uint8Array");
}

/**
 * Encrypts plaintext data using Web Crypto AES-256-GCM.
 *
 * Automatically generates a cryptographically random 12-byte nonce if not provided.
 * Enforces strictly that the nonce is 12 bytes (96 bits) and tag length is 128 bits.
 *
 * @param plaintext Plaintext UTF-8 string or Uint8Array bytes
 * @param key Master secret passphrase, raw 32-byte key, or CryptoKey
 * @param nonce Optional 12-byte nonce (Uint8Array or base64). If omitted, a fresh random nonce is generated.
 * @returns EncryptedData with separated ciphertext, nonce, and combined formats
 * @throws EncryptionError if key or nonce is invalid or Web Crypto operation fails
 */
export async function encrypt(
  plaintext: PlaintextInput,
  key: KeyInput,
  nonce?: Uint8Array | string
): Promise<EncryptedData> {
  const plaintextBytes =
    typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext;

  let nonceBytes: Uint8Array;
  if (nonce === undefined) {
    nonceBytes = generateNonce();
  } else if (typeof nonce === "string") {
    nonceBytes = base64ToUint8Array(nonce);
  } else if (nonce instanceof Uint8Array) {
    nonceBytes = nonce;
  } else {
    throw new EncryptionError("Invalid nonce type: expected Uint8Array or base64 string");
  }

  if (!isValidNonceLength(nonceBytes.byteLength)) {
    throw new EncryptionError(
      `Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes, got ${nonceBytes.byteLength} bytes`
    );
  }

  const cryptoKey = await resolveKeyForEncryption(key);

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
      `AES-256-GCM encryption failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const ciphertext = new Uint8Array(encryptedBuffer);
  const combined = new Uint8Array(nonceBytes.byteLength + ciphertext.byteLength);
  combined.set(nonceBytes, 0);
  combined.set(ciphertext, nonceBytes.byteLength);

  const ciphertextB64 = uint8ArrayToBase64(ciphertext);
  const nonceB64 = uint8ArrayToBase64(nonceBytes);
  const combinedB64 = uint8ArrayToBase64(combined);

  return {
    ciphertext,
    nonce: nonceBytes,
    ciphertextB64,
    nonceB64,
    combined,
    combinedB64,
  };
}

/**
 * Decrypts AES-256-GCM encrypted ciphertext and returns the raw decrypted bytes.
 *
 * Accepts:
 * - Combined binary payload or base64 string (first 12 bytes are nonce, remainder is ciphertext + tag)
 * - Separate ciphertext and nonce via positional parameters
 * - An EncryptedPayload object `{ ciphertext, nonce }`
 *
 * @throws DecryptionError if verification tag fails, key is wrong, data is corrupted, or nonce is invalid
 */
export async function decryptRaw(
  input: CiphertextInput,
  key: KeyInput,
  nonce?: string | Uint8Array
): Promise<Uint8Array> {
  let rawCiphertext: string | Uint8Array | undefined;
  let rawNonce: string | Uint8Array | undefined = nonce;

  if (typeof input === "object" && input !== null && !(input instanceof Uint8Array)) {
    if ("ciphertext" in input && "nonce" in input) {
      rawCiphertext = input.ciphertext;
      rawNonce = input.nonce;
    } else {
      throw new DecryptionError("Invalid payload object: missing ciphertext or nonce properties");
    }
  } else {
    rawCiphertext = input;
  }

  let ciphertextBytes: Uint8Array;
  let nonceBytes: Uint8Array;

  if (rawNonce !== undefined) {
    ciphertextBytes =
      typeof rawCiphertext === "string" ? base64ToUint8Array(rawCiphertext) : rawCiphertext;
    nonceBytes = typeof rawNonce === "string" ? base64ToUint8Array(rawNonce) : rawNonce;
  } else {
    // Combined payload mode: first 12 bytes is nonce, rest is ciphertext + 16-byte tag
    const combinedBytes =
      typeof rawCiphertext === "string" ? base64ToUint8Array(rawCiphertext) : rawCiphertext;

    const minLength = NONCE_LENGTH_BYTES + TAG_LENGTH_BYTES;
    if (combinedBytes.byteLength < minLength) {
      throw new DecryptionError(
        `Ciphertext payload too short: expected at least ${minLength} bytes (${NONCE_LENGTH_BYTES}-byte nonce + ${TAG_LENGTH_BYTES}-byte tag), got ${combinedBytes.byteLength} bytes`,
        { nonceLengthBytes: combinedBytes.byteLength }
      );
    }

    nonceBytes = combinedBytes.slice(0, NONCE_LENGTH_BYTES);
    ciphertextBytes = combinedBytes.slice(NONCE_LENGTH_BYTES);
  }

  if (!isValidNonceLength(nonceBytes.byteLength)) {
    throw new DecryptionError(
      `Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes, got ${nonceBytes.byteLength} bytes`,
      { nonceLengthBytes: nonceBytes.byteLength }
    );
  }

  if (ciphertextBytes.byteLength < TAG_LENGTH_BYTES) {
    throw new DecryptionError(
      `Ciphertext too short: missing ${TAG_LENGTH_BYTES}-byte authentication tag`,
      { nonceLengthBytes: nonceBytes.byteLength }
    );
  }

  const cryptoKey = await resolveKeyForDecryption(key);

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
 * Decrypts AES-256-GCM encrypted ciphertext and returns the decrypted UTF-8 plaintext string.
 *
 * @param input Ciphertext input (combined base64/bytes, or object `{ ciphertext, nonce }`, or separate)
 * @param key Master secret passphrase, raw 32-byte key, or CryptoKey
 * @param nonce Optional nonce if not bundled in input
 * @returns Decrypted plaintext UTF-8 string
 * @throws DecryptionError if authentication tag verification fails or data is corrupted
 */
export async function decrypt(
  input: CiphertextInput,
  key: KeyInput,
  nonce?: string | Uint8Array
): Promise<string> {
  const decryptedBytes = await decryptRaw(input, key, nonce);
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    return decoder.decode(decryptedBytes);
  } catch (err) {
    throw new DecryptionError(
      `Failed to decode decrypted plaintext as UTF-8: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Hashes an authentication or bearer token using SHA-256 and returns a lowercase hex string.
 * Conforms to ADR 002 and Go reference `HashToken` implementation.
 *
 * @param token Plaintext token string
 * @returns 64-character lowercase hex string
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  let hex = "";
  for (let i = 0; i < hashArray.length; i++) {
    hex += hashArray[i].toString(16).padStart(2, "0");
  }
  return hex;
}
