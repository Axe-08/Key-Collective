/**
 * Key Collective v3 — OAuth 2.0 PKCE & Identity Provider Integration
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * 1. Zero Plaintext Secrets: Client secrets, JWT secrets, and tokens are protected.
 * 2. Strict Tenant Isolation: User profiles deterministically map to tenant IDs (e.g., usr_github_12345).
 * 3. Web Crypto API: CSPRNG generation for state/nonce/PKCE, HMAC-SHA256 for JWT issuance/verification.
 * 4. Strict TypeScript: Zero `any`, full runtime assertion guards and strongly-typed payloads.
 */

import type {
  OAuthProviderConfig,
  OAuthTokenResponse,
  OAuthUserProfile,
  JWTPayload,
} from "../contracts/v3_types";
import { AuthenticationError } from "../errors/auth_errors";
import {
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
  stringToBytes,
  bytesToString,
  timingSafeEqualStrings,
} from "../crypto/utils";

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

/**
 * Generates cryptographically secure OAuth 2.0 state and nonce strings using Web Crypto API.
 * Guarantees high entropy (32 random bytes -> 43 characters Base64URL string).
 *
 * @returns Object containing high-entropy `state` and `nonce`
 */
export async function generateOAuthState(): Promise<{ state: string; nonce: string }> {
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

/**
 * Builds the provider authorization URL for initiating the OAuth 2.0 PKCE flow.
 *
 * @param config Identity provider configuration
 * @param state CSRF state parameter
 * @param options Additional authorization parameters (codeChallenge, scopes, nonce, etc.)
 */
export function buildAuthorizationUrl(
  config: OAuthProviderConfig,
  state: string,
  options?: AuthorizationUrlOptions
): string {
  if (!config.authorizeEndpoint) {
    throw new AuthenticationError("Authorize endpoint is not configured for provider", {
      reason: "missing_authorize_endpoint",
    });
  }
  if (!config.clientId) {
    throw new AuthenticationError("Client ID is required to build authorization URL", {
      reason: "missing_client_id",
    });
  }
  if (!state || state.trim() === "") {
    throw new AuthenticationError("State parameter is required to build authorization URL", {
      reason: "missing_state",
    });
  }

  const url = new URL(config.authorizeEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("state", state);

  const redirectUri = options?.redirectUri || config.redirectUri;
  if (redirectUri) {
    url.searchParams.set("redirect_uri", redirectUri);
  }

  const scopes = options?.scopes || config.scopes;
  if (scopes && scopes.length > 0) {
    url.searchParams.set("scope", scopes.join(" "));
  }

  if (options?.codeChallenge) {
    url.searchParams.set("code_challenge", options.codeChallenge);
    url.searchParams.set("code_challenge_method", options.codeChallengeMethod || "S256");
  }

  if (options?.nonce) {
    url.searchParams.set("nonce", options.nonce);
  }

  if (options?.additionalParams) {
    for (const [key, value] of Object.entries(options.additionalParams)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

/**
 * Exchanges an authorization code for an access token with an external OAuth 2.0 provider.
 * Supports standard application/x-www-form-urlencoded payloads, JSON responses,
 * and fallback parsing for providers that return urlencoded responses.
 *
 * @param config OAuth provider configuration (endpoints, client credentials, optional codeVerifier)
 * @param code Authorization code received from the callback
 * @returns The extracted access token string
 */
export async function exchangeCodeForToken(
  config: OAuthProviderConfig,
  code: string
): Promise<string> {
  if (!code || typeof code !== "string" || code.trim() === "") {
    throw new AuthenticationError("Invalid authorization code: code must be non-empty", {
      reason: "invalid_code",
    });
  }

  if (!config?.tokenEndpoint || typeof config.tokenEndpoint !== "string") {
    throw new AuthenticationError("Invalid OAuth configuration: tokenEndpoint is required", {
      reason: "missing_token_endpoint",
    });
  }

  if (!config?.clientId || typeof config.clientId !== "string") {
    throw new AuthenticationError("Invalid OAuth configuration: clientId is required", {
      reason: "missing_client_id",
    });
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", config.clientId);
  body.set("code", code.trim());

  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret);
  }
  if (config.redirectUri) {
    body.set("redirect_uri", config.redirectUri);
  }
  if (config.codeVerifier) {
    body.set("code_verifier", config.codeVerifier);
  }

  let response: Response;
  try {
    response = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "KeyCollective-OAuth/1.0",
      },
      body: body.toString(),
    });
  } catch (err) {
    throw new AuthenticationError(
      `OAuth token exchange failed due to network error: ${
        err instanceof Error ? err.message : String(err)
      }`,
      {
        reason: "oauth_network_error",
        cause: err instanceof Error ? err : undefined,
      }
    );
  }

  const contentType = response.headers.get("content-type") || "";
  let payload: Record<string, unknown> = {};

  try {
    if (contentType.includes("application/json")) {
      payload = (await response.json()) as Record<string, unknown>;
    } else {
      const text = await response.text();
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Fallback for providers that respond with query-string format (e.g. GitHub default)
        const params = new URLSearchParams(text);
        const parsed: Record<string, unknown> = {};
        for (const [key, value] of params.entries()) {
          parsed[key] = value;
        }
        payload = parsed;
      }
    }
  } catch (parseErr) {
    throw new AuthenticationError("Failed to parse OAuth provider token response", {
      reason: "invalid_provider_response",
      details: { status: response.status },
      cause: parseErr instanceof Error ? parseErr : undefined,
    });
  }

  if (!response.ok) {
    const errorMsg =
      (typeof payload.error_description === "string" ? payload.error_description : null) ||
      (typeof payload.error === "string" ? payload.error : null) ||
      (typeof payload.message === "string" ? payload.message : null) ||
      `OAuth token exchange failed with HTTP ${response.status}`;
    const reason = typeof payload.error === "string" ? payload.error : "token_exchange_rejected";

    throw new AuthenticationError(errorMsg, {
      reason,
      details: { status: response.status, ...payload },
    });
  }

  if (payload.error) {
    const errorDesc =
      typeof payload.error_description === "string"
        ? payload.error_description
        : String(payload.error);
    throw new AuthenticationError(`OAuth provider error: ${errorDesc}`, {
      reason: String(payload.error),
      details: payload,
    });
  }

  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!accessToken) {
    throw new AuthenticationError(
      "OAuth token exchange succeeded but missing access_token in response",
      {
        reason: "missing_access_token",
        details: payload,
      }
    );
  }

  return accessToken;
}

/**
 * Fetches user profile from identity provider's userinfo/user endpoint.
 *
 * @param userEndpoint User info URL (e.g. https://api.github.com/user)
 * @param accessToken Bearer access token
 */
export async function fetchOAuthUserProfile(
  userEndpoint: string,
  accessToken: string
): Promise<OAuthUserProfile> {
  if (!userEndpoint || typeof userEndpoint !== "string") {
    throw new AuthenticationError("Invalid user endpoint: URL is required", {
      reason: "invalid_user_endpoint",
    });
  }
  if (!accessToken || typeof accessToken !== "string" || accessToken.trim() === "") {
    throw new AuthenticationError("Invalid access token: token must be non-empty", {
      reason: "invalid_token",
    });
  }

  let response: Response;
  try {
    response = await fetch(userEndpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        Accept: "application/json",
        "User-Agent": "KeyCollective-OAuth/1.0",
      },
    });
  } catch (err) {
    throw new AuthenticationError(
      `Failed to fetch user profile: ${err instanceof Error ? err.message : String(err)}`,
      {
        reason: "user_profile_network_error",
        cause: err instanceof Error ? err : undefined,
      }
    );
  }

  if (!response.ok) {
    throw new AuthenticationError(
      `User profile endpoint returned HTTP ${response.status}`,
      {
        reason: "user_profile_fetch_failed",
        details: { status: response.status },
      }
    );
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch (err) {
    throw new AuthenticationError("Failed to parse user profile JSON response", {
      reason: "invalid_user_profile_payload",
      cause: err instanceof Error ? err : undefined,
    });
  }

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

/**
 * Helper to import an HMAC-SHA256 CryptoKey from a string secret.
 */
async function getHmacKey(secret: string, usages: ("sign" | "verify")[]): Promise<CryptoKey> {
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

/**
 * High-level orchestration for the OAuth callback:
 * 1. Validates CSRF state parameter using timing-safe comparison.
 * 2. Exchanges authorization code for provider access token (with PKCE verifier if configured).
 * 3. Fetches normalized user profile from provider.
 * 4. Issues strongly-typed platform JWT session token.
 *
 * @param config OAuth provider configuration
 * @param options Login options including state, code, and JWT signing secret
 */
export async function handleOAuthLogin(
  config: OAuthProviderConfig,
  options: OAuthLoginOptions
): Promise<OAuthLoginResult> {
  const { code, state, expectedState, jwtSecret, jwtExpiresInSeconds, userEndpoint } = options;

  if (!state || !expectedState || !timingSafeEqualStrings(state, expectedState)) {
    throw new AuthenticationError(
      "OAuth state verification failed: potential CSRF attack detected",
      {
        reason: "state_mismatch",
      }
    );
  }

  const accessToken = await exchangeCodeForToken(config, code);

  const endpoint = userEndpoint || config.userInfoEndpoint;
  if (!endpoint) {
    throw new AuthenticationError("User info endpoint is not configured for provider", {
      reason: "missing_user_endpoint",
    });
  }

  const user = await fetchOAuthUserProfile(endpoint, accessToken);
  const provider = config.provider || "oauth";
  const tenantId = `usr_${provider}_${user.id}`;

  const jwt = await issueUserJWT(
    {
      sub: user.id,
      tenantId,
      email: user.email,
      username: user.username,
      tier: "builder",
    },
    jwtSecret,
    { expiresInSeconds: jwtExpiresInSeconds ?? 86400 }
  );

  return {
    accessToken,
    user,
    jwt,
    tenantId,
  };
}
