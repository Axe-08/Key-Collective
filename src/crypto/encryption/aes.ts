/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Encryption Subsystem - AES-256-GCM Operations & EncryptionService
 *
 * Invariants & Standards:
 * - No Plaintext Keys: AES-256-GCM encryption via Web Crypto API with unique 12-byte nonces.
 * - Strict Web Crypto API: Native Web Crypto execution with zero Node.js dependencies for Cloudflare Workers.
 * - Strict TypeScript: No `any`, full type safety.
 */

import {
  ENCRYPTION_ALGORITHM,
  NONCE_LENGTH_BYTES,
  TAG_LENGTH_BYTES,
} from "../../constants/crypto";
import { DecryptionError, EncryptionError } from "../../errors/key_errors";
import { secureRandomBytes } from "../utils";
import {
  base64ToUint8Array,
  decodeBase64OrHex,
  hexToUint8Array,
  uint8ArrayToBase64,
} from "./digest";
import { deriveTenantKey, resolveKey } from "./keys";
import { CryptoConfig, EncryptedPayload, EncryptedPayloadInput, KeyInput } from "./types";

/**
 * Generates a cryptographically secure 12-byte (96-bit) nonce for AES-GCM.
 *
 * @param length Byte length (must equal NONCE_LENGTH_BYTES, 12)
 * @returns 12-byte Uint8Array
 * @throws EncryptionError if length is not 12
 */
export function generateNonce(length: number = NONCE_LENGTH_BYTES): Uint8Array {
  if (length !== NONCE_LENGTH_BYTES) {
    throw new EncryptionError(
      `Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes, got ${length}`
    );
  }
  return secureRandomBytes(length);
}

/**
 * Generates a 12-byte nonce and returns it as a Base64 string.
 *
 * @param length Byte length (must equal 12)
 * @returns Base64 encoded 12-byte nonce
 */
export function generateNonceB64(length: number = NONCE_LENGTH_BYTES): string {
  return uint8ArrayToBase64(generateNonce(length));
}

/**
 * Encrypts plaintext string or raw bytes using AES-256-GCM.
 *
 * @param plaintext Plaintext string or Uint8Array to encrypt
 * @param key Master key passphrase, raw 32-byte buffer, or CryptoKey
 * @param customNonce Optional 12-byte nonce (if omitted, a cryptographically secure nonce is generated)
 * @returns EncryptedPayload containing ciphertext, nonce, combined buffers, and their base64 encodings
 */
export async function encrypt(
  plaintext: string | Uint8Array,
  key: KeyInput,
  customNonce?: Uint8Array
): Promise<EncryptedPayload> {
  let nonce: Uint8Array;
  if (customNonce !== undefined) {
    if (customNonce.byteLength !== NONCE_LENGTH_BYTES) {
      throw new EncryptionError(
        `Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes, got ${customNonce.byteLength}`
      );
    }
    nonce = customNonce;
  } else {
    nonce = generateNonce();
  }

  const cryptoKey = await resolveKey(key, false);
  const data =
    typeof plaintext === "string"
      ? new TextEncoder().encode(plaintext)
      : plaintext;

  try {
    const ciphertextBuffer = await crypto.subtle.encrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: nonce,
      },
      cryptoKey,
      data
    );

    const ciphertext = new Uint8Array(ciphertextBuffer);
    const combined = new Uint8Array(nonce.byteLength + ciphertext.byteLength);
    combined.set(nonce, 0);
    combined.set(ciphertext, nonce.byteLength);

    return {
      ciphertext,
      nonce,
      combined,
      ciphertextB64: uint8ArrayToBase64(ciphertext),
      nonceB64: uint8ArrayToBase64(nonce),
      combinedB64: uint8ArrayToBase64(combined),
    };
  } catch (err) {
    if (err instanceof EncryptionError) {
      throw err;
    }
    throw new EncryptionError(
      `AES-GCM encryption failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Parses and extracts ciphertext and nonce from various input formats.
 */
export function parseDecryptionInput(
  input:
    | string
    | Uint8Array
    | EncryptedPayload
    | EncryptedPayloadInput,
  nonceParam?: string | Uint8Array
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  // Case 1: Object with ciphertext and nonce properties
  if (typeof input === "object" && input !== null && "ciphertext" in input && "nonce" in input) {
    const rawCiphertext = (input as EncryptedPayloadInput).ciphertext;
    const rawNonce = (input as EncryptedPayloadInput).nonce;

    const ciphertext =
      typeof rawCiphertext === "string"
        ? base64ToUint8Array(rawCiphertext)
        : rawCiphertext;
    const nonce =
      typeof rawNonce === "string"
        ? base64ToUint8Array(rawNonce)
        : rawNonce;

    return { ciphertext, nonce };
  }

  // Case 2: Separate positional arguments (input + nonceParam)
  if (nonceParam !== undefined) {
    const ciphertext =
      typeof input === "string" ? base64ToUint8Array(input) : (input as Uint8Array);
    const nonce =
      typeof nonceParam === "string"
        ? base64ToUint8Array(nonceParam)
        : nonceParam;
    return { ciphertext, nonce };
  }

  // Case 3: Combined buffer or base64 string
  let combined: Uint8Array;
  if (typeof input === "string") {
    combined = base64ToUint8Array(input);
  } else if (input instanceof Uint8Array) {
    combined = input;
  } else {
    throw new DecryptionError("Unsupported decryption input format");
  }

  // Minimum size: 12 bytes nonce + 16 bytes auth tag = 28 bytes
  const minCombinedLength = NONCE_LENGTH_BYTES + TAG_LENGTH_BYTES;
  if (combined.byteLength < minCombinedLength) {
    throw new DecryptionError(
      `Combined encrypted payload too short: expected at least ${minCombinedLength} bytes, got ${combined.byteLength}`
    );
  }

  const nonce = combined.slice(0, NONCE_LENGTH_BYTES);
  const ciphertext = combined.slice(NONCE_LENGTH_BYTES);

  return { ciphertext, nonce };
}

/**
 * Decrypts raw ciphertext bytes using AES-256-GCM and returns decrypted byte array.
 *
 * @param input Encrypted payload (object, combined buffer, base64 string, or ciphertext)
 * @param key Master key passphrase, raw 32-byte buffer, or CryptoKey
 * @param nonceParam Nonce buffer or base64 string if separate
 * @returns Decrypted plaintext bytes
 */
export async function decryptRaw(
  input:
    | string
    | Uint8Array
    | EncryptedPayload
    | EncryptedPayloadInput,
  key: KeyInput,
  nonceParam?: string | Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await resolveKey(key, true);

  let ciphertext: Uint8Array;
  let nonce: Uint8Array;
  try {
    const parsed = parseDecryptionInput(input, nonceParam);
    ciphertext = parsed.ciphertext;
    nonce = parsed.nonce;
  } catch (err) {
    if (err instanceof DecryptionError) {
      throw err;
    }
    throw new DecryptionError(
      `Failed to parse decryption input: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (nonce.byteLength !== NONCE_LENGTH_BYTES) {
    throw new DecryptionError(
      `Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes, got ${nonce.byteLength}`,
      { nonceLengthBytes: nonce.byteLength }
    );
  }

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: nonce,
      },
      cryptoKey,
      ciphertext
    );

    return new Uint8Array(decryptedBuffer);
  } catch (err) {
    if (err instanceof DecryptionError) {
      throw err;
    }
    throw new DecryptionError(
      `AES-GCM decryption failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Decrypts ciphertext using AES-256-GCM and returns decrypted UTF-8 string.
 *
 * @param input Encrypted payload (object, combined buffer, base64 string, or ciphertext)
 * @param key Master key passphrase, raw 32-byte buffer, or CryptoKey
 * @param nonceParam Nonce buffer or base64 string if separate
 * @returns Decrypted plaintext string
 */
export async function decrypt(
  input:
    | string
    | Uint8Array
    | EncryptedPayload
    | EncryptedPayloadInput,
  key: KeyInput,
  nonceParam?: string | Uint8Array
): Promise<string> {
  const decryptedBytes = await decryptRaw(input, key, nonceParam);
  return new TextDecoder().decode(decryptedBytes);
}

/**
 * AES-256-GCM Encryption Service backed by Web Crypto API.
 * Uses 12-byte (96-bit) nonces and outputs base64-encoded strings.
 */
export class EncryptionService {
  constructor(private config: CryptoConfig) {}

  /**
   * Factory method to create an EncryptionService for a specific tenant using HKDF.
   * Ensures strict per-tenant isolation (zero cross-tenant state).
   *
   * @param masterSecret Master secret key material.
   * @param tenantId The unique identifier for the tenant.
   */
  static async createForTenant(
    masterSecret: string | Uint8Array,
    tenantId: string
  ): Promise<EncryptionService> {
    const encryptionKey = await deriveTenantKey(masterSecret, tenantId);
    return new EncryptionService({ encryptionKey });
  }

  /**
   * Encrypts plaintext using AES-256-GCM with a unique 12-byte nonce.
   *
   * @param plaintext Plaintext string to encrypt.
   * @returns Object containing base64 ciphertext and base64 nonce.
   */
  async encrypt(plaintext: string): Promise<{ ciphertext: string; nonce: string }> {
    const nonce = generateNonce(NONCE_LENGTH_BYTES);
    const result = await encrypt(plaintext, this.config.encryptionKey, nonce);
    return {
      ciphertext: result.ciphertextB64,
      nonce: result.nonceB64,
    };
  }

  /**
   * Decrypts ciphertext using AES-256-GCM with the provided nonce.
   * Supports base64 or hex encoded ciphertexts and nonces.
   *
   * @param ciphertext Base64 or hex encoded ciphertext.
   * @param nonce Base64 or hex encoded 12-byte nonce.
   * @returns Decrypted plaintext string.
   */
  async decrypt(ciphertext: string, nonce: string): Promise<string> {
    const nonceBytes = decodeBase64OrHex(nonce, NONCE_LENGTH_BYTES);
    const ciphertextBytes = decodeBase64OrHex(ciphertext);

    try {
      const decryptedBytes = await decryptRaw(
        ciphertextBytes,
        this.config.encryptionKey,
        nonceBytes
      );
      return new TextDecoder().decode(decryptedBytes);
    } catch {
      // If first attempt failed and ciphertext might be hex formatted
      if (/^[0-9a-fA-F]+$/.test(ciphertext.trim()) && ciphertext.trim().length % 2 === 0) {
        try {
          const hexCiphertextBytes = hexToUint8Array(ciphertext.trim());
          const decryptedBytes = await decryptRaw(
            hexCiphertextBytes,
            this.config.encryptionKey,
            nonceBytes
          );
          return new TextDecoder().decode(decryptedBytes);
        } catch {
          // Re-throw standard error
        }
      }
      throw new Error("Decryption failed: invalid ciphertext, nonce, or key");
    }
  }
}
