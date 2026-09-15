/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Encryption Subsystem - Digest & Binary Encoding Helpers
 *
 * Invariants & Standards:
 * - Strict Web Crypto API: Native execution with zero external dependencies.
 * - Strict TypeScript: No `any`, full type safety.
 */

import { base64ToUint8Array, uint8ArrayToBase64 } from "../utils";

export { base64ToUint8Array, uint8ArrayToBase64 } from "../utils";
export { hashToken } from "../hashing";

/**
 * Converts a hex string to a Uint8Array.
 *
 * @param hex Hexadecimal string to decode
 * @returns Decoded byte array
 */
export function hexToUint8Array(hex: string): Uint8Array {
  const cleanHex = hex.trim();
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Decodes binary input that can be either Base64 or Hex formatted.
 *
 * @param input Base64 or Hex encoded string
 * @param expectedLength Optional expected byte length
 * @returns Decoded byte array
 */
export function decodeBase64OrHex(input: string, expectedLength?: number): Uint8Array {
  const trimmed = input.trim();
  if (expectedLength && trimmed.length === expectedLength * 2 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    return hexToUint8Array(trimmed);
  }
  try {
    const bytes = base64ToUint8Array(trimmed);
    if (!expectedLength || bytes.byteLength === expectedLength) {
      return bytes;
    }
  } catch {
    // Fallback to hex
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return hexToUint8Array(trimmed);
  }
  return base64ToUint8Array(trimmed);
}
