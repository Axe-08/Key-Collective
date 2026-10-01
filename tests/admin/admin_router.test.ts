/**
 * Key Collective — Admin Router & Circuit / Kill Switch Tests (WP-4.6)
 *
 * Replaces the legacy echo tests in tests/admin/admin_router.test.ts (T-04):
 * - Admin authorization via session (kc_admin_session) with role="admin" and email in ADMIN_EMAILS.
 * - Zero-knowledge denial: unauthorized admin requests return 404.
 * - T-4.6.1 Provider override on coordinator & KeyPoolDO, visible in /api/admin/providers:
 *   - Trip groq -> Groq request returns 503 provider_unavailable and upstream mock is not called.
 *   - Reset override -> same request is served again (200).
 * - T-4.6.2 Kill switch (control instance, 10 s cache, 503 maintenance):
 *   - Engaging kill switch -> /v1/chat/completions returns 503 maintenance with Retry-After: 60.
 *   - Console /api/* is unaffected.
 *   - Disarming kill switch -> /v1/chat/completions served again.
 * - T-4.6.3 Audit logs + stored state responses:
 *   - Both write rows to admin_audit_logs and return stored state.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import worker from "../../src/worker/index";
import type { WorkerEnv } from "../../src/worker/auth/types";
import { addProviderKey, createApiKey, createSession, createUser } from "../../test/helpers/world";
import { recordWouldDeny, clearWouldDenyEventsForTest } from "../../src/pool/enforcement";

const ADMIN_EMAIL = "ops-admin@keycollective.test";

let upstreamGroqCalls = 0;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  fetchMock
    .get("https://challenges.cloudflare.com")
    .intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
    .reply(200, JSON.stringify({ success: true }), {
      headers: { "content-type": "application/json" },
    })
    .persist();

  fetchMock
    .get("https://api.groq.com")
    .intercept({ path: /\/openai\/v1\/chat\/completions/, method: "POST" })
    .reply(() => {
      upstreamGroqCalls++;
      return {
        statusCode: 200,
        data: JSON.stringify({
          id: "chatcmpl-groq-mock",
          object: "chat.completion",
          created: 1700000000,
          model: "llama-3.3-70b-versatile",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Groq response" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 15,
            completion_tokens: 10,
            total_tokens: 25,
          },
        }),
      };
    })
    .persist();
});

beforeEach(async () => {
  upstreamGroqCalls = 0;
});

function getAdminEnv(): WorkerEnv {
  return {
    ...(env as unknown as WorkerEnv),
    ADMIN_EMAILS: `someone@else.test, ${ADMIN_EMAIL}`,
  };
}

async function adminRequest(
  path: string,
  options: RequestInit = {},
  cookie?: string
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (cookie) {
    headers.set("cookie", cookie.replace("kc_session=", "kc_admin_session="));
  }
  const req = new Request(`https://admin.test${path}`, {
    ...options,
    headers,
  });
  return worker.fetch(req, getAdminEnv());
}

describe("Admin Gateway & Governance (WP-4.6)", () => {
  describe("Zero-Knowledge Denial", () => {
    it("returns 404 when no session cookie or token is present", async () => {
      const res = await adminRequest("/api/admin/surveillance");
      expect(res.status).toBe(404);
    });

    it("returns 404 for arbitrary bearer token", async () => {
      const req = new Request("https://admin.test/api/admin/surveillance", {
        headers: { authorization: "Bearer bogus-token-123" },
      });
      const res = await worker.fetch(req, getAdminEnv());
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-admin user session", async () => {
      const regularUser = await createUser({ role: "user" });
      const { cookie } = await createSession(regularUser, { kind: "console" });
      const res = await adminRequest("/api/admin/surveillance", {}, cookie);
      expect(res.status).toBe(404);
    });

    it("returns 404 for user with role='admin' but email not in ADMIN_EMAILS", async () => {
      const unlistedAdmin = await createUser({ email: "unlisted@example.com", role: "admin" });
      const { cookie } = await createSession(unlistedAdmin, { kind: "admin" });
      const res = await adminRequest("/api/admin/surveillance", {}, cookie);
      expect(res.status).toBe(404);
    });
  });

  describe("T-4.6.1 Provider Override & /api/admin/providers", () => {
    it("GET /api/admin/providers lists providers and their override status", async () => {
      const adminUser = await createUser({ email: ADMIN_EMAIL, role: "admin" });
      const { cookie } = await createSession(adminUser, { kind: "admin" });

      const res = await adminRequest("/api/admin/providers", { method: "GET" }, cookie);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { providers: Array<{ provider: string; status: string }> };
      expect(data.providers).toBeDefined();
      const groqEntry = data.providers.find((p) => p.provider === "groq");
      expect(groqEntry).toBeDefined();
    });

    it("Trip groq -> Groq request returns 503 provider_unavailable without calling upstream; Reset -> succeeds", async () => {
      const adminUser = await createUser({ email: ADMIN_EMAIL, role: "admin" });
      const { cookie } = await createSession(adminUser, { kind: "admin" });

      // Create a tenant with a Groq key
      const tenant = await createUser({ github: true, eligible: true });
      await addProviderKey(tenant, {
        provider: "groq",
        pool: "COMMUNITY",
        plaintext: "gsk_groq_test_key_001",
      });
      const clientApiKey = await createApiKey(tenant);

      const groqCoordNs = getAdminEnv().POOL_COORDINATOR as unknown as DurableObjectNamespace;
      const groqCoord = groqCoordNs.get(
        groqCoordNs.idFromName("pool:groq")
      ) as unknown as { reconcile(provider: string): Promise<unknown> };
      await groqCoord.reconcile("groq");

      // 1. Trip Groq circuit override via admin endpoint
      const tripRes = await adminRequest(
        "/api/admin/circuit-breaker",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: "groq",
            state: "TRIPPED",
            reason: "Upstream 503 incident",
          }),
        },
        cookie
      );
      expect(tripRes.status).toBe(200);
      const tripBody = (await tripRes.json()) as {
        success: boolean;
        provider: string;
        state: string;
      };
      expect(tripBody.success).toBe(true);
      expect(tripBody.provider).toBe("groq");
      expect(tripBody.state).toBe("TRIPPED");

      // Verify audit log row created
      const tripAudit = await env.DB.prepare(
        "SELECT action, target, details_json FROM admin_audit_logs WHERE target = 'GROQ' ORDER BY created_at DESC LIMIT 1"
      ).first<{ action: string; target: string; details_json: string }>();
      expect(tripAudit?.action).toBe("CIRCUIT_TRIP_OVERRIDE");
      expect(tripAudit?.target).toBe("GROQ");

      // 2. A Groq-only request returns 503 provider_unavailable and upstream mock is NOT called
      const chatReq = new Request("https://api.test/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${clientApiKey}`,
        },
        body: JSON.stringify({
          model: "open-groq",
          messages: [{ role: "user", content: "Hello Groq" }],
        }),
      });

      const chatRes = await worker.fetch(chatReq, getAdminEnv());
      expect(chatRes.status).toBe(503);
      const chatErr = (await chatRes.json()) as { error: { code: string } };
      expect(chatErr.error.code).toBe("provider_unavailable");
      expect(upstreamGroqCalls).toBe(0);

      // 3. Reset Groq circuit override via admin endpoint
      const resetRes = await adminRequest(
        "/api/admin/circuit-breaker",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: "groq",
            state: "NORMAL",
            reason: "Incident resolved",
          }),
        },
        cookie
      );
      expect(resetRes.status).toBe(200);
      const resetBody = (await resetRes.json()) as {
        success: boolean;
        provider: string;
        state: string;
      };
      expect(resetBody.success).toBe(true);
      expect(resetBody.state).toBe("NORMAL");

      // Verify audit log row created
      const resetAudit = await env.DB.prepare(
        "SELECT action, target FROM admin_audit_logs WHERE target = 'GROQ' ORDER BY created_at DESC LIMIT 1"
      ).first<{ action: string; target: string }>();
      expect(resetAudit?.action).toBe("CIRCUIT_RESET_NORMAL");

      // 4. The same request is served again (200) and upstream mock is called
      const chatReq2 = new Request("https://api.test/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${clientApiKey}`,
        },
        body: JSON.stringify({
          model: "open-groq",
          messages: [{ role: "user", content: "Hello Groq again" }],
        }),
      });
      const chatRes2 = await worker.fetch(chatReq2, getAdminEnv());
      expect(chatRes2.status).toBe(200);
      expect(upstreamGroqCalls).toBe(1);
    });
  });

  describe("T-4.6.2 Global Kill Switch (Control DO & Maintenance 503)", () => {
    it("Engaging kill switch -> /v1 returns 503 maintenance with Retry-After: 60; console /api unaffected; Disarm restores", async () => {
      const adminUser = await createUser({ email: ADMIN_EMAIL, role: "admin" });
      const { cookie } = await createSession(adminUser, { kind: "admin" });

      const tenant = await createUser({ github: true, eligible: true });
      await addProviderKey(tenant, {
        provider: "groq",
        pool: "COMMUNITY",
        plaintext: "gsk_groq_kill_switch_key",
      });
      const clientApiKey = await createApiKey(tenant);

      const groqCoordNs = getAdminEnv().POOL_COORDINATOR as unknown as DurableObjectNamespace;
      const groqCoord = groqCoordNs.get(
        groqCoordNs.idFromName("pool:groq")
      ) as unknown as { reconcile(provider: string): Promise<unknown> };
      await groqCoord.reconcile("groq");

      // 1. Engage kill switch
      const engageRes = await adminRequest(
        "/api/admin/kill-switch",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ active: true, reason: "Security drill" }),
        },
        cookie
      );
      expect(engageRes.status).toBe(200);
      const engageBody = (await engageRes.json()) as {
        success: boolean;
        active: boolean;
        reason?: string;
      };
      expect(engageBody.success).toBe(true);
      expect(engageBody.active).toBe(true);
      expect(engageBody.reason).toBe("Security drill");

      // Verify audit log row created
      const engageAudit = await env.DB.prepare(
        "SELECT action, target FROM admin_audit_logs WHERE action = 'GLOBAL_KILL_SWITCH_ENGAGED' ORDER BY created_at DESC LIMIT 1"
      ).first<{ action: string; target: string }>();
      expect(engageAudit?.action).toBe("GLOBAL_KILL_SWITCH_ENGAGED");

      // 2. /v1/chat/completions on api.test returns 503 maintenance with Retry-After: 60
      const apiReq = new Request("https://api.test/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${clientApiKey}`,
        },
        body: JSON.stringify({
          model: "open-groq",
          messages: [{ role: "user", content: "ping" }],
        }),
      });

      const apiRes = await worker.fetch(apiReq, getAdminEnv());
      expect(apiRes.status).toBe(503);
      expect(apiRes.headers.get("retry-after")).toBe("60");
      const apiBody = (await apiRes.json()) as { error: { code: string } };
      expect(apiBody.error.code).toBe("maintenance");

      // 3. Console host /api/* is unaffected
      const consoleSession = await createSession(tenant, { kind: "console" });
      const consoleReq = new Request("https://console.test/api/session", {
        headers: { cookie: consoleSession.cookie },
      });
      const consoleRes = await worker.fetch(consoleReq, getAdminEnv());
      expect(consoleRes.status).toBe(200);

      // 4. Disarm kill switch
      const disarmRes = await adminRequest(
        "/api/admin/kill-switch",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ active: false, reason: "Drill completed" }),
        },
        cookie
      );
      expect(disarmRes.status).toBe(200);
      const disarmBody = (await disarmRes.json()) as {
        success: boolean;
        active: boolean;
      };
      expect(disarmBody.success).toBe(true);
      expect(disarmBody.active).toBe(false);

      // Verify audit log row created
      const disarmAudit = await env.DB.prepare(
        "SELECT action, target FROM admin_audit_logs WHERE action = 'GLOBAL_KILL_SWITCH_DISARMED' ORDER BY created_at DESC LIMIT 1"
      ).first<{ action: string; target: string }>();
      expect(disarmAudit?.action).toBe("GLOBAL_KILL_SWITCH_DISARMED");

      // 5. /v1/chat/completions is served again
      const apiReq2 = new Request("https://api.test/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${clientApiKey}`,
        },
        body: JSON.stringify({
          model: "open-groq",
          messages: [{ role: "user", content: "ping again" }],
        }),
      });
      const apiRes2 = await worker.fetch(apiReq2, getAdminEnv());
      expect(apiRes2.status).toBe(200);
    });
  });

  describe("T-4.6.3 Tenant Governance Mutations", () => {
    it("POST /api/admin/tenants/:id/tier overrides tier and logs audit row", async () => {
      const adminUser = await createUser({ email: ADMIN_EMAIL, role: "admin" });
      const { cookie } = await createSession(adminUser, { kind: "admin" });
      const targetUser = await createUser({ role: "user", tier: "free" });

      const res = await adminRequest(
        `/api/admin/tenants/${targetUser.id}/tier`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ new_tier: "ultra", reason: "Enterprise VIP" }),
        },
        cookie
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        success: boolean;
        target_tenant_id: string;
        target_tenant_tier: string;
      };
      expect(data.success).toBe(true);
      expect(data.target_tenant_id).toBe(targetUser.id);
      expect(data.target_tenant_tier).toBe("ultra");

      const userRow = await env.DB.prepare("SELECT tier FROM users WHERE id = ?")
        .bind(targetUser.id)
        .first<{ tier: string }>();
      expect(userRow?.tier).toBe("ultra");

      const auditRow = await env.DB.prepare(
        "SELECT action, target FROM admin_audit_logs WHERE target = ? ORDER BY created_at DESC LIMIT 1"
      )
        .bind(targetUser.id)
        .first<{ action: string; target: string }>();
      expect(auditRow?.action).toBe("TIER_OVERRIDE");
    });

    it("POST /api/admin/tenants/:id/quarantine toggles quarantine and logs audit row", async () => {
      const adminUser = await createUser({ email: ADMIN_EMAIL, role: "admin" });
      const { cookie } = await createSession(adminUser, { kind: "admin" });
      const targetUser = await createUser({ role: "user" });

      const res = await adminRequest(
        `/api/admin/tenants/${targetUser.id}/quarantine`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ is_quarantined: true, reason: "Sybil violation" }),
        },
        cookie
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        success: boolean;
        target_tenant_id: string;
        is_quarantined: boolean;
      };
      expect(data.success).toBe(true);
      expect(data.target_tenant_id).toBe(targetUser.id);
      expect(data.is_quarantined).toBe(true);

      const userRow = await env.DB.prepare("SELECT is_quarantined FROM users WHERE id = ?")
        .bind(targetUser.id)
        .first<{ is_quarantined: number }>();
      expect(userRow?.is_quarantined).toBe(1);

      const auditRow = await env.DB.prepare(
        "SELECT action, target FROM admin_audit_logs WHERE target = ? ORDER BY created_at DESC LIMIT 1"
      )
        .bind(targetUser.id)
        .first<{ action: string; target: string }>();
      expect(auditRow?.action).toBe("TENANT_QUARANTINE");
    });
  });

  describe("Commons Would-Deny Surveillance (WP-5.1 T-5.1.2)", () => {
    beforeEach(() => {
      clearWouldDenyEventsForTest();
    });

    it("unauthorized request to /api/admin/commons/would-deny returns 404 (zero-knowledge denial)", async () => {
      const res = await adminRequest("/api/admin/commons/would-deny");
      expect(res.status).toBe(404);
    });

    it("authorized admin GET /api/admin/commons/would-deny returns aggregated counts and top tenants", async () => {
      const adminUser = await createUser({ email: ADMIN_EMAIL, role: "admin" });
      const { cookie } = await createSession(adminUser, { kind: "admin" });

      // Record some sample would-deny events
      await recordWouldDeny("brake", "usr_goog_tenant_1", "exceeded 35% pool cu");
      await recordWouldDeny("brake", "usr_goog_tenant_1", "exceeded 35% pool cu");
      await recordWouldDeny("eye_for_eye", "usr_goog_tenant_2", "no active groq key");
      await recordWouldDeny("jail", "usr_goog_tenant_1", "debt ratio > 100%");

      const res = await adminRequest("/api/admin/commons/would-deny?hours=24", { method: "GET" }, cookie);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        status: string;
        period_hours: number;
        rules: Record<string, number>;
        top_tenants: Array<{ tenant_hash: string; count: number; rules: Record<string, number> }>;
        total: number;
      };

      expect(body.status).toBe("success");
      expect(body.period_hours).toBe(24);
      expect(body.rules.brake).toBe(2);
      expect(body.rules.eye_for_eye).toBe(1);
      expect(body.rules.jail).toBe(1);
      expect(body.rules.share_cap).toBe(0);
      expect(body.total).toBe(4);
      expect(body.top_tenants.length).toBeGreaterThanOrEqual(2);
      expect(body.top_tenants[0].count).toBe(3);
    });
  });
});

