/**
 * Key Collective — Admin Key Pool Mode Security Lockdown Tests (ISSUE-16)
 *
 * Invariants Tested:
 * 1. Admins cannot unilaterally convert a tenant's PRIVATE key to COMMUNITY (403 FORBIDDEN_POOL_CONVERSION).
 * 2. Admins CAN eject a COMMUNITY key to PRIVATE (200 OK), resetting routing status & observation.
 * 3. Administrative ejection generates an admin_audit_logs record (KEY_EJECT_COMMUNITY_TO_PRIVATE).
 * 4. Key not found returns 404 NOT_FOUND.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { handleAdminRequest } from "../../../src/worker/gateway/admin_handler";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import type { RouterHandler } from "../../../src/worker/router/index";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

const mockRouterHandler = {
  handle: async () => new Response("OK"),
} as unknown as RouterHandler;

function makeTestEnv(): WorkerEnv {
  return {
    DB: env.DB,
  } as unknown as WorkerEnv;
}

async function seedKey(poolType: "PRIVATE" | "COMMUNITY"): Promise<{ keyId: string; tenantId: string }> {
  const tenantId = "usr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const keyId = "key_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  await env.DB.prepare(`
    INSERT INTO users (id, email, tier, role, sybil_score, auth_phase, is_quarantined)
    VALUES (?, ?, 'builder', 'user', 100, 3, 0)
  `).bind(tenantId, `${tenantId}@test.local`).run();

  await env.DB.prepare(`
    INSERT INTO api_keys (
      id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_prefix, key_suffix,
      rpm_limit, rpd_limit, priority, status, pool_type, community_routing_status,
      created_at
    ) VALUES (
      ?, ?, 'Test Key', 'google', 'Y2lwaGVy', 'bm9uY2U=', 'AIzaSy', 'xyz',
      30, 1000, 1, 'HEALTHY', ?, ?, ?
    )
  `).bind(
    keyId,
    tenantId,
    poolType,
    poolType === "COMMUNITY" ? "ACTIVE" : null,
    Date.now()
  ).run();

  return { keyId, tenantId };
}

describe("Admin Key Pool Mode Security Lockdown (ISSUE-16)", () => {
  it("forbids an admin from converting a PRIVATE key to COMMUNITY with 403", async () => {
    const { keyId } = await seedKey("PRIVATE");

    const req = new Request(`https://admin.test/api/admin/keys/${keyId}/pool-mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pool_type: "COMMUNITY" }),
    });

    const res = await handleAdminRequest(req, makeTestEnv(), mockRouterHandler);
    expect(res.status).toBe(403);

    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("FORBIDDEN_POOL_CONVERSION");
    expect(body.error?.message).toContain("Only the key owner may consent");

    // Invariant: D1 row remains PRIVATE
    const row = await env.DB.prepare("SELECT pool_type FROM api_keys WHERE id = ?").bind(keyId).first<{ pool_type: string }>();
    expect(row?.pool_type).toBe("PRIVATE");
  });

  it("permits an admin to eject a COMMUNITY key to PRIVATE and logs audit trail", async () => {
    const { keyId } = await seedKey("COMMUNITY");

    const req = new Request(`https://admin.test/api/admin/keys/${keyId}/pool-mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pool_type: "PRIVATE" }),
    });

    const res = await handleAdminRequest(req, makeTestEnv(), mockRouterHandler);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { success: boolean; pool_type: string };
    expect(body.success).toBe(true);
    expect(body.pool_type).toBe("PRIVATE");

    // Invariant: D1 row updated to PRIVATE and routing status cleared
    const row = await env.DB.prepare(
      "SELECT pool_type, community_routing_status, observation_until FROM api_keys WHERE id = ?"
    ).bind(keyId).first<{ pool_type: string; community_routing_status: unknown; observation_until: unknown }>();

    expect(row?.pool_type).toBe("PRIVATE");
    expect(row?.community_routing_status).toBeNull();
    expect(row?.observation_until).toBeNull();

    // Audit log written
    const audit = await env.DB.prepare(
      "SELECT action, target, details_json FROM admin_audit_logs WHERE target = ? ORDER BY created_at DESC"
    ).bind(keyId).first<{ action: string; target: string; details_json: string }>();

    expect(audit?.action).toBe("KEY_EJECT_COMMUNITY_TO_PRIVATE");
    expect(audit?.target).toBe(keyId);
    expect(audit?.details_json).toContain("Administrative ejection");
  });

  it("returns 404 if key does not exist", async () => {
    const req = new Request("https://admin.test/api/admin/keys/nonexistent-key/pool-mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pool_type: "PRIVATE" }),
    });

    const res = await handleAdminRequest(req, makeTestEnv(), mockRouterHandler);
    expect(res.status).toBe(404);
  });
});
