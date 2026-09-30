/**
 * Upstream service mocking helpers for Key Collective test suites.
 * Built on Undici MockAgent exported as `fetchMock` from `cloudflare:test`.
 */

import { fetchMock } from "cloudflare:test";
import { beforeAll } from "vitest";

export function initFetchMock(): void {
  try {
    beforeAll(() => {
      fetchMock.activate();
      fetchMock.disableNetConnect();
    });
  } catch {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  }
}

export interface MockGeminiOptions {
  status?: number;
  body?: unknown;
  sse?: string[];
  usage?: unknown;
  path?: string | RegExp | ((path: string) => boolean);
}

export function mockGemini({
  status = 200,
  body,
  sse,
  usage,
  path,
}: MockGeminiOptions = {}) {
  fetchMock.activate();
  const client = fetchMock.get("https://generativelanguage.googleapis.com");

  if (sse !== undefined) {
    let sseString = sse
      .map((chunk) => {
        if (
          chunk.startsWith("data:") ||
          chunk.startsWith("event:") ||
          chunk.startsWith(":")
        ) {
          return chunk.endsWith("\n\n")
            ? chunk
            : chunk.endsWith("\n")
              ? chunk + "\n"
              : `${chunk}\n\n`;
        }
        return `data: ${chunk}\n\n`;
      })
      .join("");

    if (usage !== undefined && !sseString.includes("usageMetadata")) {
      sseString += `data: ${JSON.stringify({ usageMetadata: usage })}\n\n`;
    }

    return client
      .intercept({
        path: path ?? /.*/,
        method: () => true,
      })
      .reply(status, sseString, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
      });
  }

  let responseBody = body;
  if (responseBody === undefined) {
    const effectiveUsage = usage ?? {
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      totalTokenCount: 30,
    };
    responseBody = {
      candidates: [
        {
          content: {
            parts: [{ text: "Mocked Gemini response" }],
            role: "model",
          },
          finishReason: "STOP",
          index: 0,
        },
      ],
      usageMetadata: effectiveUsage,
    };
  } else if (
    usage !== undefined &&
    typeof responseBody === "object" &&
    responseBody !== null &&
    !Array.isArray(responseBody) &&
    !("usageMetadata" in responseBody)
  ) {
    responseBody = {
      ...responseBody,
      usageMetadata: usage,
    };
  }

  return client
    .intercept({
      path: path ?? /.*/,
      method: () => true,
    })
    .reply(status, responseBody as object, {
      headers: { "content-type": "application/json" },
    });
}

export interface MockGroqOptions {
  status?: number;
  body?: unknown;
  path?: string | RegExp | ((path: string) => boolean);
}

export function mockGroq({
  status = 200,
  body,
  path,
}: MockGroqOptions = {}) {
  fetchMock.activate();
  const defaultBody = {
    id: "chatcmpl-mock-groq-123",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "llama-3.1-70b-versatile",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Mocked Groq response",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  };

  const client = fetchMock.get("https://api.groq.com");
  return client
    .intercept({
      path: path ?? /.*/,
      method: () => true,
    })
    .reply(status, (body ?? defaultBody) as object, {
      headers: { "content-type": "application/json" },
    });
}

export function mockGeminiErrorInfo(projectNumber: string | number) {
  return {
    error: {
      code: 429,
      message: "Resource exhausted",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "RESOURCE_EXHAUSTED",
          domain: "googleapis.com",
          metadata: {
            service: "generativelanguage.googleapis.com",
            consumer: `projects/${projectNumber}`,
          },
        },
      ],
    },
  };
}

export function mockTurnstile(success: boolean, opts: { persist?: boolean } = {}) {
  fetchMock.activate();
  const client = fetchMock.get("https://challenges.cloudflare.com");
  const scope = client
    .intercept({
      path: (p: string) => p.includes("/turnstile/v0/siteverify"),
      method: () => true,
    })
    .reply(
      200,
      {
        success,
        "error-codes": success ? [] : ["invalid-input-response"],
      },
      {
        headers: { "content-type": "application/json" },
      }
    );
  if (opts.persist) scope.persist();
  return scope;
}

const FIXED_PRIVATE_JWK: JsonWebKey = {
  key_ops: ["sign"],
  ext: true,
  alg: "RS256",
  kty: "RSA",
  n: "8eizqSGAX7k7qI6cxQbK_QG8OyMy5Jzpi69BANeHnQicrMAa9yZR_6zvF68oeyIGQPiiAZjGIgN2Gtz5CB2WfawGWI-DLlcZos9_G_u3wO3cpElQJB4K32KAsBUNvWiq1OrYw6b4Mx9jFgsXUPdDc1UZSIkpgYgru6hv-icwAba2ccDJ_t_ZSRh-JsZpE2a2lLbVRC8neKlBl7fMZdP5dBN8XrtDtcnVsTXvUGKMjzG5U6j6aMTPPMMg-B9JVZi3oLfqZ3JqoVqN31rqZ2luIdKbR2p6CRVuTvbOUj4GbqwUAd3s7VRe4704FNxaw8c9Mzdbt5gvHHuZu4P1SR1EBQ",
  e: "AQAB",
  d: "EYOYVP5CG0Fqcn2CF85c7kIXZ4KuDG4t3HlKRVjVY9xRQj1AVoogNVjHEK8TnmKWvafNTDyhhP880vISV5uTdIglXM5lys-Z4WHmIS0Gyew5ZW2SD04GLykkXwXkh5o8hWDMDnztYFTSlDB7tiweETYP4rgHg24hQxtioWOqmUewqzjl4zoomYW_MFnZ5sBiYLeHeXD7CSCHqAfskWGTS7QGeu5H2goTmQzjF6CzhJN0LnBY6xpgQhYtfszC0q7_nsbKQZkug7JtLTmLM-qMxV2pj0IHXrGe5CoqJwBw49EiM_PXJkp10ZFpxaOH9lfsKYEbNpe397LgyccK35Vd0Q",
  p: "_VYqFQm-18Bmm0DVj1smFuUhRDx_dVCKVsaz08TYK0lgYXG-CdyBjI5lpOTvJekWnggD4TvU4fnXDDq5lJAwRTNJwz4sc0NjlrUcIJkkWbnEYGsaYrO4Q9FfueIBfNLC36YCjG5GCpgx5lwydT5tQ7gPb8h6tPI9JrPQFy3hxCk",
  q: "9HPH7KheYylyyQ7oRGqEYd4mrETj0PC5nQfD0LRvYcuZMEstgg6g0NukEXP-3NrWf_zDciNvPMXVqv4JoxGCi0ayUkRcfFnN8yDavpzRH6tWz29EqgMFxA25ROpkF1uUR-BWVM7tl3TjEviATVDqOkrFsAtDt8sUFCBp1dqMHH0",
  dp: "CWemfktzU00oQgFBLGZE3rq45nCchr1rtVcBHA6Fu-2ob1WqqXEPOimbKmj5W93wYgOIKVdwSsdcrW6MrzA_KoKB7YakXc8VpmWo2qj0yYP0_2NagmmLoLDoLd1vErQ8WdMu6wm4_fGygIvRr7qWkdoGcK7vp0IK9SHdys6AQCk",
  dq: "kubhRj8IOd82s8zZmAPK-mVeKDheD7oaUVvROSK1rLeFn5gOCRJxYhIcTsC-cEqyjMeBTJ4uwv7AoLl5YR2srbYWg4nBapktQuaDjfj_U2DMEmxzfxfB50e4Bso0zDSkr20JdH3GGjaMH2Jm-A-gMtesZVbfoxvPPSkdcP6dJKE",
  qi: "RARX0w8cZ0IOjJGqAmmOjOXX0MMYBlibDXen69UPP1dA5B5oVOVku8clwq9xZaS3beDt70mrYlp8p8tKVdzBvmfRCt3TTPNepnxFnMtb0KtD0QwqeK2Av-xjef2LDgBZB3p_b8Y-IvmEEDH1IMVjnL2V23AnTSVelBjG9wdx8lg",
};

const FIXED_PUBLIC_JWK: JsonWebKey = {
  alg: "RS256",
  kty: "RSA",
  n: "8eizqSGAX7k7qI6cxQbK_QG8OyMy5Jzpi69BANeHnQicrMAa9yZR_6zvF68oeyIGQPiiAZjGIgN2Gtz5CB2WfawGWI-DLlcZos9_G_u3wO3cpElQJB4K32KAsBUNvWiq1OrYw6b4Mx9jFgsXUPdDc1UZSIkpgYgru6hv-icwAba2ccDJ_t_ZSRh-JsZpE2a2lLbVRC8neKlBl7fMZdP5dBN8XrtDtcnVsTXvUGKMjzG5U6j6aMTPPMMg-B9JVZi3oLfqZ3JqoVqN31rqZ2luIdKbR2p6CRVuTvbOUj4GbqwUAd3s7VRe4704FNxaw8c9Mzdbt5gvHHuZu4P1SR1EBQ",
  e: "AQAB",
};

export const DEFAULT_MOCK_KID = "mock-firebase-key-1";

export function mockGoogleJwks(options?: {
  kid?: string;
  keys?: Record<string, unknown>[];
}) {
  fetchMock.activate();
  const kid = options?.kid ?? DEFAULT_MOCK_KID;
  const publicJwk = {
    ...FIXED_PUBLIC_JWK,
    kid,
    use: "sig",
    alg: "RS256",
  };
  const keys = options?.keys ?? [publicJwk];
  const client = fetchMock.get("https://www.googleapis.com");
  return client
    .intercept({
      path: (p: string) => p.includes("securetoken@system.gserviceaccount.com"),
      method: () => true,
    })
    .reply(200, { keys }, { headers: { "content-type": "application/json" } })
    .persist();
}

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cachedPrivateKey: CryptoKey | null = null;

export async function signFirebaseIdToken(
  claims: Record<string, unknown>,
  options?: { kid?: string; privateJwk?: JsonWebKey }
): Promise<string> {
  const kid = options?.kid ?? DEFAULT_MOCK_KID;
  let privKey: CryptoKey;
  if (options?.privateJwk) {
    privKey = await crypto.subtle.importKey(
      "jwk",
      options.privateJwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } else {
    if (!cachedPrivateKey) {
      cachedPrivateKey = await crypto.subtle.importKey(
        "jwk",
        FIXED_PRIVATE_JWK,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
      );
    }
    privKey = cachedPrivateKey;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid,
  };
  const payload = {
    iss: "https://securetoken.google.com/test-project",
    aud: "test-project",
    auth_time: nowSec,
    user_id: claims.sub ?? claims.user_id ?? "test-user-id",
    sub: claims.sub ?? claims.user_id ?? "test-user-id",
    iat: nowSec,
    exp: nowSec + 3600,
    ...claims,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const dataToSign = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privKey,
    dataToSign
  );

  const signatureB64 = base64UrlEncode(new Uint8Array(signature));
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

export function mockGithub(
  profile: { id?: number; login: string },
  contributions?: number
) {
  fetchMock.activate();
  const client = fetchMock.get("https://api.github.com");
  const id = profile.id ?? 1234567;
  const count = contributions ?? 50;

  const userPayload = {
    id,
    login: profile.login,
    name: profile.login,
    avatar_url: `https://avatars.githubusercontent.com/u/${id}`,
    html_url: `https://github.com/${profile.login}`,
    public_repos: 10,
    total_contributions: count,
    contributions: count,
    contributions_count: count,
    created_at: "2020-01-01T00:00:00Z",
    email: `${profile.login}@example.com`,
  };

  const restScope = client
    .intercept({
      path: (p: string) => p.startsWith("/user"),
      method: () => true,
    })
    .reply(200, userPayload, {
      headers: { "content-type": "application/json" },
    })
    .persist();

  const gqlScope = client
    .intercept({
      path: "/graphql",
      method: "POST",
    })
    .reply(
      200,
      {
        data: {
          user: {
            contributionsCollection: {
              contributionCalendar: {
                totalContributions: count,
              },
            },
          },
        },
      },
      {
        headers: { "content-type": "application/json" },
      }
    )
    .persist();

  return { restScope, gqlScope };
}
