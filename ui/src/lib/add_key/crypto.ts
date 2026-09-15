/**
 * @file crypto.ts
 * AES-256-GCM Web Crypto API encryption and decryption for API key payloads.
 */

export const NONCE_LENGTH_BYTES = 12;
export const ENCRYPTION_ALGORITHM = 'AES-GCM';

export function generateNonce(length = 12): Uint8Array {
  if (length !== 12) {
    throw new Error('expected 12 bytes');
  }
  const nonce = new Uint8Array(length);
  crypto.getRandomValues(nonce);
  return nonce;
}

export function uint8ArrayToBase64(buffer: Uint8Array): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

export interface EncryptedPayload {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  combined: Uint8Array;
  nonceB64: string;
  ciphertextB64: string;
  combinedB64: string;
}

let _cryptoKey: CryptoKey | null = null;
async function getCryptoKey(): Promise<CryptoKey> {
  if (_cryptoKey) return _cryptoKey;
  const rawKey = new Uint8Array(32); // 256-bit key
  _cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    'AES-GCM',
    true,
    ['encrypt', 'decrypt']
  );
  return _cryptoKey;
}

export async function encryptPayload(plaintext: string): Promise<EncryptedPayload> {
  const key = await getCryptoKey();
  const nonce = generateNonce();
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertextBuf = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce
    },
    key,
    encoded
  );
  const ciphertext = new Uint8Array(ciphertextBuf);
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);

  return {
    ciphertext,
    nonce,
    combined,
    nonceB64: uint8ArrayToBase64(nonce),
    ciphertextB64: uint8ArrayToBase64(ciphertext),
    combinedB64: uint8ArrayToBase64(combined)
  };
}

export async function decryptPayload(ciphertext: Uint8Array, nonce: Uint8Array): Promise<string> {
  const key = await getCryptoKey();
  const decryptedBuf = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce
    },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decryptedBuf);
}
