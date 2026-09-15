/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Encryption Subsystem - Type Definitions
 *
 * Invariants & Standards:
 * - Strict TypeScript: No `any`, full type safety.
 */

/**
 * Supported key inputs: a CryptoKey, a 32-byte raw Uint8Array, or a string passphrase.
 */
export type KeyInput = string | Uint8Array | CryptoKey;

/**
 * Result bundle produced by standalone encrypt helper.
 */
export interface EncryptedPayload {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  combined: Uint8Array;
  ciphertextB64: string;
  nonceB64: string;
  combinedB64: string;
}

/**
 * Object payload format for decryption.
 */
export interface EncryptedPayloadInput {
  ciphertext: string | Uint8Array;
  nonce: string | Uint8Array;
}

/**
 * Configuration interface for EncryptionService.
 */
export interface CryptoConfig {
  encryptionKey: CryptoKey;
}
