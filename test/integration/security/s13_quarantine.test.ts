/**
 * Key Collective v4 — S13 Admin Quarantine Row-Clobbering Security Tests
 *
 * Invariants Tested (HIVE task T-0.9.1):
 * 1. Quarantining an existing user only flips is_quarantined/quarantine_reason;
 *    email, tier and role are left untouched (no INSERT OR REPLACE clobbering).
 * 2. Quarantining an unknown tenant id returns 404 tenant_not_found and creates
 *    no row in the users table.
 * 3. Every quarantine mutation writes an admin_audit_logs row.
 * 4. Un-quarantining an existing user succeeds and is also audited.
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

interface UserRow {
  id: string;
  email: string;
  tier: string;
  role: string;
  is_quarantined: number;
  quarantine_reason: string | null;
}

async function seedUser(suffix: string): Promise<UserRow> {
  const id = "usr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const email = `tenant-${suffix}@keycollective.ai`;
  const tier = "pro";
  const role = "user";

  await env.DB.prepare(
    "INSERT INTO users (id, email, tier, role, is_quarantined) VALUES (?, ?, ?, ?, 0)"
  )
    .bind(id, email, tier, role)
    .run();

  return { id, email, tier, role, is_quarantined: 0, quarantine_reason: null };
}

function makeQuarantineRequest(
  targetId: string,
  bodyJson: Record<string, unknown>
): Request {
  return new Request(
    `https://admin.keycollective.ai/api/admin/tenants/${targetId}/quarantine`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyJson),
    }
  );
}

async function fetchUser(id: string): Promise<UserRow | null> {
  return env.DB.prepare(
    "SELECT id, email, tier, role, is_quarantined, quarantine_reason FROM users WHERE id = ?"
  )
    .bind(id)
    .first<UserRow>();
}

async function countAuditLogsForTarget(targetId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM admin_audit_logs WHERE target = ? AND action = 'TENANT_QUARANTINE'"
  )
    .bind(targetId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

describe("S13 Security: Admin Quarantine (no row-clobbering, audited mutations)", () => {
  it("quarantines an existing user without touching email, tier or role, and writes an audit log", async () => {
    const user = await seedUser("existing");

    const req = makeQuarantineRequest(user.id, {
      is_quarantined: true,
      reason: "Sybil violation",
    });
    const res = await handleAdminRequest(req, makeTestEnv(), mockRouterHandler);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean; is_quarantined: boolean };
    expect(data.success).toBe(true);
    expect(data.is_quarantined).toBe(true);

    const row = await fetchUser(user.id);
    expect(row).not.toBeNull();
    expect(row?.email).toBe(user.email);
    expect(row?.tier).toBe(user.tier);
    expect(row?.role).toBe(user.role);
    expect(row?.is_quarantined).toBe(1);

    const auditCount = await countAuditLogsForTarget(user.id);
    expect(auditCount).toBeGreaterThanOrEqual(1);
  });

  it("returns 404 tenant_not_found for an unknown tenant id and creates no user row", async () => {
    const unknownId = "usr_does_not_exist_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

    const req = makeQuarantineRequest(unknownId, {
      is_quarantined: true,
      reason: "Sybil violation",
    });
    const res = await handleAdminRequest(req, makeTestEnv(), mockRouterHandler);
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("tenant_not_found");

    const row = await fetchUser(unknownId);
    expect(row).toBeNull();
  });

  it("un-quarantines an existing user and writes an audit log", async () => {
    const user = await seedUser("unquarantine");
    await env.DB.prepare(
      "UPDATE users SET is_quarantined = 1, quarantine_reason = 'prior violation' WHERE id = ?"
    )
      .bind(user.id)
      .run();

    const req = makeQuarantineRequest(user.id, {
      is_quarantined: false,
      reason: "Appeal approved",
    });
    const res = await handleAdminRequest(req, makeTestEnv(), mockRouterHandler);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean; is_quarantined: boolean };
    expect(data.success).toBe(true);
    expect(data.is_quarantined).toBe(false);

    const row = await fetchUser(user.id);
    expect(row?.is_quarantined).toBe(0);
    expect(row?.email).toBe(user.email);
    expect(row?.tier).toBe(user.tier);
    expect(row?.role).toBe(user.role);

    const auditCount = await countAuditLogsForTarget(user.id);
    expect(auditCount).toBeGreaterThanOrEqual(1);
  });
});
