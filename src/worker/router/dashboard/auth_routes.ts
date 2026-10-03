/**
 * Key Collective v2/v4 — Developer Dashboard OAuth & Auth Helpers
 */

import type { WorkerEnv } from "../../auth/index";
import { bytesToHex, stringToBytes } from "../../../crypto/utils";
import { verifyFirebaseIdToken } from "../../../auth/google/verify_id_token";
import { isAdminEmail } from "../../gateway/admin_verifier";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  SESSION_COOKIE,
  adminCookieDomain,
  buildAdminSessionCookie,
  buildClearSessionCookie,
  buildPendingCookie,
  buildSessionCookie,
  createPendingToken,
  createSession,
  readCookie,
  revokeSession,
} from "../../../auth/session/store";

interface GoogleAuthBody {
  idToken?: string;
}

export async function handleGoogleAuth(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  let body: GoogleAuthBody = {};

  try {
    body = (await request.json()) as GoogleAuthBody;
  } catch {
    return new Response(JSON.stringify({ error: { message: "Invalid JSON body", code: "BAD_REQUEST", statusCode: 400 } }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const idToken = body.idToken?.trim();
  if (!idToken) {
    return new Response(JSON.stringify({ error: { message: "Missing idToken in payload", code: "BAD_REQUEST", statusCode: 400 } }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  let uid: string;
  let email: string;
  try {
    const payload = await verifyFirebaseIdToken(
      idToken,
      env.FIREBASE_PROJECT_ID || "key-collective-568f8"
    );
    uid = payload.uid;
    email = payload.email;
  } catch {
    return new Response(JSON.stringify({ error: { message: "Invalid or unverified Google identity token", code: "UNAUTHORIZED", statusCode: 401 } }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // Tenant ID is always derived from the verified token subject; any id passed
  // in the request body is ignored to prevent identity spoofing.
  const tenantId = `usr_goog_${uid}`;
  const tier = "builder";
  const sybilScore = 95;
  // QA-15: role follows ADMIN_EMAILS at every sign-in (verifyFirebaseIdToken already
  // requires email_verified). Leaving the list demotes an admin to 'user'.
  const role = isAdminEmail(env, email) ? "admin" : "user";


  if (env.DB && typeof env.DB.prepare === "function") {
    try {
      // 1. Upsert into users table — tier is only ever set on INSERT, never
      // overwritten by a subsequent sign-in. Role is granted or revoked from ADMIN_EMAILS;
      // any other role is left alone.
      await env.DB.prepare(
        `INSERT INTO users (id, email, tier, role, sybil_score, auth_phase, is_quarantined, created_at)
         VALUES (?, ?, ?, ?, ?, 3, 0, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           email = excluded.email,
           role = CASE
             WHEN excluded.role = 'admin' THEN 'admin'
             WHEN users.role = 'admin' THEN 'user'
             ELSE users.role
           END`
      ).bind(tenantId, email, tier, role, sybilScore).run();
      await env.DB.prepare(
        `INSERT INTO user_identities (user_id, provider, subject, email) VALUES (?, 'google', ?, ?)
         ON CONFLICT(provider, subject) DO UPDATE SET email = excluded.email`
      ).bind(tenantId, uid, email).run();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO contributor_standing (tenant_id) VALUES (?)`
      ).bind(tenantId).run();
    } catch (err: unknown) {
      console.error("Failed to persist Google sign-in into D1:", err instanceof Error ? err.message : String(err));
    }
  }

  // 4. Read back the persisted user so the response reflects the actual
  // (possibly pre-existing) tier and registration status.
  let responseTier = tier;
  let registrationStatus = "PENDING_CONSENT";
  let persistedRole = "user";
  if (env.DB && typeof env.DB.prepare === "function") {
    try {
      const row = await env.DB.prepare("SELECT tier, registration_status, role FROM users WHERE id = ?")
        .bind(tenantId)
        .first<{ tier: string; registration_status: string; role: string | null }>();
      if (row?.tier) {
        responseTier = row.tier;
      }
      if (row?.registration_status) {
        registrationStatus = row.registration_status;
      }
      if (row?.role) {
        persistedRole = row.role;
      }
    } catch (err: unknown) {
      console.error("Failed to read user after Google sign-in:", err instanceof Error ? err.message : String(err));
    }
  }

  // 5. Until registration consent (WP-3.2) the user only gets a 15-minute kc_pending cookie.
  if (registrationStatus === "PENDING_CONSENT") {
    const pending = await createPendingToken(String(env.KC_MASTER_KEY ?? ""), tenantId);
    return new Response(JSON.stringify({ next: "consent" }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "Set-Cookie": buildPendingCookie(pending),
      },
    });
  }
  if (registrationStatus !== "ACTIVE" || !env.DB) {
    return new Response(JSON.stringify({ error: { message: "Account is not active", code: "FORBIDDEN", statusCode: 403 } }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const session = await createSession(env.DB, tenantId, "console", {
    ip: request.headers.get("cf-connecting-ip") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  // The bearer token is still minted and returned until the console moves to cookie sessions (WP-3.4).
  const token = `kc_${tier}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const tokenHash = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", stringToBytes(token))));
  await env.DB.prepare(
    `INSERT INTO auth_tokens (id, hash_sha256, tenant_id, budget_cu, spent_cu, allowed_providers, rpm_limit, expires_at, created_at)
     VALUES (?, ?, ?, ?, '0', '[]', ?, null, CURRENT_TIMESTAMP)`
  ).bind(`tok_${crypto.randomUUID().replace(/-/g, "")}`, tokenHash, tenantId, "50000000", 20).run();

  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  headers.append("Set-Cookie", buildSessionCookie(session.token));

  // QA-15 option A: an ADMIN_EMAILS account also gets a separate, short-lived admin session.
  // kc_session stays host-only; kc_admin_session is scoped to the parent of the console and
  // admin hosts so the admin host receives it.
  if (role === "admin" && persistedRole === "admin") {
    const adminSession = await createSession(env.DB, tenantId, "admin", {
      ip: request.headers.get("cf-connecting-ip") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
      ttlSeconds: ADMIN_SESSION_TTL_SECONDS,
    });
    headers.append(
      "Set-Cookie",
      buildAdminSessionCookie(adminSession.token, adminCookieDomain(env.CONSOLE_HOST, env.ADMIN_HOST))
    );
  }
  return new Response(
    JSON.stringify({
      success: true,
      user: {
        id: tenantId,
        email,
        tier: responseTier,
      },
      token,
    }),
    { status: 200, headers }
  );
}

/** POST /api/auth/logout: revokes the session (if any) and clears its cookie. */
export async function handleLogout(request: Request, env: WorkerEnv): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token && env.DB) {
    await revokeSession(env.DB, token);
  }
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  headers.append("Set-Cookie", buildClearSessionCookie());
  const adminToken = readCookie(request, ADMIN_SESSION_COOKIE);
  if (adminToken) {
    if (env.DB) {
      await revokeSession(env.DB, adminToken);
    }
    headers.append(
      "Set-Cookie",
      buildAdminSessionCookie("", adminCookieDomain(env.CONSOLE_HOST, env.ADMIN_HOST), 0)
    );
  }
  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}
