/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * API Key Encryption & Decryption Helpers
 */

import {
  KEY_MASK_PREFIX_LENGTH,
  KEY_MASK_SUFFIX_LENGTH,
  NONCE_LENGTH_BYTES,
  isValidNonceLength,
  maskApiKey,
} from "../../../constants/crypto";
import {
  KeyInput,
  base64ToUint8Array,
  decrypt,
  encrypt,
  deriveTenantKey,
} from "../../../crypto/encryption/index";
import {
  DecryptionError,
  EncryptionError,
  InvalidKeyError,
} from "../../../errors/key_errors";
import { APIKey } from "../../../types/models";

/**
 * Resolves the encryption key secret, throwing EncryptionError if missing.
 */
export function resolveMasterKeyForEncryption(
  masterKey?: KeyInput,
  overrideKey?: KeyInput
): KeyInput {
  const key = overrideKey ?? masterKey;
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
export function resolveMasterKeyForDecryption(
  masterKey?: KeyInput,
  overrideKey?: KeyInput
): KeyInput {
  const key = overrideKey ?? masterKey;
  if (!key) {
    throw new DecryptionError(
      "Master encryption key not configured for ApiKeyRepository. Provide masterKey in constructor or method call."
    );
  }
  return key;
}

/**
 * Encrypts a plaintext key using the master key and derived tenant key.
 */
export async function encryptPlaintextKey(
  plaintextKey: string,
  tenantId: string,
  masterKeySecret: KeyInput
): Promise<{ ciphertextB64: string; nonceB64: string; prefix: string; suffix: string }> {
  const tenantKey = await deriveTenantKey(masterKeySecret as string | Uint8Array, tenantId);
  const encrypted = await encrypt(plaintextKey, tenantKey);
  const masked = maskApiKey(
    plaintextKey,
    KEY_MASK_PREFIX_LENGTH,
    KEY_MASK_SUFFIX_LENGTH
  );

  return {
    ciphertextB64: encrypted.ciphertextB64,
    nonceB64: encrypted.nonceB64,
    prefix: masked.prefix,
    suffix: masked.suffix,
  };
}

/**
 * Validates pre-encrypted key nonce length and base64 encoding.
 */
export function validatePreEncryptedNonce(nonceB64: string): void {
  let nonceBytes: Uint8Array;
  try {
    nonceBytes = base64ToUint8Array(nonceB64);
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
}

/**
 * Decrypts an APIKey record's ciphertext into plaintext using AES-256-GCM.
 */
export async function decryptApiKeyRecord(
  key: APIKey,
  masterKeySecret: KeyInput
): Promise<string> {
  const tenantKey = await deriveTenantKey(masterKeySecret as string | Uint8Array, key.tenantId);
  try {
    return await decrypt(
      {
        ciphertext: key.encryptedKeyB64,
        nonce: key.nonceB64,
      },
      tenantKey
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
