/**
 * Key Collective — POST /api/playground/token (WP-3.10, section 2.3 flow 6)
 *
 * Invariants Tested:
 * 1. A signed-in user gets a kc_live_ key scoped to them, rpm_limit 10, expiring in 15 minutes.
 * 2. Without a session → 401 (the demo token stays at /api/demo/token).
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { createSession, createUser } from "../../helpers/world";

const workerEnv = { ...env, TENANT_QUOTA: undefined, KEY_POOL: undefined } as unknown as WorkerEnv;

function mint(headers: Record<string, string>): Promise<Response> {
  return defaultMainWorker.fetch(new Request("https://console.test/api/playground/token", { method: "POST", headers }), workerEnv);
}

describe("POST /api/playground/token", () => {
  it("mints a 15-minute, 10 RPM kc_live_ key for the signed-in user", async () => {
    const user = await createUser();
    const { cookie, csrfToken } = await createSession(user);
    const before = Date.now();

    const res = await mint({ cookie, "x-kc-csrf": csrfToken });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; id: string; expires_at: string; rpm_limit: number };
    expect(body.token).toMatch(/^kc_live_/);
    expect(body.rpm_limit).toBe(10);
    const ttl = new Date(body.expires_at).getTime() - before;
    expect(ttl).toBeGreaterThan(14 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
    const row = await env.DB.prepare("SELECT tenant_id, rpm_limit, expires_at FROM auth_tokens WHERE id = ?").bind(body.id).first();
    expect(row).toMatchObject({ tenant_id: user.id, rpm_limit: 10, expires_at: body.expires_at });
  });

  it("needs a session", async () => {
    expect((await mint({})).status).toBe(401);
  });
});
