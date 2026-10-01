/**
 * Key Collective v4 — Turnstile Unconditional Verification Gate (WP-0.5)
 *
 * Invariants Tested:
 * 1. POST /api/keys (handlePostKeys) always calls Cloudflare siteverify — the
 *    well-known Turnstile test token `valid_turnstile_response` no longer
 *    bypasses verification; siteverify's answer is what decides the outcome.
 * 2. When siteverify reports failure, the route rejects with 403 and the
 *    "Turnstile validation failed" message, regardless of which token was sent.
 */

import { describe, expect, it, beforeAll, afterEach } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { handlePostKeys } from "../../../src/worker/router/dashboard/keys/post_key";
import { handleReportKeyAbuse } from "../../../src/worker/router/dashboard/abuse_routes";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { createUser } from "../../helpers/world";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    TURNSTILE_SECRET?: string;
  }
}

const MASTER_KEY = "test-master-key-turnstile-gate";
const SITEVERIFY_ORIGIN = "https://challenges.cloudflare.com";
const SITEVERIFY_PATH = "/turnstile/v0/siteverify";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

function makeTestEnv(): WorkerEnv {
  return {
    DB: env.DB,
    TURNSTILE_SECRET: env.TURNSTILE_SECRET ?? "test-secret",
  };
}

describe("Turnstile gate: POST /api/keys always verifies via siteverify", () => {
  it("rejects with 403 when siteverify reports failure, even for the well-known test token", async () => {
    fetchMock
      .get(SITEVERIFY_ORIGIN)
      .intercept({ path: SITEVERIFY_PATH, method: "POST" })
      .reply(
        200,
        JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }),
        { headers: { "content-type": "application/json" } }
      );

    const user = await createUser();
    const request = new Request("https://api.keycollective.ai/api/keys", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-turnstile-token": "valid_turnstile_response",
      },
      body: JSON.stringify({
        provider: "groq",
        label: "should-not-be-created",
        key: "gsk_shouldNotBeInserted0123456789",
        k1: true,
        k2: true,
      }),
    });

    const res = await handlePostKeys(request, makeTestEnv(), user.id, MASTER_KEY);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "turnstile_failed" });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE tenant_id = ?").bind(user.id).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});

describe("Turnstile gate: abuse takedown requires a token", () => {
  it("rejects with 403 when no Turnstile token is supplied at all", async () => {
    const req = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaked_key: "test_key" }),
    });

    await expect(handleReportKeyAbuse(req, makeTestEnv())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
