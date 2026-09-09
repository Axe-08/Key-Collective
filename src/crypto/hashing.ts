/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * SHA-256 Hashing & Token Verification Helpers
 *
 * Invariants & Standards:
 * - SHA-256 Digesting via Web Crypto API: Strictly uses `crypto.subtle.digest("SHA-256", ...)`.
 * - Timing-Safe Comparisons: All hash & token verification functions use timing-safe constant-time utilities.
 * - Conforms to ADR 002 & Go Reference `HashToken`:
 *   - SHA-256 hex string generation for auth tokens and API key fingerprints.
 * - TypeScript strict mode, zero `any`.
 */

import {
  bytesToHex,
  hexToBytes,
  stringToBytes,
  timingSafeEqual,
  timingSafeEqualStrings,
  uint8ArrayToBase64,
  uint8ArrayToBase64Url,
} from "./utils";

/**
 * Standard cryptographic hashing algorithm identifier.
 */
export const HASH_ALGORITHM = "SHA-256" as const;

/**
 * Byte length of a SHA-256 digest (32 bytes = 256 bits).
 */
export const SHA256_DIGEST_LENGTH_BYTES = 32 as const;

/**
 * Character length of a SHA-256 digest represented as a hexadecimal string (64 characters).
 */
export const SHA256_HEX_LENGTH = 64 as const;

/**
 * Acceptable input types for hashing functions:
 * - UTF-8 string
 * - Uint8Array or any BufferSource (ArrayBuffer, TypedArray, DataView)
 */
export type HashInput = string | BufferSource | ArrayBufferLike;

/**
 * Converts any supported HashInput into a BufferSource suitable for Web Crypto operations.
 */
function normalizeHashInput(input: HashInput): BufferSource {
  if (typeof input === "string") {
    return stringToBytes(input);
  }
  if (ArrayBuffer.isView(input)) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return input;
  }
  throw new TypeError("Invalid input: expected string, Uint8Array, or BufferSource");
}

/**
 * Extracts a Uint8Array byte view from a HashInput.
 */
function toUint8Array(input: HashInput): Uint8Array {
  if (typeof input === "string") {
    return stringToBytes(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  throw new TypeError("Invalid input: expected string, Uint8Array, or BufferSource");
}

/**
 * Computes raw SHA-256 digest bytes using Web Crypto API.
 *
 * @param data Input UTF-8 string, Uint8Array, or BufferSource
 * @returns 32-byte Uint8Array containing SHA-256 digest
 */
export async function sha256(data: HashInput): Promise<Uint8Array> {
  const source = normalizeHashInput(data);
  const digestBuffer = await crypto.subtle.digest(HASH_ALGORITHM, source);
  return new Uint8Array(digestBuffer);
}

/**
 * Computes SHA-256 digest and returns a 64-character lowercase hexadecimal string.
 *
 * @param data Input UTF-8 string, Uint8Array, or BufferSource
 * @returns 64-character lowercase hexadecimal string
 */
export async function sha256Hex(data: HashInput): Promise<string> {
  const digest = await sha256(data);
  return bytesToHex(digest);
}

/**
 * Computes SHA-256 digest and returns a standard Base64-encoded string.
 *
 * @param data Input UTF-8 string, Uint8Array, or BufferSource
 * @returns Base64 string
 */
export async function sha256Base64(data: HashInput): Promise<string> {
  const digest = await sha256(data);
  return uint8ArrayToBase64(digest);
}

/**
 * Computes SHA-256 digest and returns a URL-safe Base64 string without '=' padding.
 *
 * @param data Input UTF-8 string, Uint8Array, or BufferSource
 * @returns URL-safe Base64 string
 */
export async function sha256Base64Url(data: HashInput): Promise<string> {
  const digest = await sha256(data);
  return uint8ArrayToBase64Url(digest);
}

/**
 * Hashes an authentication or bearer token using SHA-256 and returns a lowercase hex string.
 * Conforms to ADR 002 and Go reference `proxy.HashToken` implementation.
 *
 * Used for token lookup and storage in D1 `tokens.token_hash`.
 *
 * @param token Plaintext bearer token
 * @returns 64-character lowercase hex string
 */
export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/**
 * Hashes an upstream provider API key (e.g. OpenAI, Anthropic) using SHA-256.
 * Trims leading and trailing whitespace to ensure canonical hashing.
 *
 * @param apiKey Plaintext upstream API key
 * @returns 64-character lowercase hex string
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  return sha256Hex(apiKey.trim());
}

/**
 * Computes a salted SHA-256 digest of data.
 * Concatenates salt bytes before data bytes: SHA-256(salt || data).
 *
 * @param data Input data to hash
 * @param salt Salt string or byte array
 * @returns 64-character lowercase hex string
 */
export async function hashWithSalt(
  data: HashInput,
  salt: string | Uint8Array
): Promise<string> {
  const dataBytes = toUint8Array(data);
  const saltBytes = typeof salt === "string" ? stringToBytes(salt) : salt;

  const combined = new Uint8Array(saltBytes.byteLength + dataBytes.byteLength);
  combined.set(saltBytes, 0);
  combined.set(dataBytes, saltBytes.byteLength);

  return sha256Hex(combined);
}

/**
 * Generates a short prefix fingerprint of the SHA-256 digest.
 * Suitable for logging, telemetry, or UI display without leaking the full hash or secret.
 *
 * @param data Input string or byte buffer
 * @param length Desired character length of fingerprint (default: 16, min: 1, max: 64)
 * @returns Substring of SHA-256 hex digest
 */
export async function hashFingerprint(
  data: HashInput,
  length = 16
): Promise<string> {
  if (length <= 0 || length > SHA256_HEX_LENGTH) {
    throw new RangeError(
      `Invalid fingerprint length: expected 1-${SHA256_HEX_LENGTH}, got ${length}`
    );
  }
  const hex = await sha256Hex(data);
  return hex.slice(0, length);
}

/**
 * Verifies if the SHA-256 digest of input data matches an expected hash in constant time.
 * Supports both 64-character hexadecimal and Base64 formatted expected hashes.
 *
 * @param data Input data
 * @param expectedHash Expected hex or base64 SHA-256 digest
 * @returns true if hash matches in constant time, false otherwise
 */
export async function verifySha256(
  data: HashInput,
  expectedHash: string
): Promise<boolean> {
  const cleanExpected = expectedHash.trim();

  if (cleanExpected.length === SHA256_HEX_LENGTH && /^[0-9a-fA-F]{64}$/.test(cleanExpected)) {
    const actualHex = await sha256Hex(data);
    return timingSafeEqualStrings(actualHex, cleanExpected.toLowerCase());
  }

  // Fallback to base64 check
  const actualB64 = await sha256Base64(data);
  const actualB64Url = await sha256Base64Url(data);
  return (
    timingSafeEqualStrings(actualB64, cleanExpected) ||
    timingSafeEqualStrings(actualB64Url, cleanExpected)
  );
}

/**
 * Verifies an incoming bearer token against a known SHA-256 token hash in constant time.
 * Conforms to Threat Model Front 5.3 (Timing attack on Bearer token comparison).
 *
 * @param token Incoming bearer token from HTTP Authorization header
 * @param expectedTokenHash Stored 64-character lowercase hex hash from D1
 * @returns true if token matches the hash in constant time, false otherwise
 */
export async function verifyToken(
  token: string,
  expectedTokenHash: string
): Promise<boolean> {
  const computedHash = await hashToken(token);
  return timingSafeEqualStrings(computedHash, expectedTokenHash.toLowerCase().trim());
}

/**
 * Computes an HMAC-SHA-256 message authentication code using Web Crypto API.
 *
 * @param key Secret key (string or Uint8Array)
 * @param data Message data (string or Uint8Array or BufferSource)
 * @returns 32-byte Uint8Array containing HMAC
 */
export async function hmacSha256(
  key: string | Uint8Array,
  data: HashInput
): Promise<Uint8Array> {
  const keyBytes = typeof key === "string" ? stringToBytes(key) : key;
  const dataBytes = toUint8Array(data);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: { name: HASH_ALGORITHM } },
    false,
    ["sign", "verify"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, dataBytes);
  return new Uint8Array(signature);
}

/**
 * Computes an HMAC-SHA-256 MAC and returns a 64-character lowercase hexadecimal string.
 *
 * @param key Secret key
 * @param data Message data
 * @returns 64-character lowercase hex string
 */
export async function hmacSha256Hex(
  key: string | Uint8Array,
  data: HashInput
): Promise<string> {
  const mac = await hmacSha256(key, data);
  return bytesToHex(mac);
}

/**
 * Verifies an HMAC-SHA-256 MAC in constant time.
 *
 * @param key Secret key
 * @param data Message data
 * @param expectedMac Expected MAC as a hex string, base64 string, or Uint8Array
 * @returns true if HMAC verification succeeds in constant time, false otherwise
 */
export async function verifyHmacSha256(
  key: string | Uint8Array,
  data: HashInput,
  expectedMac: string | Uint8Array
): Promise<boolean> {
  const actualMac = await hmacSha256(key, data);

  let expectedBytes: Uint8Array;
  if (typeof expectedMac === "string") {
    const cleanMac = expectedMac.trim();
    if (cleanMac.length === SHA256_HEX_LENGTH && /^[0-9a-fA-F]{64}$/.test(cleanMac)) {
      expectedBytes = hexToBytes(cleanMac);
    } else {
      const { base64ToUint8Array } = await import("./utils");
      try {
        expectedBytes = base64ToUint8Array(cleanMac);
      } catch {
        return false;
      }
    }
  } else {
    expectedBytes = expectedMac;
  }

  return timingSafeEqual(actualMac, expectedBytes);
}
