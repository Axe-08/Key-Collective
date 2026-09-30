/**
 * Key Collective v2/v4 — Developer Dashboard OAuth & Auth Helpers
 */

import type { WorkerEnv } from "../../auth/index";
import { verifyFirebaseIdToken } from "../../../auth/google/verify_id_token";

interface GoogleAuthBody {
  idToken?: string;
}

export async function handleOAuthGithubCallback(
  _request?: Request,
  _env?: WorkerEnv
): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: {
        message: "GitHub authentication is disabled until link flow is implemented.",
        code: "GONE",
        statusCode: 410,
      },
    }),
    {
      status: 410,
      headers: { "content-type": "application/json; charset=utf-8" },
    }
  );
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

  let token = `kc_${tier}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  let tokenHash = "";

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

      // 2. Hash token using Web Crypto SHA-256
      const digestBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      tokenHash = Array.from(new Uint8Array(digestBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // 3. Insert auth_token for this tenant
      const tokenId = `tok_${tenantId.slice(0, 12)}_${Date.now().toString(36)}`;
      const rpmLimit = 20;
      const budget = 50_000_000;

      await env.DB.prepare(
        `INSERT INTO auth_tokens (id, hash_sha256, tenant_id, budget_microdollars, spent_microdollars, allowed_providers, rpm_limit, expires_at, created_at)
         VALUES (?, ?, ?, ?, 0, '[]', ?, null, CURRENT_TIMESTAMP)`
      ).bind(tokenId, tokenHash, tenantId, budget, rpmLimit).run();
    } catch (err: unknown) {
      console.error("Failed to persist Google sign-in into D1:", err instanceof Error ? err.message : String(err));
    }
  }

  // 4. Read back the persisted tier so the response reflects the actual
  // (possibly pre-existing) tier rather than assuming this is a new user.
  let responseTier = tier;
  if (env.DB && typeof env.DB.prepare === "function") {
    try {
      const row = await env.DB.prepare("SELECT tier FROM users WHERE id = ?")
        .bind(tenantId)
        .first<{ tier: string }>();
      if (row?.tier) {
        responseTier = row.tier;
      }
    } catch {
      // Keep default tier on lookup failure.
    }
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
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "Set-Cookie": `kc_auth_token=${encodeURIComponent(token)}; path=/; Max-Age=2592000; SameSite=Lax; Secure; HttpOnly`,
      },
    }
  );
}
