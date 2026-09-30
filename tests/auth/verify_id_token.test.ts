/**
 * @file verify_id_token.test.ts
 * Unit tests for Firebase ID token verification.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  createLocalJWKSet,
  type JWK,
} from "jose";
import {
  verifyFirebaseIdToken,
  GOOGLE_JWKS_URL,
} from "../../src/auth/google/verify_id_token";
import { AuthenticationError } from "../../src/errors/auth_errors";

describe("verifyFirebaseIdToken", () => {
  const TEST_PROJECT_ID = "key-collective-568f8";
  const TEST_KID = "test-key-id-1";

  let privateKey: CryptoKey;
  let publicJwk: JWK;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
    publicJwk.kid = TEST_KID;
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (urlStr.startsWith(GOOGLE_JWKS_URL)) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("decodes a valid Firebase ID token successfully", async () => {
    const token = await new SignJWT({
      sub: "usr_google_12345",
      email: "engineer@example.com",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: TEST_KID })
      .setIssuer(`https://securetoken.google.com/${TEST_PROJECT_ID}`)
      .setAudience(TEST_PROJECT_ID)
      .setExpirationTime("1h")
      .sign(privateKey);

    const result = await verifyFirebaseIdToken(token, TEST_PROJECT_ID);

    expect(result).toEqual({
      uid: "usr_google_12345",
      email: "engineer@example.com",
    });
  });

  it("rejects an expired token", async () => {
    const expiredToken = await new SignJWT({
      sub: "usr_google_expired",
      email: "expired@example.com",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: TEST_KID })
      .setIssuer(`https://securetoken.google.com/${TEST_PROJECT_ID}`)
      .setAudience(TEST_PROJECT_ID)
      .setExpirationTime("-10s")
      .sign(privateKey);

    await expect(
      verifyFirebaseIdToken(expiredToken, TEST_PROJECT_ID)
    ).rejects.toThrow();
  });

  it("rejects a token with an invalid audience", async () => {
    const invalidAudToken = await new SignJWT({
      sub: "usr_google_wrong_aud",
      email: "wrongaud@example.com",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: TEST_KID })
      .setIssuer(`https://securetoken.google.com/${TEST_PROJECT_ID}`)
      .setAudience("unauthorized-client-project")
      .setExpirationTime("1h")
      .sign(privateKey);

    await expect(
      verifyFirebaseIdToken(invalidAudToken, TEST_PROJECT_ID)
    ).rejects.toThrow();
  });

  it("rejects an unverified email with AuthenticationError", async () => {
    const unverifiedToken = await new SignJWT({
      sub: "usr_google_unverified",
      email: "unverified@example.com",
      email_verified: false,
    })
      .setProtectedHeader({ alg: "RS256", kid: TEST_KID })
      .setIssuer(`https://securetoken.google.com/${TEST_PROJECT_ID}`)
      .setAudience(TEST_PROJECT_ID)
      .setExpirationTime("1h")
      .sign(privateKey);

    await expect(
      verifyFirebaseIdToken(unverifiedToken, TEST_PROJECT_ID)
    ).rejects.toThrow(AuthenticationError);

    try {
      await verifyFirebaseIdToken(unverifiedToken, TEST_PROJECT_ID);
      expect.fail("Should have thrown AuthenticationError");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError);
      const authErr = err as AuthenticationError;
      expect(authErr.message).toBe("unverified_google_identity");
      expect(authErr.statusCode).toBe(401);
    }
  });

  it("rejects a token missing the sub claim with AuthenticationError", async () => {
    const missingSubToken = await new SignJWT({
      email: "nosub@example.com",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: TEST_KID })
      .setIssuer(`https://securetoken.google.com/${TEST_PROJECT_ID}`)
      .setAudience(TEST_PROJECT_ID)
      .setExpirationTime("1h")
      .sign(privateKey);

    await expect(
      verifyFirebaseIdToken(missingSubToken, TEST_PROJECT_ID)
    ).rejects.toThrow(AuthenticationError);
  });

  it("rejects a token with an invalid issuer", async () => {
    const invalidIssuerToken = await new SignJWT({
      sub: "usr_google_wrong_iss",
      email: "wrongiss@example.com",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: TEST_KID })
      .setIssuer("https://malicious.auth.service.com/fake-project")
      .setAudience(TEST_PROJECT_ID)
      .setExpirationTime("1h")
      .sign(privateKey);

    await expect(
      verifyFirebaseIdToken(invalidIssuerToken, TEST_PROJECT_ID)
    ).rejects.toThrow();
  });

  it("rejects a token with a tampered signature", async () => {
    const validToken = await new SignJWT({
      sub: "usr_google_tampered",
      email: "tampered@example.com",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: TEST_KID })
      .setIssuer(`https://securetoken.google.com/${TEST_PROJECT_ID}`)
      .setAudience(TEST_PROJECT_ID)
      .setExpirationTime("1h")
      .sign(privateKey);

    const parts = validToken.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        sub: "usr_google_tampered",
        email: "hacked@example.com",
        email_verified: true,
        iss: `https://securetoken.google.com/${TEST_PROJECT_ID}`,
        aud: TEST_PROJECT_ID,
      })
    ).toString("base64url");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    await expect(
      verifyFirebaseIdToken(tamperedToken, TEST_PROJECT_ID)
    ).rejects.toThrow();
  });

  it("handles token without email by defaulting to empty string", async () => {
    const noEmailToken = await new SignJWT({
      sub: "usr_google_no_email",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: TEST_KID })
      .setIssuer(`https://securetoken.google.com/${TEST_PROJECT_ID}`)
      .setAudience(TEST_PROJECT_ID)
      .setExpirationTime("1h")
      .sign(privateKey);

    const result = await verifyFirebaseIdToken(noEmailToken, TEST_PROJECT_ID);
    expect(result).toEqual({
      uid: "usr_google_no_email",
      email: "",
    });
  });

  it("supports custom JWKS injection via options", async () => {
    const customPair = await generateKeyPair("RS256");
    const customJwk = await exportJWK(customPair.publicKey);
    customJwk.kid = "custom-key-1";
    customJwk.alg = "RS256";
    customJwk.use = "sig";

    const customJwks = createLocalJWKSet({ keys: [customJwk] });

    const customToken = await new SignJWT({
      sub: "usr_google_custom",
      email: "custom@example.com",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: "custom-key-1" })
      .setIssuer(`https://securetoken.google.com/${TEST_PROJECT_ID}`)
      .setAudience(TEST_PROJECT_ID)
      .setExpirationTime("1h")
      .sign(customPair.privateKey);

    const result = await verifyFirebaseIdToken(customToken, TEST_PROJECT_ID, {
      jwks: customJwks,
    });

    expect(result).toEqual({
      uid: "usr_google_custom",
      email: "custom@example.com",
    });
  });
});
