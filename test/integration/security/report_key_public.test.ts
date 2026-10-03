/**
 * @file report_key_public.test.ts
 * T-F.9.4 (QA-16): POST /api/abuse/report-key is a public route. A signed-in browser
 * sends its kc_session cookie without x-kc-csrf; the route must not apply the session
 * CSRF check, and the session grants it no authority. Turnstile is the only gate.
 */

import { afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { MainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { mockTurnstile } from "../../helpers/upstream";
import { createSession, createUser } from "../../helpers/world";

const workerEnv = { ...env, TENANT_QUOTA: undefined } as unknown as WorkerEnv;
const worker = new MainWorker();

function report(cookie: string | null, ip: string): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cf-connecting-ip": ip,
  };
  if (cookie) headers.cookie = cookie;
  return worker.fetch(
    new Request("https://console.test/api/abuse/report-key", {
      method: "POST",
      headers,
      body: JSON.stringify({
        leaked_key: `AIza_not_registered_${crypto.randomUUID()}`,
        turnstile_token: "token-checked-by-mocked-siteverify",
      }),
    }),
    workerEnv
  );
}

afterEach(() => {
  fetchMock.deactivate();
});

describe("T-F.9.4 public key report", () => {
  it("accepts a signed-in report with a valid Turnstile token and no CSRF header", async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    mockTurnstile(true);
    const user = await createUser();
    const { cookie } = await createSession(user);

    const res = await report(cookie, "198.51.100.21");

    expect(res.status).toBe(200);
  });

  it("accepts a signed-out report with a valid Turnstile token", async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    mockTurnstile(true);

    const res = await report(null, "198.51.100.22");

    expect(res.status).toBe(200);
  });

  it("answers a bad Turnstile token with the Turnstile error, not csrf_required, when signed in", async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    mockTurnstile(false);
    const user = await createUser();
    const { cookie } = await createSession(user);

    const res = await report(cookie, "198.51.100.23");

    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain("csrf_required");
    const body = JSON.parse(text) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("turnstile_failed");
    expect(body.error.message).toContain("Turnstile");
  });
});
