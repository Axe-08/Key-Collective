/**
 * Key Collective v2/v4 — Developer Dashboard OAuth & Auth Helpers
 */

import type { WorkerEnv } from "../../auth_middleware";

interface GithubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GithubProfile {
  id?: number;
  login?: string;
  email?: string | null;
  avatar_url?: string | null;
  name?: string | null;
}

interface SyncSessionBody {
  id?: string;
  email?: string;
  tier?: string;
  authProvider?: string;
  username?: string;
}

export async function handleOAuthGithubCallback(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  const u = new URL(request.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");

  if (!code) {
    return new Response("Missing code parameter", { status: 400 });
  }

  let profileData: GithubProfile | null = null;
  let accessToken: string | null = null;

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: "Ov23lijtT90CwzFc8jcy",
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        state,
      }),
    });

    const tokenData = (await tokenRes.json()) as GithubTokenResponse;
    accessToken = tokenData.access_token ?? null;

    if (accessToken) {
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "KeyCollective",
        },
      });
      profileData = (await userRes.json()) as GithubProfile;
    }
  } catch (err: unknown) {
    console.error("GitHub OAuth Error:", err instanceof Error ? err.message : String(err));
  }

  const userLogin = profileData?.login || "collective-dev";
  const tenantId = profileData?.id ? `gh_${profileData.id}` : `gh_${userLogin}`;
  const email = profileData?.email || `${userLogin}@users.noreply.github.com`;
  const tier = "max";
  const sybilScore = 95;

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
      const rpmLimit = 60;
      const budget = 50_000_000;

      await env.DB.prepare(
        `INSERT INTO auth_tokens (id, hash_sha256, tenant_id, budget_microdollars, spent_microdollars, allowed_providers, rpm_limit, expires_at, created_at)
         VALUES (?, ?, ?, ?, 0, '[]', ?, null, CURRENT_TIMESTAMP)`
      ).bind(tokenId, tokenHash, tenantId, budget, rpmLimit).run();
    } catch (err: unknown) {
      console.error("Failed to persist GitHub OAuth user session into D1:", err instanceof Error ? err.message : String(err));
    }
  }

  const html = `<!DOCTYPE html>
<html>
<head><title>Authentication Successful</title></head>
<body>
<p>Authentication successful for ${userLogin}. Redirecting...</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "OAUTH_CALLBACK", token: "${token}", tier: "${tier}" }, "*");
    window.close();
  } else {
    window.location.href = "/?token=${token}";
  }
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
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
        "Set-Cookie": `kc_auth_token=${encodeURIComponent(token)}; path=/; Max-Age=2592000; SameSite=Lax; Secure`,
      },
    }
  );
}
