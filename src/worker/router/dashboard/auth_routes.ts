/**
 * Key Collective v2/v4 — Developer Dashboard OAuth & Auth Helpers
 */

import type { WorkerEnv } from "../../auth/index";

interface SyncSessionBody {
  id?: string;
  email?: string;
  tier?: string;
  authProvider?: string;
  username?: string;
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

export async function handleSyncSession(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  let body: {
    id?: string;
    email?: string;
    tier?: string;
    authProvider?: string;
    username?: string;
  } = {};

  try {
    body = (await request.json()) as SyncSessionBody;
  } catch {
    return new Response(JSON.stringify({ error: { message: "Invalid JSON body", code: "BAD_REQUEST", statusCode: 400 } }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const tenantId = body.id?.trim();
  if (!tenantId) {
    return new Response(JSON.stringify({ error: { message: "Missing id in payload", code: "BAD_REQUEST", statusCode: 400 } }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const email = body.email?.trim() || `${tenantId}@users.noreply.kc`;
  let tier = body.tier?.trim() || (body.authProvider === "google" ? "builder" : body.authProvider === "github" ? "max" : "demo");
  const authProvider = body.authProvider?.trim() || "github";

  // Tier-escalation guard: prevent unauthorized tier escalation to privileged tiers
  if ((tier === "admin" || tier === "ultra") && authProvider !== "internal") {
    tier = "max";
  }

  const sybilScore = tier === "probationary" ? 35 : tier === "demo" ? 20 : 95;

  let token = `kc_${tier}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  let tokenHash = "";

  if (env.DB && typeof env.DB.prepare === "function") {
    try {
      // 1. Upsert into users table
      await env.DB.prepare(
        `INSERT INTO users (id, email, tier, role, sybil_score, auth_phase, is_quarantined, created_at)
         VALUES (?, ?, ?, 'user', ?, 3, 0, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           email = excluded.email,
           tier = COALESCE(users.tier, excluded.tier)`
      ).bind(tenantId, email, tier, sybilScore).run();

      // 2. Hash token using Web Crypto SHA-256
      const digestBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      tokenHash = Array.from(new Uint8Array(digestBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // 3. Insert or update auth_token for this tenant
      const tokenId = `tok_${tenantId.slice(0, 12)}_${Date.now().toString(36)}`;
      const rpmLimit = tier === "admin" || tier === "ultra" ? 1000 : tier === "max" ? 60 : tier === "builder" ? 20 : 2;
      const budget = tier === "demo" ? 0 : 50_000_000;

      await env.DB.prepare(
        `INSERT INTO auth_tokens (id, hash_sha256, tenant_id, budget_microdollars, spent_microdollars, allowed_providers, rpm_limit, expires_at, created_at)
         VALUES (?, ?, ?, ?, 0, '[]', ?, null, CURRENT_TIMESTAMP)`
      ).bind(tokenId, tokenHash, tenantId, budget, rpmLimit).run();
    } catch (err: unknown) {
      console.error("Failed to persist user session into D1:", err instanceof Error ? err.message : String(err));
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      user: {
        id: tenantId,
        email,
        tier,
        authProvider,
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
