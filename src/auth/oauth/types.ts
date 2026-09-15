/**
 * Key Collective v3 — OAuth 2.0 Types & Contracts
 *
 * Invariants Enforced:
 * 1. Zero any: All types are strongly typed.
 * 2. Complete contract compatibility with v3_types.
 */

import type {
  OAuthProviderConfig,
  OAuthTokenResponse,
  OAuthUserProfile,
  JWTPayload,
} from "../../contracts/v3_types";

export type {
  OAuthProviderConfig,
  OAuthTokenResponse,
  OAuthUserProfile,
  JWTPayload,
};

export interface AuthorizationUrlOptions {
  readonly codeChallenge?: string;
  readonly codeChallengeMethod?: "S256" | "plain";
  readonly scopes?: readonly string[];
  readonly nonce?: string;
  readonly redirectUri?: string;
  readonly additionalParams?: Record<string, string>;
}

export interface OAuthLoginOptions {
  readonly code: string;
  readonly state: string;
  readonly expectedState: string;
  readonly jwtSecret: string;
  readonly jwtExpiresInSeconds?: number;
  readonly userEndpoint?: string;
}

export interface OAuthLoginResult {
  readonly accessToken: string;
  readonly user: OAuthUserProfile;
  readonly jwt: string;
  readonly tenantId: string;
}

export interface PKCEPair {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: "S256";
}

export interface OAuthStatePair {
  readonly state: string;
  readonly nonce: string;
}

export interface OAuthProviderPreset {
  readonly provider: string;
  readonly authorizeEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userInfoEndpoint: string;
  readonly defaultScopes: readonly string[];
}
