import { describe, it, expect } from "vitest";
import { api, console as consoleUrl, admin } from "../helpers/hosts";
import {
  initFetchMock,
  mockGemini,
  mockGroq,
  mockGeminiErrorInfo,
  mockTurnstile,
  mockGoogleJwks,
  signFirebaseIdToken,
  mockGithub,
  DEFAULT_MOCK_KID,
} from "../helpers/upstream";

describe("Host URL Builders", () => {
  it("builds correct api URLs with and without leading slash", () => {
    expect(api("/v1/models")).toBe("https://api.test/v1/models");
    expect(api("v1/chat/completions")).toBe("https://api.test/v1/chat/completions");
  });

  it("builds correct console URLs with and without leading slash", () => {
    expect(consoleUrl("/login")).toBe("https://console.test/login");
    expect(consoleUrl("dashboard/keys")).toBe("https://console.test/dashboard/keys");
  });

  it("builds correct admin URLs with and without leading slash", () => {
    expect(admin("/users")).toBe("https://admin.test/users");
    expect(admin("metrics")).toBe("https://admin.test/metrics");
  });
});

describe("Upstream Fetch Mocks (Workers Runtime)", () => {
  initFetchMock();

  describe("mockGemini", () => {
    it("intercepts requests with default response and usageMetadata", async () => {
      mockGemini();

      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST" }
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
        usageMetadata: { promptTokenCount: number };
      };
      expect(data.candidates[0].content.parts[0].text).toBe("Mocked Gemini response");
      expect(data.usageMetadata.promptTokenCount).toBe(10);
    });

    it("supports custom status, body, and usage", async () => {
      mockGemini({
        status: 200,
        body: { result: "custom-gemini-ok" },
        usage: { promptTokenCount: 42 },
      });

      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/test");
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        result: string;
        usageMetadata: { promptTokenCount: number };
      };
      expect(data.result).toBe("custom-gemini-ok");
      expect(data.usageMetadata.promptTokenCount).toBe(42);
    });

    it("handles SSE streaming chunks and token usage", async () => {
      mockGemini({
        sse: [
          '{"candidates":[{"content":{"parts":[{"text":"chunk-1"}]}}]}',
          '{"candidates":[{"content":{"parts":[{"text":"chunk-2"}]}}]}',
        ],
        usage: { promptTokenCount: 15, candidatesTokenCount: 30, totalTokenCount: 45 },
      });

      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent"
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const text = await res.text();
      expect(text).toContain("chunk-1");
      expect(text).toContain("chunk-2");
      expect(text).toContain("usageMetadata");
      expect(text).toContain('"totalTokenCount":45');
    });

    it("handles mockGeminiErrorInfo for 429 quota exhaustion", async () => {
      const errPayload = mockGeminiErrorInfo("proj-12345");
      expect(errPayload.error.code).toBe(429);
      expect(errPayload.error.details[0].reason).toBe("RESOURCE_EXHAUSTED");
      expect(errPayload.error.details[0].metadata.consumer).toBe("projects/proj-12345");

      mockGemini({
        status: 429,
        body: errPayload,
      });

      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models");
      expect(res.status).toBe(429);
      const data = (await res.json()) as typeof errPayload;
      expect(data.error.code).toBe(429);
      expect(data.error.details[0].metadata.consumer).toBe("projects/proj-12345");
    });
  });

  describe("mockGroq", () => {
    it("intercepts requests with default completion structure", async () => {
      mockGroq();

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        model: string;
        choices: Array<{ message: { content: string } }>;
        usage: { total_tokens: number };
      };
      expect(data.model).toBe("llama-3.1-70b-versatile");
      expect(data.choices[0].message.content).toBe("Mocked Groq response");
      expect(data.usage.total_tokens).toBe(30);
    });

    it("intercepts requests with custom body and status", async () => {
      mockGroq({
        status: 201,
        body: { id: "groq-custom-response", model: "mixtral-8x7b-32768" },
      });

      const res = await fetch("https://api.groq.com/openai/v1/custom");
      expect(res.status).toBe(201);
      const data = (await res.json()) as { id: string; model: string };
      expect(data.id).toBe("groq-custom-response");
      expect(data.model).toBe("mixtral-8x7b-32768");
    });
  });

  describe("mockTurnstile", () => {
    it("mocks successful Turnstile verification", async () => {
      mockTurnstile(true);

      const res = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        { method: "POST" }
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        success: boolean;
        "error-codes": string[];
      };
      expect(data.success).toBe(true);
      expect(data["error-codes"]).toEqual([]);
    });

    it("mocks failed Turnstile verification with error-codes", async () => {
      mockTurnstile(false);

      const res = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        { method: "POST" }
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        success: boolean;
        "error-codes": string[];
      };
      expect(data.success).toBe(false);
      expect(data["error-codes"]).toContain("invalid-input-response");
    });
  });

  describe("mockGoogleJwks & signFirebaseIdToken", () => {
    it("serves JWKS endpoint and produces verifiable Firebase ID tokens", async () => {
      mockGoogleJwks({ kid: DEFAULT_MOCK_KID });

      // Fetch JWKS
      const jwksRes = await fetch(
        "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
      );
      expect(jwksRes.status).toBe(200);
      const jwks = (await jwksRes.json()) as {
        keys: Array<JsonWebKey & { kid: string }>;
      };
      expect(jwks.keys.length).toBeGreaterThan(0);
      const matchingKey = jwks.keys.find((k) => k.kid === DEFAULT_MOCK_KID);
      expect(matchingKey).toBeDefined();
      expect(matchingKey?.kty).toBe("RSA");
      expect(matchingKey?.alg).toBe("RS256");

      // Sign token
      const token = await signFirebaseIdToken({
        sub: "firebase-user-999",
        email: "testuser@gmail.com",
      });

      const parts = token.split(".");
      expect(parts.length).toBe(3);

      // Verify header
      const headerJson = atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"));
      const header = JSON.parse(headerJson) as { alg: string; kid: string; typ: string };
      expect(header.alg).toBe("RS256");
      expect(header.kid).toBe(DEFAULT_MOCK_KID);

      // Verify payload
      const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
      const payload = JSON.parse(payloadJson) as {
        sub: string;
        email: string;
        iss: string;
        aud: string;
      };
      expect(payload.sub).toBe("firebase-user-999");
      expect(payload.email).toBe("testuser@gmail.com");
      expect(payload.iss).toBe("https://securetoken.google.com/test-project");

      // Verify RS256 signature using the imported JWK from the mocked endpoint
      const cryptoPub = await crypto.subtle.importKey(
        "jwk",
        matchingKey as JsonWebKey,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );

      const dataToVerify = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      let sigBase64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
      while (sigBase64.length % 4 !== 0) {
        sigBase64 += "=";
      }
      const sigBinary = atob(sigBase64);
      const sigBytes = new Uint8Array(sigBinary.length);
      for (let i = 0; i < sigBinary.length; i++) {
        sigBytes[i] = sigBinary.charCodeAt(i);
      }

      const isValid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        cryptoPub,
        sigBytes,
        dataToVerify
      );
      expect(isValid).toBe(true);
    });
  });

  describe("mockGithub", () => {
    it("mocks REST user profile and GraphQL contributions", async () => {
      mockGithub({ id: 98765, login: "octocat-test" }, 77);

      // Test REST user endpoint
      const userRes = await fetch("https://api.github.com/user");
      expect(userRes.status).toBe(200);
      const user = (await userRes.json()) as {
        id: number;
        login: string;
        contributions: number;
      };
      expect(user.id).toBe(98765);
      expect(user.login).toBe("octocat-test");
      expect(user.contributions).toBe(77);

      // Test GraphQL contributions endpoint
      const gqlRes = await fetch("https://api.github.com/graphql", {
        method: "POST",
      });
      expect(gqlRes.status).toBe(200);
      const gqlData = (await gqlRes.json()) as {
        data: {
          user: {
            contributionsCollection: {
              contributionCalendar: {
                totalContributions: number;
              };
            };
          };
        };
      };
      expect(
        gqlData.data.user.contributionsCollection.contributionCalendar.totalContributions
      ).toBe(77);
    });
  });
});
