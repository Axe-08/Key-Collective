/**
 * @file admin_host.test.ts
 * T-F.9.2 (QA-15): a browser on admin.* must be able to load the SPA shell and sign in
 * before it holds an admin cookie. Everything under /api/admin/* stays behind the
 * zero-knowledge 404 gate.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { MainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { installGoogleJwks, signGoogleIdToken } from "../../helpers/google_jwt";

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const adminEmail = `admin_${rand()}@example.test`;
const workerEnv = {
  ...env,
  TENANT_QUOTA: undefined,
  ADMIN_EMAILS: adminEmail,
} as unknown as WorkerEnv;
const worker = new MainWorker();

function adminHost(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://admin.test${path}`, init), workerEnv);
}

function signIn(idToken: string): Promise<Response> {
  return adminHost("/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

beforeAll(installGoogleJwks);

describe("T-F.9.2 admin host shell and sign-in", () => {
  it("serves the SPA shell to a visitor without an admin cookie", async () => {
    for (const path of ["/", "/overview"]) {
      const res = await adminHost(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("accepts POST /api/auth/google without an admin cookie and issues kc_admin_session", async () => {
    const sub = `sub_${rand()}`;
    await signIn(await signGoogleIdToken(sub, adminEmail));
    await env.DB.prepare("UPDATE users SET registration_status = 'ACTIVE' WHERE id = ?")
      .bind(`usr_goog_${sub}`)
      .run();

    const res = await signIn(await signGoogleIdToken(sub, adminEmail));

    expect(res.status).toBe(200);
    const adminCookie = res.headers.getSetCookie().find((c) => c.startsWith("kc_admin_session="));
    expect(adminCookie).toBeDefined();
    const token = (adminCookie ?? "").split(";")[0].slice("kc_admin_session=".length);

    const gated = await adminHost("/api/admin/tenants", {
      headers: { cookie: `kc_admin_session=${token}` },
    });
    expect(gated.status).toBe(200);
  });

  it("keeps /api/admin/* and other API paths behind the 404 gate", async () => {
    for (const path of ["/api/admin/tenants", "/api/admin/audit", "/api/keys", "/v1/models"]) {
      const res = await adminHost(path);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
    }
    const post = await adminHost("/api/admin/kill-switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(post.status).toBe(404);
  });
});
