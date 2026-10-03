/**
 * Key Collective v2/v4 — Developer Dashboard OAuth & Auth Helpers
 */

import type { WorkerEnv } from "../../auth/index";
import { verifyFirebaseIdToken } from "../../../auth/google/verify_id_token";
import {
  SESSION_COOKIE,
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


  if (env.DB && typeof env.DB.prepare === "function") {
    try {
      // 1. Upsert into users table — tier is only ever set on INSERT, never
      // overwritten by a subsequent sign-in.
      await env.DB.prepare(
        `INSERT INTO users (id, email, tier, role, sybil_score, auth_phase, is_quarantined, created_at)
         VALUES (?, ?, ?, 'user', ?, 3, 0, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           email = excluded.email`
      ).bind(tenantId, email, tier, sybilScore).run();
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
  if (env.DB && typeof env.DB.prepare === "function") {
    try {
      const row = await env.DB.prepare("SELECT tier, registration_status FROM users WHERE id = ?")
        .bind(tenantId)
        .first<{ tier: string; registration_status: string }>();
      if (row?.tier) {
        responseTier = row.tier;
      }
      if (row?.registration_status) {
        registrationStatus = row.registration_status;
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

  // The console authenticates with the session cookie only; sign-in mints no API credential (RA-01).
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  headers.append("Set-Cookie", buildSessionCookie(session.token));
  return new Response(
    JSON.stringify({
      success: true,
      user: {
        id: tenantId,
        email,
        tier: responseTier,
      },
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
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Set-Cookie": buildClearSessionCookie(),
    },
  });
}
