/**
 * Key Collective — registration consent C1–C3 (WP-3.2, AC-15)
 *
 * Invariants Tested:
 * 0. Consent missing C2 → 422 listing C2, and nothing is written.
 * 1. Full consent writes 3 REGISTRATION attestations with IP and UA, activates the user,
 *    sets kc_session and clears kc_pending.
 * 2. A PENDING_CONSENT user gets 403 consent_required on /api/keys (session or bearer)
 *    and 200 on /api/session.
 * 3. Consent without a valid kc_pending cookie is refused.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { createPendingToken, lookupSession } from "../../../src/auth/session/store";
import { createApiKey, createSession, createUser } from "../../helpers/world";

const workerEnv = { ...env, TENANT_QUOTA: undefined } as unknown as WorkerEnv;
const secret = String((env as unknown as { KC_MASTER_KEY?: string }).KC_MASTER_KEY ?? "");

function consent(body: Record<string, unknown>, cookie?: string): Promise<Response> {
  return defaultMainWorker.fetch(
    new Request("https://console.test/api/auth/consent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.7",
        "user-agent": "consent-test/1.0",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    workerEnv
  );
}

async function pendingUser() {
  const user = await createUser({ registrationStatus: "PENDING_CONSENT" });
  return { user, cookie: `kc_pending=${await createPendingToken(secret, user.id)}` };
}

async function attestations(userId: string) {
  return (
    await env.DB.prepare(
      "SELECT event_type, checkbox_id, consent_version, ip_address, user_agent FROM consent_attestations WHERE tenant_id = ? ORDER BY checkbox_id"
    )
      .bind(userId)
      .all<{ event_type: string; checkbox_id: string; consent_version: string; ip_address: string; user_agent: string }>()
  ).results;
}

describe("registration consent", () => {
  it("[0] missing C2 → 422 listing C2 and no rows written", async () => {
    const { user, cookie } = await pendingUser();

    const res = await consent({ c1: true, c3: true }, cookie);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "consent_required", missing: ["C2"] });
    expect(await attestations(user.id)).toEqual([]);
  });

  it("[1] full consent records C1–C3, activates the user and swaps kc_pending for kc_session", async () => {
    const { user, cookie } = await pendingUser();

    const res = await consent({ c1: true, c2: true, c3: true }, cookie);

    expect(res.status).toBe(200);
    const rows = await attestations(user.id);
    expect(rows.map((r) => r.checkbox_id)).toEqual(["C1", "C2", "C3"]);
    for (const row of rows) {
      expect(row).toMatchObject({ event_type: "REGISTRATION", ip_address: "203.0.113.7", user_agent: "consent-test/1.0" });
      expect(row.consent_version).toBeTruthy();
    }
    const status = await env.DB.prepare("SELECT registration_status FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ registration_status: string }>();
    expect(status?.registration_status).toBe("ACTIVE");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("kc_pending=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
    const session = setCookie.match(/kc_session=([^;]+)/)?.[1] ?? "";
    expect(await lookupSession(env.DB, session)).toMatchObject({ userId: user.id, kind: "console" });
  });

  it("[2] a PENDING_CONSENT user is held at 403 consent_required except on /api/session", async () => {
    const user = await createUser({ registrationStatus: "PENDING_CONSENT" });
    const { cookie } = await createSession(user);
    const bearer = await createApiKey(user);
    const get = (path: string, headers: Record<string, string>) =>
      defaultMainWorker.fetch(new Request(`https://console.test${path}`, { headers }), workerEnv);

    const bySession = await get("/api/keys", { cookie });
    const byBearer = await get("/api/keys", { authorization: `Bearer ${bearer}` });
    const sessionInfo = await get("/api/session", { cookie });

    expect(bySession.status).toBe(403);
    expect(await bySession.json()).toEqual({ error: "consent_required" });
    expect(byBearer.status).toBe(401);
    expect(sessionInfo.status).toBe(200);
  });

  it("[3] consent without a valid kc_pending cookie is refused and writes nothing", async () => {
    const user = await createUser({ registrationStatus: "PENDING_CONSENT" });
    const forged = `kc_pending=${user.id}.${Date.now() + 60_000}.forged`;
    const expired = `kc_pending=${await createPendingToken(secret, user.id, Date.now() - 3_600_000)}`;

    const none = await consent({ c1: true, c2: true, c3: true });
    const bad = await consent({ c1: true, c2: true, c3: true }, forged);
    const old = await consent({ c1: true, c2: true, c3: true }, expired);

    expect(none.status).toBe(401);
    expect(bad.status).toBe(401);
    expect(old.status).toBe(401);
    expect(await attestations(user.id)).toEqual([]);
  });
});
