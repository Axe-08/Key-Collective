/**
 * @file admin_session.test.ts
 * T-F.9.1 (QA-15 option A): Google sign-in for an ADMIN_EMAILS account issues a
 * separate kc_admin_session, scoped to the parent domain so the admin host receives it.
 *
 * Invariants Tested:
 * 1. A verified ADMIN_EMAILS email (case-insensitive) gets users.role = 'admin', a live
 *    session of kind 'admin', and kc_admin_session (HttpOnly; Secure; SameSite=Strict;
 *    Domain=<parent of console and admin hosts>). kc_session stays host-only.
 * 2. The admin cookie passes the admin host's verifier.
 * 3. A non-admin email gets role 'user' and no admin cookie.
 * 4. An email removed from ADMIN_EMAILS loses role 'admin' at its next sign-in, and its
 *    earlier admin session stops verifying.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { MainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { lookupSession } from "../../../src/auth/session/store";
import { verifyAdminRequest } from "../../../src/worker/gateway/admin_verifier";
import { installGoogleJwks, signGoogleIdToken } from "../../helpers/google_jwt";

const CONSOLE_HOST = "console-dev.key-col.example";
const ADMIN_HOST = "admin-dev.key-col.example";

function envWith(adminEmails: string): WorkerEnv {
  return {
    ...env,
    TENANT_QUOTA: undefined,
    CONSOLE_HOST,
    ADMIN_HOST,
    ADMIN_EMAILS: adminEmails,
  } as unknown as WorkerEnv;
}

const worker = new MainWorker();

function signIn(workerEnv: WorkerEnv, idToken: string): Promise<Response> {
  return worker.fetch(
    new Request(`https://${CONSOLE_HOST}/api/auth/google`, {
      method: "POST",
      headers: { "content-type": "application/json", host: CONSOLE_HOST },
      body: JSON.stringify({ idToken }),
    }),
    workerEnv
  );
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

function cookieNamed(res: Response, name: string): string | undefined {
  return setCookies(res).find((c) => c.startsWith(`${name}=`));
}

function cookieToken(cookie: string | undefined): string {
  return cookie ? cookie.split(";")[0].split("=").slice(1).join("=") : "";
}

async function activeUser(workerEnv: WorkerEnv, sub: string, email: string): Promise<void> {
  await signIn(workerEnv, await signGoogleIdToken(sub, email));
  await env.DB.prepare("UPDATE users SET registration_status = 'ACTIVE' WHERE id = ?")
    .bind(`usr_goog_${sub}`)
    .run();
}

async function roleOf(sub: string): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(`usr_goog_${sub}`)
    .first<{ role: string }>();
  return row?.role;
}

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

beforeAll(installGoogleJwks);

describe("T-F.9.1 admin session at Google sign-in", () => {
  it("issues a parent-domain kc_admin_session for a verified ADMIN_EMAILS account", async () => {
    const sub = `sub_${rand()}`;
    const email = `ops_${rand()}@example.test`;
    const workerEnv = envWith(`someone@else.test, ${email.toUpperCase()}`);
    await activeUser(workerEnv, sub, email);

    const res = await signIn(workerEnv, await signGoogleIdToken(sub, email));

    expect(res.status).toBe(200);
    expect(await roleOf(sub)).toBe("admin");

    const adminCookie = cookieNamed(res, "kc_admin_session");
    expect(adminCookie).toBeDefined();
    expect(adminCookie).toMatch(/; HttpOnly/);
    expect(adminCookie).toMatch(/; Secure/);
    expect(adminCookie).toMatch(/; SameSite=Strict/);
    expect(adminCookie).toMatch(/; Domain=key-col\.example(;|$)/);

    const consoleCookie = cookieNamed(res, "kc_session");
    expect(consoleCookie).toBeDefined();
    expect(consoleCookie).not.toMatch(/domain/i);

    const adminToken = cookieToken(adminCookie);
    expect(adminToken).not.toBe(cookieToken(consoleCookie));
    expect(await lookupSession(env.DB, adminToken)).toMatchObject({
      userId: `usr_goog_${sub}`,
      kind: "admin",
      role: "admin",
    });

    const adminReq = new Request(`https://${ADMIN_HOST}/api/admin/overview`, {
      headers: { cookie: `kc_admin_session=${adminToken}`, host: ADMIN_HOST },
    });
    expect(await verifyAdminRequest(adminReq, workerEnv)).toBe(true);
  });

  it("gives a non-admin account no admin session", async () => {
    const sub = `sub_${rand()}`;
    const email = `user_${rand()}@example.test`;
    const workerEnv = envWith("someone@else.test");
    await activeUser(workerEnv, sub, email);

    const res = await signIn(workerEnv, await signGoogleIdToken(sub, email));

    expect(res.status).toBe(200);
    expect(cookieNamed(res, "kc_session")).toBeDefined();
    expect(cookieNamed(res, "kc_admin_session")).toBeUndefined();
    expect(await roleOf(sub)).toBe("user");
    const adminSessions = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND kind = 'admin'"
    )
      .bind(`usr_goog_${sub}`)
      .first<{ n: number }>();
    expect(adminSessions?.n).toBe(0);
  });

  it("revokes admin at the next sign-in once the email leaves ADMIN_EMAILS", async () => {
    const sub = `sub_${rand()}`;
    const email = `ex_${rand()}@example.test`;
    const asAdmin = envWith(email);
    await activeUser(asAdmin, sub, email);
    const first = await signIn(asAdmin, await signGoogleIdToken(sub, email));
    const oldAdminToken = cookieToken(cookieNamed(first, "kc_admin_session"));
    expect(oldAdminToken).not.toBe("");
    expect(await roleOf(sub)).toBe("admin");

    const removed = envWith("someone@else.test");
    const second = await signIn(removed, await signGoogleIdToken(sub, email));

    expect(second.status).toBe(200);
    expect(cookieNamed(second, "kc_admin_session")).toBeUndefined();
    expect(await roleOf(sub)).toBe("user");
    const adminReq = new Request(`https://${ADMIN_HOST}/api/admin/overview`, {
      headers: { cookie: `kc_admin_session=${oldAdminToken}`, host: ADMIN_HOST },
    });
    // Even if ADMIN_EMAILS were restored, the role is gone until the next sign-in.
    expect(await verifyAdminRequest(adminReq, asAdmin)).toBe(false);
  });
});
