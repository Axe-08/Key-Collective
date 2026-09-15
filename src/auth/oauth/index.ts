/**
 * Key Collective v3 — OAuth 2.0 PKCE & Identity Provider Subsystem
 *
 * Invariants Enforced:
 * 1. Zero Plaintext Secrets: Client secrets, JWT secrets, and tokens are protected.
 * 2. Strict Tenant Isolation: Deterministic tenant ID mapping (usr_{provider}_{id}).
 * 3. Web Crypto API: CSPRNG generation for state/nonce/PKCE, HMAC-SHA256 for JWT.
 * 4. Strict TypeScript: Zero any, fully typed interfaces and return types.
 */

export * from "./types";
export * from "./pkce";
export * from "./crypto";
export * from "./providers";
export * from "./client";
