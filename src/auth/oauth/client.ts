/**
 * Key Collective v3 — OAuth 2.0 Client & Flow Orchestration
 *
 * Implements authorization URL building, token exchange, user profile fetching,
 * and high-level OAuth login orchestration.
 *
 * Invariants Enforced:
 * 1. Zero Plaintext Secrets: Access tokens and credentials never logged or leaked.
 * 2. Strict Tenant Isolation: Per-tenant deterministic ID assignment.
 * 3. Strict TypeScript: Zero any, fully typed payloads.
 * 4. Timing-safe CSRF state validation.
 */

import type {
  OAuthProviderConfig,
  OAuthUserProfile,
  AuthorizationUrlOptions,
  OAuthLoginOptions,
  OAuthLoginResult,
} from "./types";
import { AuthenticationError } from "../../errors/auth_errors";
import { timingSafeEqualStrings } from "../../crypto/utils";
import { normalizeUserProfile, buildOAuthTenantId } from "./providers";
import { issueUserJWT } from "./crypto";

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

  return normalizeUserProfile(data);
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
  const tenantId = buildOAuthTenantId(provider, user.id);

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
