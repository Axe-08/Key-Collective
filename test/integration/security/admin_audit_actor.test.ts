/**
 * @file admin_audit_actor.test.ts
 * T-F.9.3 (QA-15): the audit log names the admin who acted. getAdminActor resolves the
 * kc_admin_session cookie through lookupSession (sessions.id_hash), and a client cannot
 * substitute another actor through the request body.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { MainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { createSession, createUser } from "../../helpers/world";

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

describe("T-F.9.3 admin audit actor", () => {
  it("writes admin_audit_logs.admin_user_id and admin_email from the admin session", async () => {
    const email = `audit_${rand()}@example.test`;
    const admin = await createUser({ email, role: "admin" });
    const { token } = await createSession(admin, { kind: "admin" });
    const workerEnv = {
      ...env,
      TENANT_QUOTA: undefined,
      ADMIN_EMAILS: email,
    } as unknown as WorkerEnv;
    const reason = `audit-actor-${rand()}`;

    const res = await new MainWorker().fetch(
      new Request("https://admin.test/api/admin/kill-switch", {
        method: "POST",
        headers: {
          cookie: `kc_admin_session=${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          active: false,
          reason,
          adminUserId: "usr_goog_someone_else",
          adminEmail: "someone@else.test",
        }),
      }),
      workerEnv
    );

    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT admin_user_id, admin_email FROM admin_audit_logs WHERE details_json LIKE ?"
    )
      .bind(`%${reason}%`)
      .first<{ admin_user_id: string | null; admin_email: string }>();
    expect(row).toEqual({ admin_user_id: admin.id, admin_email: email });
  });
});
