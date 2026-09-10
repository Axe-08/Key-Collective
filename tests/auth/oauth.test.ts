import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateOAuthState,
  generateCodeVerifier,
  generateCodeChallenge,
  generatePKCEPair,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  fetchOAuthUserProfile,
  issueUserJWT,
  verifyUserJWT,
  handleOAuthLogin,
} from "../../src/auth/oauth";
import type { OAuthProviderConfig } from "../../src/contracts/v3_types";
import { AuthenticationError } from "../../src/errors/auth_errors";

describe("OAuth 2.0 PKCE & Identity Provider Integration", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("generateOAuthState()", () => {
    it("generates state and nonce with sufficient length and URL-safe characters", async () => {
      const { state, nonce } = await generateOAuthState();

      expect(state).toBeTypeOf("string");
      expect(nonce).toBeTypeOf("string");

      // 32 random bytes in Base64URL yields 43 characters
      expect(state.length).toBeGreaterThanOrEqual(32);
      expect(nonce.length).toBeGreaterThanOrEqual(32);

      // Must only contain Base64URL safe characters [A-Za-z0-9_-]
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);

      // state and nonce must not be identical within the same call
      expect(state).not.toBe(nonce);
    });

    it("ensures cryptographic randomness across successive calls", async () => {
      const states = new Set<string>();
      const nonces = new Set<string>();
      const iterations = 50;

      for (let i = 0; i < iterations; i++) {
        const { state, nonce } = await generateOAuthState();
        states.add(state);
        nonces.add(nonce);
      }

      // High entropy: zero collisions across 50 iterations
      expect(states.size).toBe(iterations);
      expect(nonces.size).toBe(iterations);
    });
  });

  describe("PKCE RFC 7636 Helpers", () => {
    it("generates code verifier of default length 64 with unreserved chars", () => {
      const verifier = generateCodeVerifier();
      expect(verifier).toHaveLength(64);
      expect(verifier).toMatch(/^[A-Za-z0-9-._~]+$/);
    });

    it("generates code verifier with custom valid lengths", () => {
      const vMin = generateCodeVerifier(43);
      expect(vMin).toHaveLength(43);

      const vMax = generateCodeVerifier(128);
      expect(vMax).toHaveLength(128);
    });

    it("throws RangeError for invalid code verifier lengths", () => {
      expect(() => generateCodeVerifier(42)).toThrow(RangeError);
      expect(() => generateCodeVerifier(129)).toThrow(RangeError);
    });

    it("verifies RFC 7636 Appendix B test vector for S256 code challenge", async () => {
      // RFC 7636 Appendix B official test vector:
      // Code Verifier: dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
      // Code Challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
      const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

      const challenge = await generateCodeChallenge(verifier);
      expect(challenge).toBe(expectedChallenge);
    });

    it("generates matching PKCE pair with S256 method", async () => {
      const pair = await generatePKCEPair(50);
      expect(pair.method).toBe("S256");
      expect(pair.verifier).toHaveLength(50);
      expect(pair.challenge).toBeTypeOf("string");

      // Verify challenge calculation is deterministic
      const recalculated = await generateCodeChallenge(pair.verifier);
      expect(pair.challenge).toBe(recalculated);
    });
  });

  describe("buildAuthorizationUrl()", () => {
    const config: OAuthProviderConfig = {
      clientId: "client-xyz-123",
      authorizeEndpoint: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      redirectUri: "https://keycollective.ai/callback",
      scopes: ["read:user", "user:email"],
    };

    it("constructs valid authorization URL with standard parameters", () => {
      const urlString = buildAuthorizationUrl(config, "state-token-abc");
      const url = new URL(urlString);

      expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("client_id")).toBe("client-xyz-123");
      expect(url.searchParams.get("state")).toBe("state-token-abc");
      expect(url.searchParams.get("redirect_uri")).toBe("https://keycollective.ai/callback");
      expect(url.searchParams.get("scope")).toBe("read:user user:email");
    });

    it("appends PKCE code challenge and nonce when provided", () => {
      const urlString = buildAuthorizationUrl(config, "state-token-abc", {
        codeChallenge: "challenge-123",
        codeChallengeMethod: "S256",
        nonce: "nonce-xyz",
      });
      const url = new URL(urlString);

      expect(url.searchParams.get("code_challenge")).toBe("challenge-123");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("nonce")).toBe("nonce-xyz");
    });

    it("throws AuthenticationError when required parameters are missing", () => {
      expect(() =>
        buildAuthorizationUrl({ clientId: "", tokenEndpoint: "https://a.com" }, "state")
      ).toThrow(AuthenticationError);

      expect(() =>
        buildAuthorizationUrl({ clientId: "id", tokenEndpoint: "https://a.com" }, "")
      ).toThrow(AuthenticationError);
    });
  });

  describe("exchangeCodeForToken()", () => {
    const mockConfig: OAuthProviderConfig = {
      clientId: "kc_client_test_id",
      clientSecret: "kc_client_secret_xyz",
      tokenEndpoint: "https://oauth.provider.com/token",
      redirectUri: "https://keycollective.ai/auth/callback",
      codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    };

    it("successfully exchanges authorization code for access token via JSON response", async () => {
      let interceptedRequest: Request | null = null;

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init);
        interceptedRequest = req;

        return new Response(
          JSON.stringify({
            access_token: "gho_mock_token_success_999",
            token_type: "bearer",
            scope: "repo,user",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }) as typeof fetch;

      const token = await exchangeCodeForToken(mockConfig, "valid_auth_code_123");

      expect(token).toBe("gho_mock_token_success_999");
      expect(interceptedRequest).not.toBeNull();
      if (interceptedRequest) {
        const req = interceptedRequest as Request;
        expect(req.url).toBe("https://oauth.provider.com/token");
        expect(req.method).toBe("POST");
        expect(req.headers.get("Content-Type")).toContain("application/x-www-form-urlencoded");
        expect(req.headers.get("Accept")).toContain("application/json");

        const bodyText = await req.text();
        const params = new URLSearchParams(bodyText);
        expect(params.get("grant_type")).toBe("authorization_code");
        expect(params.get("client_id")).toBe("kc_client_test_id");
        expect(params.get("client_secret")).toBe("kc_client_secret_xyz");
        expect(params.get("code")).toBe("valid_auth_code_123");
        expect(params.get("redirect_uri")).toBe("https://keycollective.ai/auth/callback");
        expect(params.get("code_verifier")).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
      }
    });

    it("successfully parses url-encoded responses from legacy OAuth providers", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          "access_token=gho_urlencoded_token_888&scope=read%3Auser&token_type=bearer",
          {
            status: 200,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          }
        );
      }) as typeof fetch;

      const token = await exchangeCodeForToken(mockConfig, "code_form_test");
      expect(token).toBe("gho_urlencoded_token_888");
    });

    it("throws AuthenticationError when code is invalid or empty", async () => {
      await expect(exchangeCodeForToken(mockConfig, "")).rejects.toThrow(AuthenticationError);
      await expect(exchangeCodeForToken(mockConfig, "   ")).rejects.toThrow(AuthenticationError);
    });

    it("throws AuthenticationError when provider returns HTTP error", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: "bad_verification_code",
            error_description: "The code passed is incorrect or expired.",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }) as typeof fetch;

      await expect(exchangeCodeForToken(mockConfig, "bad_code")).rejects.toThrow(
        AuthenticationError
      );
    });

    it("throws AuthenticationError when provider returns error field in 200 OK response", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Code has already been consumed",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }) as typeof fetch;

      await expect(exchangeCodeForToken(mockConfig, "consumed_code")).rejects.toThrow(
        AuthenticationError
      );
    });

    it("throws AuthenticationError when access_token is missing from response", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            token_type: "bearer",
            scope: "user",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }) as typeof fetch;

      await expect(exchangeCodeForToken(mockConfig, "code_without_token")).rejects.toThrow(
        /missing access_token/i
      );
    });

    it("throws AuthenticationError when network fetch fails", async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error("DNS resolution failed");
      }) as typeof fetch;

      await expect(exchangeCodeForToken(mockConfig, "code_network_error")).rejects.toThrow(
        AuthenticationError
      );
    });
  });

  describe("fetchOAuthUserProfile()", () => {
    it("fetches and normalizes GitHub user profile", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            id: 1234567,
            login: "monalisa",
            name: "Mona Lisa",
            email: "monalisa@github.com",
            avatar_url: "https://avatars.githubusercontent.com/u/1234567",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }) as typeof fetch;

      const profile = await fetchOAuthUserProfile(
        "https://api.github.com/user",
        "mock_access_token_123"
      );

      expect(profile.id).toBe("1234567");
      expect(profile.username).toBe("monalisa");
      expect(profile.name).toBe("Mona Lisa");
      expect(profile.email).toBe("monalisa@github.com");
      expect(profile.avatarUrl).toBe("https://avatars.githubusercontent.com/u/1234567");
    });

    it("handles OIDC profile format (sub, picture)", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            sub: "google-oauth2|1092830192",
            email: "dev@example.com",
            name: "Jane Dev",
            picture: "https://lh3.googleusercontent.com/photo.jpg",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }) as typeof fetch;

      const profile = await fetchOAuthUserProfile(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        "mock_google_token"
      );

      expect(profile.id).toBe("google-oauth2|1092830192");
      expect(profile.email).toBe("dev@example.com");
      expect(profile.avatarUrl).toBe("https://lh3.googleusercontent.com/photo.jpg");
    });

    it("throws AuthenticationError on 401 Unauthorized from user endpoint", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response("Unauthorized", { status: 401 });
      }) as typeof fetch;

      await expect(
        fetchOAuthUserProfile("https://api.github.com/user", "expired_token")
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe("JWT Issuance & Verification (HS256 Web Crypto)", () => {
    const jwtSecret = "super-secret-key-collective-master-key-32-chars-long";

    it("issues and verifies a valid JWT payload", async () => {
      const token = await issueUserJWT(
        {
          sub: "usr_123",
          tenantId: "usr_gh_123",
          email: "test@example.com",
          username: "tester",
          tier: "builder",
        },
        jwtSecret,
        { expiresInSeconds: 3600 }
      );

      expect(token).toBeTypeOf("string");
      const parts = token.split(".");
      expect(parts).toHaveLength(3);

      const verified = await verifyUserJWT(token, jwtSecret);
      expect(verified.sub).toBe("usr_123");
      expect(verified.tenantId).toBe("usr_gh_123");
      expect(verified.email).toBe("test@example.com");
      expect(verified.username).toBe("tester");
      expect(verified.tier).toBe("builder");
      expect(verified.iss).toBe("key-collective");
      expect(verified.exp).toBeGreaterThan(verified.iat!);
    });

    it("rejects token signed with incorrect secret", async () => {
      const token = await issueUserJWT(
        {
          sub: "usr_123",
          tenantId: "usr_gh_123",
        },
        jwtSecret
      );

      await expect(verifyUserJWT(token, "wrong-secret-key-which-fails-verify")).rejects.toThrow(
        AuthenticationError
      );
    });

    it("rejects tampered payload segments", async () => {
      const token = await issueUserJWT(
        {
          sub: "usr_123",
          tenantId: "usr_gh_123",
          tier: "builder",
        },
        jwtSecret
      );

      const parts = token.split(".");
      // Tamper payload to elevate to admin
      const tamperedPayload = Buffer.from(
        JSON.stringify({ sub: "usr_123", tenantId: "usr_gh_123", tier: "admin" })
      )
        .toString("base64")
        .replace(/=/g, "");

      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      await expect(verifyUserJWT(tamperedToken, jwtSecret)).rejects.toThrow(AuthenticationError);
    });

    it("rejects expired tokens", async () => {
      const pastSec = Math.floor(Date.now() / 1000) - 100;
      const token = await issueUserJWT(
        {
          sub: "usr_123",
          tenantId: "usr_gh_123",
          iat: pastSec - 3600,
          exp: pastSec,
        },
        jwtSecret
      );

      await expect(verifyUserJWT(token, jwtSecret)).rejects.toThrow(/expired/i);
    });

    it("rejects malformed token strings", async () => {
      await expect(verifyUserJWT("not.a.valid.jwt.token", jwtSecret)).rejects.toThrow(
        AuthenticationError
      );
      await expect(verifyUserJWT("single-string", jwtSecret)).rejects.toThrow(AuthenticationError);
    });
  });

  describe("handleOAuthLogin() Full Orchestration", () => {
    const config: OAuthProviderConfig = {
      provider: "github",
      clientId: "client-id-123",
      clientSecret: "client-secret-abc",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      userInfoEndpoint: "https://api.github.com/user",
    };
    const jwtSecret = "jwt-secret-for-login-orchestration-test-keys";

    it("successfully handles login callback, profile extraction, and JWT issuance", async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (urlStr.includes("access_token")) {
          return new Response(
            JSON.stringify({
              access_token: "gho_access_token_mock_test",
              token_type: "bearer",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (urlStr.includes("api.github.com/user")) {
          return new Response(
            JSON.stringify({
              id: 987654,
              login: "alice_developer",
              email: "alice@example.com",
              name: "Alice",
              avatar_url: "https://github.com/alice.png",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response("Not Found", { status: 404 });
      }) as typeof fetch;

      const result = await handleOAuthLogin(config, {
        code: "oauth_callback_code",
        state: "csrf_state_token_safe_123",
        expectedState: "csrf_state_token_safe_123",
        jwtSecret,
      });

      expect(result.accessToken).toBe("gho_access_token_mock_test");
      expect(result.user.id).toBe("987654");
      expect(result.user.username).toBe("alice_developer");
      expect(result.user.email).toBe("alice@example.com");
      expect(result.tenantId).toBe("usr_github_987654");

      // Verify the issued JWT
      const verified = await verifyUserJWT(result.jwt, jwtSecret);
      expect(verified.sub).toBe("987654");
      expect(verified.tenantId).toBe("usr_github_987654");
      expect(verified.email).toBe("alice@example.com");
      expect(verified.username).toBe("alice_developer");
    });

    it("rejects login attempt if state does not match expected state (CSRF defense)", async () => {
      await expect(
        handleOAuthLogin(config, {
          code: "some_code",
          state: "forged_attacker_state",
          expectedState: "legitimate_session_state",
          jwtSecret,
        })
      ).rejects.toThrow(/state verification failed/i);
    });
  });
});
