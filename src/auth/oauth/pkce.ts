/**
 * Key Collective v3 — OAuth 2.0 PKCE & State Generation
 *
 * Implements RFC 7636 Proof Key for Code Exchange (PKCE) and secure state/nonce generation.
 *
 * Invariants Enforced:
 * 1. Web Crypto API: CSPRNG generation for state/nonce/PKCE, SHA-256 for code challenges.
 * 2. High Entropy: 32 random bytes for state and nonce; 43-128 chars for code verifier.
 * 3. Strict TypeScript: Zero any.
 */

import type { PKCEPair, OAuthStatePair } from "./types";
import { uint8ArrayToBase64Url, stringToBytes } from "../../crypto/utils";

/**
 * Generates cryptographically secure OAuth 2.0 state and nonce strings using Web Crypto API.
 * Guarantees high entropy (32 random bytes -> 43 characters Base64URL string).
 *
 * @returns Object containing high-entropy `state` and `nonce`
 */
export async function generateOAuthState(): Promise<OAuthStatePair> {
  const stateBytes = new Uint8Array(32);
  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  crypto.getRandomValues(nonceBytes);

  return {
    state: uint8ArrayToBase64Url(stateBytes),
    nonce: uint8ArrayToBase64Url(nonceBytes),
  };
}

/**
 * Generates an RFC 7636 compliant PKCE code verifier.
 * Unreserved characters: [A-Z, a-z, 0-9, "-", ".", "_", "~"]
 * Minimum length: 43 chars, maximum: 128 chars.
 *
 * @param length Length of code verifier (default 64)
 */
export function generateCodeVerifier(length = 64): string {
  if (length < 43 || length > 128) {
    throw new RangeError(
      `PKCE code verifier length must be between 43 and 128 characters, got ${length}`
    );
  }

  const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let verifier = "";
  const alphabetLen = unreserved.length;
  const maxValidByte = 256 - (256 % alphabetLen);

  let byteIdx = 0;
  while (verifier.length < length) {
    if (byteIdx >= bytes.length) {
      crypto.getRandomValues(bytes);
      byteIdx = 0;
    }
    const byte = bytes[byteIdx++];
    if (byte < maxValidByte) {
      verifier += unreserved[byte % alphabetLen];
    }
  }

  return verifier;
}

/**
 * Generates an RFC 7636 S256 code challenge from a code verifier.
 * Challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))
 *
 * @param verifier The PKCE code verifier string
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  if (!verifier || verifier.length < 43 || verifier.length > 128) {
    throw new RangeError(
      `PKCE code verifier must be between 43 and 128 characters, got ${verifier ? verifier.length : 0}`
    );
  }

  const data = stringToBytes(verifier);
  const digestBuffer = await crypto.subtle.digest("SHA-256", data);
  return uint8ArrayToBase64Url(new Uint8Array(digestBuffer));
}

/**
 * Generates a complete PKCE pair (verifier, challenge, and method `S256`).
 *
 * @param verifierLength Length of the generated code verifier (default 64)
 */
export async function generatePKCEPair(verifierLength = 64): Promise<PKCEPair> {
  const verifier = generateCodeVerifier(verifierLength);
  const challenge = await generateCodeChallenge(verifier);
  return {
    verifier,
    challenge,
    method: "S256",
  };
}
