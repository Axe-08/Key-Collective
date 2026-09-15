/**
 * Key Collective v3 — OAuth Cryptographic Operations & JWT Token Management
 *
 * Implements Web Crypto API HMAC-SHA256 (HS256) JWT issuance, signature verification,
 * and payload integrity validation.
 *
 * Invariants Enforced:
 * 1. Zero Plaintext Secrets: HMAC keys generated in-memory via crypto.subtle, non-extractable.
 * 2. Strict TypeScript: Zero any, fully typed payloads.
 * 3. Timing-safe verification using crypto.subtle.verify.
 */

import type { JWTPayload } from "./types";
import { AuthenticationError } from "../../errors/auth_errors";
import {
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
  stringToBytes,
  bytesToString,
} from "../../crypto/utils";

/**
 * Helper to import an HMAC-SHA256 CryptoKey from a string secret.
 */
export async function getHmacKey(
  secret: string,
  usages: ("sign" | "verify")[]
): Promise<CryptoKey> {
  const keyBytes = stringToBytes(secret);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

/**
 * Issues a signed JSON Web Token (JWT) using Web Crypto API HMAC-SHA256 (HS256).
 *
 * @param payload Payload claims (sub, tenantId, tier, etc.)
 * @param secret HMAC signing secret
 * @param options Expiration configuration (default 86400 seconds / 24 hours)
 * @returns Standard 3-part dot-separated JWT string
 */
export async function issueUserJWT(
  payload: Omit<JWTPayload, "iat" | "exp"> & Partial<Pick<JWTPayload, "iat" | "exp">>,
  secret: string,
  options?: { expiresInSeconds?: number }
): Promise<string> {
  if (!secret || typeof secret !== "string" || secret.trim() === "") {
    throw new AuthenticationError("JWT signing secret must be non-empty", {
      reason: "invalid_jwt_secret",
    });
  }

  if (!payload?.sub || !payload?.tenantId) {
    throw new AuthenticationError("JWT payload requires sub and tenantId claims", {
      reason: "invalid_jwt_payload",
    });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const iat = payload.iat ?? nowSec;
  const expiresIn = options?.expiresInSeconds ?? 86400;
  const exp = payload.exp ?? iat + expiresIn;

  const fullPayload: JWTPayload = {
    ...payload,
    iat,
    exp,
    iss: typeof payload.iss === "string" ? payload.iss : "key-collective",
  };

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = uint8ArrayToBase64Url(stringToBytes(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToBase64Url(stringToBytes(JSON.stringify(fullPayload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await getHmacKey(secret, ["sign"]);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, stringToBytes(signingInput));
  const signatureB64 = uint8ArrayToBase64Url(new Uint8Array(signatureBuffer));

  return `${signingInput}.${signatureB64}`;
}

/**
 * Verifies and decodes an HS256 JWT using Web Crypto API.
 * Validates format, signature, and expiration claim.
 *
 * @param token Encoded JWT string
 * @param secret HMAC secret
 * @returns Validated JWTPayload
 */
export async function verifyUserJWT(token: string, secret: string): Promise<JWTPayload> {
  if (!token || typeof token !== "string" || token.trim() === "") {
    throw new AuthenticationError("JWT token must be a non-empty string", {
      reason: "missing_token",
    });
  }
  if (!secret || typeof secret !== "string" || secret.trim() === "") {
    throw new AuthenticationError("JWT verification secret must be non-empty", {
      reason: "invalid_jwt_secret",
    });
  }

  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    throw new AuthenticationError("Malformed JWT: token must have exactly 3 segments", {
      reason: "malformed_token",
    });
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  // Parse header
  let header: { alg?: string; typ?: string };
  try {
    const headerJson = bytesToString(base64UrlToUint8Array(headerB64));
    header = JSON.parse(headerJson) as { alg?: string; typ?: string };
  } catch {
    throw new AuthenticationError("Malformed JWT header: invalid Base64URL or JSON", {
      reason: "malformed_token",
    });
  }

  if (header.alg !== "HS256") {
    throw new AuthenticationError(`Unsupported JWT algorithm: expected HS256, got ${header.alg}`, {
      reason: "unsupported_jwt_algorithm",
    });
  }

  // Verify signature
  const key = await getHmacKey(secret, ["verify"]);
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlToUint8Array(signatureB64);
  } catch {
    throw new AuthenticationError("Malformed JWT signature segment", {
      reason: "invalid_signature",
    });
  }

  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    stringToBytes(signingInput)
  );

  if (!isValid) {
    throw new AuthenticationError("JWT signature verification failed", {
      reason: "invalid_signature",
    });
  }

  // Parse payload
  let payload: JWTPayload;
  try {
    const payloadJson = bytesToString(base64UrlToUint8Array(payloadB64));
    payload = JSON.parse(payloadJson) as JWTPayload;
  } catch {
    throw new AuthenticationError("Malformed JWT payload: invalid Base64URL or JSON", {
      reason: "malformed_token",
    });
  }

  // Verify expiration
  if (typeof payload.exp === "number") {
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec >= payload.exp) {
      throw new AuthenticationError("JWT has expired", {
        reason: "expired_token",
        details: { exp: payload.exp, now: nowSec },
      });
    }
  }

  return payload;
}
