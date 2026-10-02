/**
 * @file suspend_unclaimed_legacy.test.ts
 * WP-7.2 (T-7.2.2): Integration test for POST /api/admin/maintenance/suspend-unclaimed-legacy.
 * Verifies unclaimed legacy accounts (gh_% / usr_gh_%) are suspended, their keys quarantined
 * so they are never leased, an audit log row is recorded, and a second call changes nothing.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { addProviderKey, createSession, createUser } from "../../helpers/world";

const ADMIN_EMAIL = "ops-maintenance@keycollective.test";

function buildAdminEnv(): WorkerEnv {
  return {
    ...(env as unknown as WorkerEnv),
    ADMIN_EMAILS: ADMIN_EMAIL,
  };
}

async function createAdminSessionCookie(): Promise<string> {
  await env.DB.prepare("DELETE FROM users WHERE email = ?").bind(ADMIN_EMAIL).run();
  const adminUser = await createUser({ email: ADMIN_EMAIL, role: "admin" });
  const { cookie } = await createSession(adminUser, { kind: "admin" });
  return cookie.replace("kc_session=", "kc_admin_session=");
}

describe("WP-7.2 T-7.2.2 — POST /api/admin/maintenance/suspend-unclaimed-legacy", () => {
  it("suspends unclaimed legacy accounts, quarantines their keys, logs audit, and is idempotent on second call", async () => {
    const adminCookie = await createAdminSessionCookie();
    const legacyId = `usr_gh_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
    await env.DB.prepare(
      `INSERT INTO users (id, email, tier, role, registration_status, created_at)
       VALUES (?, ?, 'builder', 'user', 'ACTIVE', CURRENT_TIMESTAMP)`
    )
      .bind(legacyId, `${legacyId}@github.local`)
      .run();

    const legacyKey = await addProviderKey({ id: legacyId }, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_legacy_unclaimed_key_001",
    });

    const coord = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:groq")
    ) as unknown as {
      reconcile(provider?: string): Promise<{ upserted: number; removed: number }>;
      setStatus(keyId: string, status: string): Promise<boolean>;
      lease(req: {
        provider: string;
        model: string;
        borrowerId: string;
        estimatedTokens: number;
      }): Promise<{ keyId: string } | null>;
    };
    await coord.reconcile("groq");
    await coord.setStatus(legacyKey.id, "ACTIVE");

    // 1. Call maintenance endpoint on admin.*
    const firstRes = await defaultMainWorker.fetch(
      new Request("https://admin.test/api/admin/maintenance/suspend-unclaimed-legacy", {
        method: "POST",
        headers: { cookie: adminCookie },
      }),
      buildAdminEnv()
    );
    expect(firstRes.status).toBe(200);
    const firstBody = (await firstRes.json()) as {
      success: boolean;
      suspended_users: number;
    };
    expect(firstBody.success).toBe(true);
    expect(firstBody.suspended_users).toBeGreaterThanOrEqual(1);

    // Verify user status is SUSPENDED and key is QUARANTINED
    const userRow = await env.DB.prepare("SELECT registration_status FROM users WHERE id = ?")
      .bind(legacyId)
      .first<{ registration_status: string }>();
    expect(userRow?.registration_status).toBe("SUSPENDED");

    const keyRow = await env.DB.prepare("SELECT status FROM api_keys WHERE id = ?")
      .bind(legacyKey.id)
      .first<{ status: string }>();
    expect(keyRow?.status).toBe("QUARANTINED");

    // Reconcile coordinator and verify the legacy account's key is never leased
    await coord.reconcile("groq");
    const borrower = await createUser({ github: true, eligible: true });
    const leaseRes = await coord.lease({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      borrowerId: borrower.id,
      estimatedTokens: 100,
    });
    expect(leaseRes?.keyId).not.toBe(legacyKey.id);

    // Verify audit log row was written
    const auditRow = await env.DB.prepare(
      "SELECT action, details_json FROM admin_audit_logs WHERE action = 'SUSPEND_UNCLAIMED_LEGACY' ORDER BY created_at DESC LIMIT 1"
    ).first<{ action: string; details_json: string }>();
    expect(auditRow?.action).toBe("SUSPEND_UNCLAIMED_LEGACY");
    expect(JSON.parse(auditRow?.details_json ?? "{}")).toMatchObject({
      suspended_users: firstBody.suspended_users,
    });

    // 2. Second call changes nothing
    const secondRes = await defaultMainWorker.fetch(
      new Request("https://admin.test/api/admin/maintenance/suspend-unclaimed-legacy", {
        method: "POST",
        headers: { cookie: adminCookie },
      }),
      buildAdminEnv()
    );
    expect(secondRes.status).toBe(200);
    const secondBody = (await secondRes.json()) as {
      success: boolean;
      suspended_users: number;
    };
    expect(secondBody.success).toBe(true);
    expect(secondBody.suspended_users).toBe(0);
  });
});
