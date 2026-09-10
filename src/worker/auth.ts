/**
 * Key Collective v2 — Token Verifier
 * Implements AuthContract to hash bearer tokens via Web Crypto API and verify them against D1.
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * 1. No Plaintext Keys/Tokens: Tokens are hashed using SHA-256 (crypto.subtle.digest)
 *    before querying D1. Plaintext tokens are NEVER stored or queried directly.
 * 2. Strict Tenant Isolation: Valid tokens return the associated tenantId.
 * 3. Strict TypeScript: Strict mode, zero `any`.
 */

import type { AuthContext, AuthContract } from "../contracts/auth";
import type { WorkerEnv } from "./env";

/**
 * Hashes a token using Web Crypto API (crypto.subtle.digest) with SHA-256.
 * Returns a 64-character lowercase hexadecimal string.
 *
 * @param token Plaintext bearer token
 * @returns 64-character lowercase hex string
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Database row shape for token verification lookup in D1.
 */
interface TokenRow {
  tenant_id?: string;
  tenantId?: string;
  expires_at?: string | number | null;
  expiresAt?: string | number | null;
  [key: string]: unknown;
}

/**
 * TokenVerifier implements AuthContract by hashing incoming bearer tokens
 * and querying D1 for existing, active tokens.
 */
export class TokenVerifier implements AuthContract {
  constructor(private env: WorkerEnv) {}

  /**
   * Verifies a bearer token against D1 by hashing it with SHA-256.
   *
   * @param bearerToken Raw token string or "Bearer <token>" header value
   * @returns AuthContext indicating whether authenticated and tenant ID
   */
  public async verifyToken(bearerToken: string): Promise<AuthContext> {
    if (!bearerToken || typeof bearerToken !== "string") {
      return {
        isAuthenticated: false,
        tenantId: "",
      };
    }

    const trimmed = bearerToken.trim();
    const match = /^bearer\s+(.*)$/i.exec(trimmed);
    const token = match ? match[1].trim() : trimmed;

    if (!token) {
      return {
        isAuthenticated: false,
        tenantId: "",
      };
    }

    try {
      const hashedToken = await hashToken(token);

      if (!this.env?.D1_DB) {
        return {
          isAuthenticated: false,
          tenantId: "",
        };
      }

      let row: TokenRow | null = null;

      // 1. Primary lookup by hash_sha256 in auth_tokens table
      try {
        row = await this.env.D1_DB.prepare(
          "SELECT * FROM auth_tokens WHERE hash_sha256 = ? LIMIT 1"
        )
          .bind(hashedToken)
          .first<TokenRow>();
      } catch {
        // Fall back to alternative column names or tables if schema differs
      }

      // 2. Fallback lookup by token_hash in auth_tokens table
      if (!row) {
        try {
          row = await this.env.D1_DB.prepare(
            "SELECT * FROM auth_tokens WHERE token_hash = ? LIMIT 1"
          )
            .bind(hashedToken)
            .first<TokenRow>();
        } catch {
          // Fall back
        }
      }

      // 3. Fallback lookup in tokens table
      if (!row) {
        try {
          row = await this.env.D1_DB.prepare(
            "SELECT * FROM tokens WHERE hash_sha256 = ? OR token_hash = ? LIMIT 1"
          )
            .bind(hashedToken, hashedToken)
            .first<TokenRow>();
        } catch {
          // Ignore
        }
      }

      if (!row) {
        return {
          isAuthenticated: false,
          tenantId: "",
        };
      }

      const tenantId = row.tenant_id ?? row.tenantId;
      if (!tenantId) {
        return {
          isAuthenticated: false,
          tenantId: "",
        };
      }

      // Check expiration if present
      const expiresAt = row.expires_at ?? row.expiresAt;
      if (expiresAt) {
        const expiryMs =
          typeof expiresAt === "number"
            ? expiresAt
            : new Date(expiresAt).getTime();
        if (!isNaN(expiryMs) && Date.now() >= expiryMs) {
          return {
            isAuthenticated: false,
            tenantId: "",
          };
        }
      }

      return {
        isAuthenticated: true,
        tenantId,
      };
    } catch {
      return {
        isAuthenticated: false,
        tenantId: "",
      };
    }
  }
}

export type { AuthContext, AuthContract };
export type { WorkerEnv };
