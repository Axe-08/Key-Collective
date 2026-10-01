/**
 * Key Collective — Upstream Notifications & Abuse Takedown Notifications (WP-4.3, T-4.3.3)
 *
 * Verifies:
 * 1. Migration 0017_notifications.sql schema (id, tenant_id, type, key_id, message, created_at, read_at).
 * 2. 401/403 key_invalid settlement generates an owner notification with Flow G text.
 * 3. Abuse takedown via /api/abuse/report-key generates an owner notification ("Your key was revoked after an abuse report").
 * 4. GET /api/notifications?since=<ms> returns tenant-scoped notifications.
 * 5. POST /api/notifications/:id/read updates read_at timestamp.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock, SELF } from "cloudflare:test";
import { addProviderKey, createApiKey, createSession, createUser } from "../../helpers/world";

let groqStep: () => { statusCode: number; data: string; headers?: Record<string, string> } = () => ({
  statusCode: 200,
  data: JSON.stringify({
    id: "chatcmpl-ok",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
  }),
});

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  fetchMock
    .get("https://challenges.cloudflare.com")
    .intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
    .reply(() => ({
      statusCode: 200,
      data: JSON.stringify({ success: true }),
      responseOptions: { headers: { "content-type": "application/json" } },
    }))
    .persist();

  fetchMock
    .get("https://api.groq.com")
    .intercept({ path: /.*/, method: "POST" })
    .reply(() => {
      const step = groqStep();
      return {
        statusCode: step.statusCode,
        data: step.data,
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM notifications").run().catch(() => {});
});

describe("Notifications & Upstream Quarantine Alerts (WP-4.3 T-4.3.3)", () => {
  it("creates a notification when a PRIVATE key encounters 401 key_invalid", async () => {
    const user = await createUser({ github: true, eligible: true });
    const privKey = await addProviderKey(user, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_notif_priv_test_key_0001",
    });
    const token = await createApiKey(user);
    const session = await createSession(user);

    groqStep = () => ({
      statusCode: 401,
      data: JSON.stringify({ error: { message: "Invalid API Key" } }),
    });

    const res = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Trigger 401" }],
        max_fallbacks: 0,
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(500);

    // Verify notification was stored in D1
    const notifs = await env.DB.prepare(
      "SELECT * FROM notifications WHERE tenant_id = ?"
    )
      .bind(user.id)
      .all<{ id: string; type: string; key_id: string; message: string; created_at: number; read_at: number | null }>();

    expect(notifs.results.length).toBe(1);
    const notif = notifs.results[0];
    expect(notif.key_id).toBe(privKey.id);
    expect(notif.type).toBe("key_invalid");
    expect(notif.message).toContain("went unhealthy");
    expect(notif.message).toContain("Groq");
    expect(notif.read_at).toBeNull();

    // Verify GET /api/notifications returns it
    const getRes = await SELF.fetch("https://console.test/api/notifications", {
      headers: {
        cookie: session.cookie,
      },
    });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { notifications: Array<{ id: string; message: string; read_at: number | null }> };
    expect(body.notifications.length).toBe(1);
    expect(body.notifications[0].id).toBe(notif.id);
    expect(body.notifications[0].read_at).toBeNull();
  });

  it("creates a notification when a COMMUNITY key encounters 401 key_invalid", async () => {
    const owner = await createUser({ github: true, eligible: true });
    const commKey = await addProviderKey(owner, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_notif_comm_test_key_0002",
    });
    const token = await createApiKey(owner);

    const coord = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:groq")
    ) as unknown as {
      reconcile(provider?: string): Promise<{ upserted: number; removed: number }>;
      setStatus(keyId: string, status: string): Promise<boolean>;
    };
    await coord.reconcile("groq");
    await coord.setStatus(commKey.id, "ACTIVE");

    groqStep = () => ({
      statusCode: 401,
      data: JSON.stringify({ error: { message: "Invalid API Key" } }),
    });

    const res = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Trigger 401" }],
        max_fallbacks: 0,
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(500);

    // Verify notification was stored for the key owner
    const notifs = await env.DB.prepare(
      "SELECT * FROM notifications WHERE tenant_id = ?"
    )
      .bind(owner.id)
      .all<{ id: string; type: string; key_id: string; message: string }>();

    expect(notifs.results.length).toBe(1);
    expect(notifs.results[0].key_id).toBe(commKey.id);
    expect(notifs.results[0].type).toBe("key_invalid");
    expect(notifs.results[0].message).toContain("went unhealthy");
  });

  it("creates a notification when a key is revoked via abuse report", async () => {
    const user = await createUser({ github: true, eligible: true });
    const privKey = await addProviderKey(user, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_abuse_report_takedown_test_key_0003",
    });

    const reportRes = await SELF.fetch("https://console.test/api/abuse/report-key", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-turnstile-token": "test-turnstile-token",
      },
      body: JSON.stringify({
        leaked_key: "gsk_abuse_report_takedown_test_key_0003",
      }),
    });
    expect(reportRes.status).toBe(200);
    await reportRes.json();

    const notifs = await env.DB.prepare(
      "SELECT * FROM notifications WHERE tenant_id = ?"
    )
      .bind(user.id)
      .all<{ id: string; type: string; key_id: string; message: string }>();

    expect(notifs.results.length).toBe(1);
    expect(notifs.results[0].key_id).toBe(privKey.id);
    expect(notifs.results[0].type).toBe("abuse_takedown");
    expect(notifs.results[0].message).toBe("Your key was revoked after an abuse report");
  });

  it("GET /api/notifications respects tenant isolation and ?since=<ms> filter", async () => {
    const userA = await createUser({ github: true, eligible: true });
    const userB = await createUser({ github: true, eligible: true });
    const sessionA = await createSession(userA);

    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO notifications (id, tenant_id, type, key_id, message, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind("notif_old_a", userA.id, "key_invalid", "key_1", "Old notice A", now - 10_000, null)
      .run();

    await env.DB.prepare(
      "INSERT INTO notifications (id, tenant_id, type, key_id, message, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind("notif_new_a", userA.id, "key_invalid", "key_2", "New notice A", now, null)
      .run();

    await env.DB.prepare(
      "INSERT INTO notifications (id, tenant_id, type, key_id, message, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind("notif_user_b", userB.id, "key_invalid", "key_3", "Notice B", now, null)
      .run();

    // Query without since returns both of User A's notifications and NONE of User B's
    const resAll = await SELF.fetch("https://console.test/api/notifications", {
      headers: { cookie: sessionA.cookie },
    });
    expect(resAll.status).toBe(200);
    const bodyAll = (await resAll.json()) as { notifications: Array<{ id: string }> };
    expect(bodyAll.notifications.map((n) => n.id)).toEqual(["notif_new_a", "notif_old_a"]);

    // Query with since returns only newer notifications
    const resSince = await SELF.fetch(`https://console.test/api/notifications?since=${now - 5_000}`, {
      headers: { cookie: sessionA.cookie },
    });
    expect(resSince.status).toBe(200);
    const bodySince = (await resSince.json()) as { notifications: Array<{ id: string }> };
    expect(bodySince.notifications.map((n) => n.id)).toEqual(["notif_new_a"]);
  });

  it("POST /api/notifications/:id/read marks notification as read", async () => {
    const user = await createUser({ github: true, eligible: true });
    const session = await createSession(user);
    const now = Date.now();

    await env.DB.prepare(
      "INSERT INTO notifications (id, tenant_id, type, key_id, message, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind("notif_to_read", user.id, "key_invalid", "key_x", "Test notice", now, null)
      .run();

    const readRes = await SELF.fetch("https://console.test/api/notifications/notif_to_read/read", {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "x-kc-csrf": session.csrfToken,
      },
    });
    expect(readRes.status).toBe(200);
    const readBody = (await readRes.json()) as { success: boolean; id: string };
    expect(readBody.success).toBe(true);
    expect(readBody.id).toBe("notif_to_read");

    const row = await env.DB.prepare("SELECT read_at FROM notifications WHERE id = ?")
      .bind("notif_to_read")
      .first<{ read_at: number | null }>();
    expect(row?.read_at).toBeGreaterThanOrEqual(now);
  });
});
