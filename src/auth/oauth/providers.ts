/**
 * Key Collective v3 — OAuth Identity Providers & Normalization
 *
 * Implements provider-specific presets, tenant mapping, and profile normalization.
 *
 * Invariants Enforced:
 * 1. Strict Tenant Isolation: User profiles deterministically map to tenant IDs (e.g. usr_github_12345).
 * 2. Strict TypeScript: Zero any, fully typed payloads.
 */

import type { OAuthUserProfile, OAuthProviderPreset } from "./types";
import { AuthenticationError } from "../../errors/auth_errors";

export const GITHUB_OAUTH_PRESET: OAuthProviderPreset = {
  provider: "github",
  authorizeEndpoint: "https://github.com/login/oauth/authorize",
  tokenEndpoint: "https://github.com/login/oauth/access_token",
  userInfoEndpoint: "https://api.github.com/user",
  defaultScopes: ["read:user", "user:email"],
} as const;

export const GOOGLE_OAUTH_PRESET: OAuthProviderPreset = {
  provider: "google",
  authorizeEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  userInfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
  defaultScopes: ["openid", "email", "profile"],
} as const;

export const KNOWN_PROVIDERS: Readonly<Record<string, OAuthProviderPreset>> = {
  github: GITHUB_OAUTH_PRESET,
  google: GOOGLE_OAUTH_PRESET,
};

/**
 * Builds a deterministic tenant ID from provider and user ID.
 * Follows Key Collective tenant isolation standard: usr_{provider}_{userId}
 */
export function buildOAuthTenantId(provider: string, userId: string): string {
  const sanitizedProvider = (provider || "oauth").toLowerCase().trim();
  const sanitizedId = (userId || "").trim();
  return `usr_${sanitizedProvider}_${sanitizedId}`;
}

/**
 * Normalizes raw identity provider userinfo response into an OAuthUserProfile.
 */
export function normalizeUserProfile(data: Record<string, unknown>): OAuthUserProfile {
  const rawId = data.id ?? data.sub ?? data.login;
  if (rawId === undefined || rawId === null || String(rawId).trim() === "") {
    throw new AuthenticationError(
      "OAuth user profile is missing required identifier (id or sub)",
      {
        reason: "missing_user_id",
      }
    );
  }
  const id = String(rawId).trim();

  const rawUsername = data.login ?? data.username ?? data.preferred_username ?? data.email ?? id;
  const username = String(rawUsername).trim();

  const rawEmail = data.email ?? data.primary_email ?? `${username}@oauth.local`;
  const email = String(rawEmail).trim();

  const name = typeof data.name === "string" && data.name.trim() !== "" ? data.name.trim() : undefined;
  const avatarUrl =
    typeof data.avatar_url === "string" && data.avatar_url.trim() !== ""
      ? data.avatar_url.trim()
      : typeof data.picture === "string" && data.picture.trim() !== ""
      ? data.picture.trim()
      : undefined;

  return {
    id,
    email,
    username,
    name,
    avatarUrl,
  };
}
