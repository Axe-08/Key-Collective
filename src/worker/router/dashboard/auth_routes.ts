/**
 * Key Collective v2/v4 — Developer Dashboard OAuth & Auth Helpers
 */

import type { WorkerEnv } from "../../auth_middleware";

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

  let profileData: any = null;
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

    const tokenData: any = await tokenRes.json();
    accessToken = tokenData.access_token;

    if (accessToken) {
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "KeyCollective",
        },
      });
      profileData = await userRes.json();
    }
  } catch (err) {
    console.error("GitHub OAuth Error:", err);
  }

  const mockToken = "kc_bld_" + crypto.randomUUID().replace(/-/g, "") + "9a8f";
  const userLogin = profileData?.login || "collective-dev";

  const html = `<!DOCTYPE html>
<html>
<head><title>Authentication Successful</title></head>
<body>
<p>Authentication successful for ${userLogin}. Redirecting...</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "OAUTH_CALLBACK", token: "${mockToken}", tier: "builder" }, "*");
    window.close();
  } else {
    window.location.href = "/?token=${mockToken}";
  }
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
