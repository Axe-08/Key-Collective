/**
 * Key Collective v4 — S8 GitHub OAuth Callback Security Tests
 *
 * Invariants Tested:
 * 1. Strict TypeScript: Zero any.
 * 2. HTTP 410 Gone: GET /api/auth/github/callback (with or without query parameters) returns 410.
 * 3. Token Exfiltration Shield: Response body never contains 'postMessage' or '/?token='.
 * 4. Zero Persistence: No user records or auth tokens inserted into the real (migrated) D1.
 */

import { describe, expect, it } from "vitest";
import { env as testEnv } from "cloudflare:test";
import { handleOAuthGithubCallback } from "../../../src/worker/router/dashboard/auth_routes";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";

async function countIdentityRows(): Promise<{ users: number; tokens: number }> {
  const users = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  const tokens = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM auth_tokens").first<{ n: number }>();
  return { users: users?.n ?? 0, tokens: tokens?.n ?? 0 };
}

describe("S8 Security: Disabled GitHub OAuth Callback (HTTP 410 Gone)", () => {
  it("returns HTTP 410 Gone when called directly without query parameters", async () => {
    const before = await countIdentityRows();
    const env: WorkerEnv = { DB: testEnv.DB };

    const req = new Request("http://localhost/api/auth/github/callback", {
      method: "GET",
    });

    const res = await handleOAuthGithubCallback(req, env);
    expect(res.status).toBe(410);

    const bodyText = await res.text();
    expect(bodyText).not.toContain("postMessage");
    expect(bodyText).not.toContain("/?token=");

    const data = JSON.parse(bodyText) as {
      error: { message: string; code: string; statusCode: number };
    };
    expect(data.error.code).toBe("GONE");
    expect(data.error.statusCode).toBe(410);
    expect(data.error.message).toBe(
      "GitHub authentication is disabled until link flow is implemented."
    );

    expect(await countIdentityRows()).toEqual(before);
  });

  it("returns HTTP 410 Gone when called directly with OAuth code and state", async () => {
    const before = await countIdentityRows();
    const env: WorkerEnv = {
      DB: testEnv.DB,
      GITHUB_CLIENT_SECRET: "test-github-secret",
    };

    const req = new Request(
      "http://localhost/api/auth/github/callback?code=foo&state=bar",
      {
        method: "GET",
      }
    );

    const res = await handleOAuthGithubCallback(req, env);
    expect(res.status).toBe(410);

    const bodyText = await res.text();
    expect(bodyText).not.toContain("postMessage");
    expect(bodyText).not.toContain("/?token=");

    const data = JSON.parse(bodyText) as {
      error: { message: string; code: string; statusCode: number };
    };
    expect(data.error.code).toBe("GONE");
    expect(data.error.statusCode).toBe(410);
    expect(data.error.message).toBe(
      "GitHub authentication is disabled until link flow is implemented."
    );

    expect(await countIdentityRows()).toEqual(before);
  });

  it("routes GET /api/auth/github/callback through MainWorker to HTTP 410 without inserting into D1", async () => {
    const before = await countIdentityRows();
    const env: WorkerEnv = {
      DB: testEnv.DB,
      GITHUB_CLIENT_SECRET: "mock-secret",
    };

    const req = new Request(
      "https://console.key-col.axe08.tech/api/auth/github/callback?code=test_code_123&state=xyz",
      {
        method: "GET",
      }
    );

    const res = await defaultMainWorker.fetch(req, env);
    expect(res.status).toBe(410);

    const bodyText = await res.text();
    expect(bodyText).not.toContain("postMessage");
    expect(bodyText).not.toContain("/?token=");

    const data = JSON.parse(bodyText) as {
      error: { message: string; code: string; statusCode: number };
    };
    expect(data.error.code).toBe("GONE");
    expect(data.error.statusCode).toBe(410);

    expect(await countIdentityRows()).toEqual(before);
  });
});
