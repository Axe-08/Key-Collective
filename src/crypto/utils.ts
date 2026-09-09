/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Cryptographic Utility Helpers & Timing-Safe Equality Utilities
 *
 * Invariants & Standards:
 * - Constant-Time Comparisons: Prevent timing side-channel attacks on bearer tokens, hashes, and secrets.
 * - Strict Web Crypto API: Zero Node.js native dependencies for Cloudflare Workers runtime compatibility.
 * - Zero Plaintext Leakage: Utilities for memory wiping, hex/base64 conversions, and secure random byte generation.
 * - Strict TypeScript: No `any`, full type safety.
 */

import { DecryptionError } from "../errors/key_errors";

/**
 * Constant-time comparison of two Uint8Array byte buffers to prevent timing side-channel attacks.
 * Conforms to Threat Model Front 5.3 (Timing attack on Bearer token comparison).
 *
 * Evaluates every byte position even if differences are detected early.
 * If buffer lengths differ, performs a dummy pass to normalize timing while returning false.
 *
 * @param a First byte buffer
 * @param b Second byte buffer
 * @returns true if buffers are of identical length and contain identical bytes, false otherwise
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    // Constant-time dummy pass to normalize execution timing across mismatched lengths
    let dummy = a.byteLength ^ b.byteLength;
    for (let i = 0; i < a.byteLength; i++) {
      dummy |= a[i] ^ a[i];
    }
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
}

/**
 * Constant-time comparison of two UTF-8 strings (such as token hashes or API keys).
 * Converts both strings to UTF-8 byte arrays and performs a timing-safe equality check.
 *
 * @param a First string
 * @param b Second string
 * @returns true if strings are identical in constant time
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  return timingSafeEqual(aBytes, bBytes);
}

/**
 * Constant-time comparison of two arbitrary-length secrets using SHA-256 digest pre-hashing.
 *
 * Why this is crucial:
 * If two inputs have different lengths, comparing them directly could reveal length information
 * via timing. By hashing both inputs to 32-byte SHA-256 digests first, both inputs are mapped
 * to identical 32-byte arrays. The subsequent timingSafeEqual comparison runs for exactly 32 iterations
 * regardless of the input lengths, completely eliminating length leakage.
 *
 * @param a First secret (string or byte array)
 * @param b Second secret (string or byte array)
 * @returns Promise resolving to true if secrets match, false otherwise
 */
export async function timingSafeEqualHashed(
  a: string | Uint8Array,
  b: string | Uint8Array
): Promise<boolean> {
  const aBytes = typeof a === "string" ? new TextEncoder().encode(a) : a;
  const bBytes = typeof b === "string" ? new TextEncoder().encode(b) : b;

  const aDigestBuffer = await crypto.subtle.digest("SHA-256", aBytes);
  const bDigestBuffer = await crypto.subtle.digest("SHA-256", bBytes);

  return timingSafeEqual(new Uint8Array(aDigestBuffer), new Uint8Array(bDigestBuffer));
}

/**
 * Converts a Uint8Array to a lowercase hexadecimal string.
 *
 * @param bytes Input byte buffer
 * @returns Lowercase hex string (2 characters per byte)
 */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Converts a hexadecimal string into a Uint8Array byte buffer.
 * Case-insensitive (handles uppercase, lowercase, and mixed-case hex).
 *
 * @param hex Input hexadecimal string
 * @returns Uint8Array containing parsed bytes
 * @throws TypeError if hex string length is odd or contains non-hexadecimal characters
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.trim();
  if (cleanHex.length % 2 !== 0) {
    throw new TypeError(
      `Invalid hexadecimal string: length must be even, got ${cleanHex.length}`
    );
  }
  if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
    throw new TypeError("Invalid hexadecimal string: contains non-hexadecimal characters");
  }

  const byteLength = cleanHex.length / 2;
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Encodes a string into UTF-8 bytes using TextEncoder.
 */
export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Decodes UTF-8 bytes into a string using TextDecoder.
 *
 * @param bytes UTF-8 byte array
 * @param fatal If true, throws TypeError on malformed UTF-8 sequences (default: true)
 */
export function bytesToString(bytes: Uint8Array, fatal = true, ignoreBOM = false): string {
  const decoder = new TextDecoder("utf-8", { fatal, ignoreBOM });
  return decoder.decode(bytes);
}

/**
 * Encodes a Uint8Array into a standard Base64 string.
 * Compatible with Cloudflare Workers and standard Web API environments.
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
 * Handles standard Base64, whitespace, and URL-safe base64 (- and _).
 *
 * @param b64 Base64 string
 * @returns Decoded byte array
 * @throws DecryptionError if the string is invalid base64
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
 * Encodes a Uint8Array into a URL-safe Base64 string without '=' padding.
 * Conforms to RFC 4648 Base64URL encoding.
 */
export function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  return uint8ArrayToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decodes a URL-safe Base64 string into a Uint8Array.
 */
export function base64UrlToUint8Array(b64url: string): Uint8Array {
  return base64ToUint8Array(b64url);
}

/**
 * Generates cryptographically secure random bytes using Web Crypto API getRandomValues.
 *
 * @param length Number of bytes to generate
 * @returns Uint8Array filled with cryptographically random bytes
 * @throws RangeError if length is negative
 */
export function secureRandomBytes(length: number): Uint8Array {
  if (length < 0) {
    throw new RangeError(`Invalid byte length: expected non-negative number, got ${length}`);
  }
  const bytes = new Uint8Array(length);
  if (length > 0) {
    crypto.getRandomValues(bytes);
  }
  return bytes;
}

/**
 * Generates a cryptographically secure random hexadecimal string of given byte length.
 * (e.g. byteLength 16 produces a 32-character hex string).
 *
 * @param byteLength Number of random bytes to generate
 * @returns Hexadecimal string with length 2 * byteLength
 */
export function secureRandomHex(byteLength: number): string {
  return bytesToHex(secureRandomBytes(byteLength));
}

/**
 * Generates a cryptographically secure random string with uniform distribution
 * over a given alphabet. Defaults to alphanumeric characters (A-Z, a-z, 0-9).
 *
 * Uses rejection sampling to eliminate modulo bias.
 *
 * @param length Number of characters in the generated string
 * @param alphabet Allowed characters (defaults to [A-Za-z0-9])
 * @returns Secure random string
 */
export function secureRandomString(
  length: number,
  alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
): string {
  if (length <= 0) {
    return "";
  }
  if (alphabet.length === 0) {
    throw new Error("Alphabet cannot be empty");
  }

  const alphabetLen = alphabet.length;
  // Maximum value that is a multiple of alphabetLen within 256 to eliminate modulo bias
  const maxValidByte = 256 - (256 % alphabetLen);

  let result = "";
  while (result.length < length) {
    const needed = length - result.length;
    const batchSize = Math.max(needed * 2, 16);
    const bytes = secureRandomBytes(batchSize);

    for (let i = 0; i < bytes.length && result.length < length; i++) {
      const byte = bytes[i];
      if (byte < maxValidByte) {
        result += alphabet[byte % alphabetLen];
      }
    }
  }

  return result;
}

/**
 * Overwrites sensitive buffer contents in memory with zeros.
 *
 * @param bytes Byte array to wipe
 */
export function wipeBytes(bytes: Uint8Array): void {
  bytes.fill(0);
}
