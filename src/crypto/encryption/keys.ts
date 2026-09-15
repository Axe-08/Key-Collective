/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Encryption Subsystem - Key Derivation & Management
 *
 * Invariants & Standards:
 * - No Plaintext Keys: AES-256-GCM key management with deterministic SHA-256 and HKDF derivation.
 * - Per-Tenant DO Isolation: deriveTenantKey isolates encryption keys per tenant.
 * - Strict Web Crypto API: Native execution with zero external dependencies.
 * - Strict TypeScript: No `any`, full type safety.
 */

import {
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_KEY_LENGTH,
  ENCRYPTION_KEY_LENGTH_BYTES,
} from "../../constants/crypto";
import { DecryptionError, EncryptionError } from "../../errors/key_errors";
import { KeyInput } from "./types";
import { base64ToUint8Array, hexToUint8Array } from "./digest";

/**
 * Derives a 256-bit AES-GCM CryptoKey deterministically from a secret string or byte buffer.
 * Uses SHA-256 digest to ensure exact 256-bit key length.
 *
 * @param secret Master secret string or byte buffer
 * @returns 256-bit AES-GCM CryptoKey
 * @throws EncryptionError if secret is empty
 */
export async function deriveKey(secret: string | Uint8Array): Promise<CryptoKey> {
  if (typeof secret === "string") {
    if (secret.length === 0) {
      throw new EncryptionError("Secret cannot be empty");
    }
  } else if (secret instanceof Uint8Array) {
    if (secret.byteLength === 0) {
      throw new EncryptionError("Secret cannot be empty");
    }
  }

  const rawBytes =
    typeof secret === "string" ? new TextEncoder().encode(secret) : secret;

  const hashBuffer = await crypto.subtle.digest("SHA-256", rawBytes);

  return (await crypto.subtle.importKey(
    "raw",
    hashBuffer,
    { name: ENCRYPTION_ALGORITHM, length: ENCRYPTION_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  )) as CryptoKey;
}

/**
 * Imports a raw 32-byte (256-bit) Uint8Array directly as an AES-GCM CryptoKey.
 *
 * @param rawKey 32-byte Uint8Array
 * @returns AES-GCM CryptoKey
 * @throws EncryptionError if raw key is not 32 bytes
 */
export async function importRawKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.byteLength !== ENCRYPTION_KEY_LENGTH_BYTES) {
    throw new EncryptionError(
      `Invalid raw key length: expected ${ENCRYPTION_KEY_LENGTH_BYTES} bytes, got ${rawKey.byteLength}`
    );
  }

  return (await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: ENCRYPTION_ALGORITHM, length: ENCRYPTION_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  )) as CryptoKey;
}

/**
 * Derives a 256-bit AES-GCM CryptoKey for a specific tenant using HKDF.
 *
 * @param masterSecret The master secret key material.
 * @param tenantId The unique tenant identifier to use as the salt.
 * @returns A promise resolving to the tenant-specific CryptoKey.
 */
export async function deriveTenantKey(
  masterSecret: string | Uint8Array,
  tenantId: string
): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  const keyMaterialBytes =
    typeof masterSecret === "string" ? encoder.encode(masterSecret) : masterSecret;

  const baseKey = await crypto.subtle.importKey(
    "raw",
    keyMaterialBytes,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  return (await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(tenantId),
      info: encoder.encode("aes-256-gcm-key"),
    },
    baseKey,
    { name: ENCRYPTION_ALGORITHM, length: ENCRYPTION_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  )) as CryptoKey;
}

/**
 * Resolves a KeyInput (CryptoKey, raw bytes, or passphrase string) into a CryptoKey.
 *
 * @param key Input key representation
 * @param isDecryption Whether this resolution is for decryption (controls error type)
 * @returns Resolved CryptoKey
 */
export async function resolveKey(key: KeyInput, isDecryption: boolean): Promise<CryptoKey> {
  if (typeof key === "string") {
    if (key.length === 0) {
      if (isDecryption) {
        throw new DecryptionError("Master key secret cannot be empty");
      }
      throw new EncryptionError("Master key secret cannot be empty");
    }
    return deriveKey(key);
  }

  if (key instanceof Uint8Array) {
    if (key.byteLength === 0) {
      if (isDecryption) {
        throw new DecryptionError("Key bytes cannot be empty");
      }
      throw new EncryptionError("Key bytes cannot be empty");
    }
    if (key.byteLength === ENCRYPTION_KEY_LENGTH_BYTES) {
      return importRawKey(key);
    }
    return deriveKey(key);
  }

  return key;
}

/**
 * Generates a new 256-bit AES-GCM CryptoKey.
 */
export async function generateEncryptionKey(): Promise<CryptoKey> {
  return (await crypto.subtle.generateKey(
    {
      name: ENCRYPTION_ALGORITHM,
      length: ENCRYPTION_KEY_LENGTH,
    },
    true,
    ["encrypt", "decrypt"]
  )) as CryptoKey;
}

/**
 * Imports a 256-bit AES-GCM CryptoKey from raw binary bytes.
 */
export async function importKeyFromRaw(rawKey: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  const bytes = rawKey instanceof Uint8Array ? rawKey : new Uint8Array(rawKey);
  return importRawKey(bytes);
}

/**
 * Imports a 256-bit AES-GCM CryptoKey from a base64 encoded string.
 */
export async function importKeyFromBase64(base64Key: string): Promise<CryptoKey> {
  const raw = base64ToUint8Array(base64Key);
  return importRawKey(raw);
}

/**
 * Imports a 256-bit AES-GCM CryptoKey from a hex encoded string.
 */
export async function importKeyFromHex(hexKey: string): Promise<CryptoKey> {
  const raw = hexToUint8Array(hexKey);
  return importRawKey(raw);
}
