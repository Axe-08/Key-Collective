/**
 * Key Collective — GitHub link flow (WP-3.3, section 2.3 flow 3)
 *
 * GET /api/auth/github/start (signed-in user): state + PKCE verifier (+ the Turnstile token)
 * go into a signed, HttpOnly, 10-minute kc_oauth cookie; redirect to GitHub.
 * GET /api/auth/github/callback: verify the cookie (HMAC-SHA256 with SESSION_SIGNING_KEY),
 * expiry and state; exchange the code; run the Sybil engine; link or refuse; redirect to
 * /settings?github=… — never a token in the URL, never postMessage.
 */

import type { WorkerEnv } from "../../worker/auth/index";
import {
  secureRandomBytes,
  stringToBytes,
  timingSafeEqualStrings,
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
  bytesToString,
} from "../../crypto/utils";
import { SESSION_COOKIE, lookupSession, readCookie } from "../session/store";
import { communityEligible, evaluateAntiSybil } from "../sybil/engine";
import { invalidatePoolRights } from "../rights";

export const OAUTH_COOKIE = "kc_oauth";
export const OAUTH_TTL_MS = 10 * 60 * 1000;
const COOKIE_PATH = "/api/auth/github";

export interface OAuthCookiePayload {
  state: string;
  verifier: string;
  userId: string;
  exp: number;
  turnstile: string;
}

interface GithubUser {
  id: number;
  login: string;
  created_at: string;
  public_repos: number;
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function clearOAuthCookie(): string {
  return `${OAUTH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=0`;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", stringToBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return uint8ArrayToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, stringToBytes(data))));
}

export async function signOAuthCookie(secret: string, payload: OAuthCookiePayload): Promise<string> {
  const body = uint8ArrayToBase64Url(stringToBytes(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

/** The payload of a correctly signed, unexpired cookie; null otherwise. */
export async function verifyOAuthCookie(secret: string, value: string, nowMs: number = Date.now()): Promise<OAuthCookiePayload | null> {
  const [body, sig, extra] = value.split(".");
  if (!body || !sig || extra !== undefined) return null;
  if (!timingSafeEqualStrings(sig, await hmac(secret, body))) return null;
  try {
    const payload = JSON.parse(bytesToString(base64UrlToUint8Array(body))) as OAuthCookiePayload;
    return payload.exp > nowMs ? payload : null;
  } catch {
    return null;
  }
}

async function pkceChallenge(verifier: string): Promise<string> {
  return uint8ArrayToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", stringToBytes(verifier))));
}

function callbackUrl(request: Request): string {
  return `${new URL(request.url).origin}${COOKIE_PATH}/callback`;
}

export async function handleGithubLinkStart(request: Request, env: WorkerEnv): Promise<Response> {
  const secret = env.SESSION_SIGNING_KEY as string | undefined;
  const clientId = env.GITHUB_CLIENT_ID as string | undefined;
  if (!secret || !clientId) return json(503, { error: "github_not_configured" });

  const token = readCookie(request, SESSION_COOKIE);
  const session = token && env.DB ? await lookupSession(env.DB, token) : null;
  if (!session) return json(401, { error: "session_required" });

  const url = new URL(request.url);
  const payload: OAuthCookiePayload = {
    state: uint8ArrayToBase64Url(secureRandomBytes(32)),
    verifier: uint8ArrayToBase64Url(secureRandomBytes(32)),
    userId: session.userId,
    exp: Date.now() + OAUTH_TTL_MS,
    turnstile: url.searchParams.get("turnstile") ?? "",
  };
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", callbackUrl(request));
  authorize.searchParams.set("scope", "read:user user:email");
  authorize.searchParams.set("state", payload.state);
  authorize.searchParams.set("code_challenge", await pkceChallenge(payload.verifier));
  authorize.searchParams.set("code_challenge_method", "S256");

  const cookie = `${OAUTH_COOKIE}=${await signOAuthCookie(secret, payload)}; HttpOnly; Secure; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=${OAUTH_TTL_MS / 1000}`;
  return redirect(authorize.toString(), cookie);
}

async function githubJson<T>(url: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": "key-collective",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${new URL(url).pathname} answered ${res.status}`);
  return (await res.json()) as T;
}

export async function handleGithubLinkCallback(request: Request, env: WorkerEnv): Promise<Response> {
  const secret = env.SESSION_SIGNING_KEY as string | undefined;
  const clientId = env.GITHUB_CLIENT_ID as string | undefined;
  const clientSecret = env.GITHUB_CLIENT_SECRET as string | undefined;
  if (!secret || !clientId || !clientSecret || !env.DB) return json(503, { error: "github_not_configured" });
  const db = env.DB;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const raw = readCookie(request, OAUTH_COOKIE);
  const payload = raw ? await verifyOAuthCookie(secret, raw) : null;
  if (!payload || !code || !timingSafeEqualStrings(state, payload.state)) {
    return json(400, { error: "invalid_oauth_state" });
  }

  let user: GithubUser;
  let emails: GithubEmail[];
  let contributions: number;
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: payload.verifier,
        redirect_uri: callbackUrl(request),
      }),
    });
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
    if (!accessToken) return json(400, { error: "github_code_rejected" });

    user = await githubJson<GithubUser>("https://api.github.com/user", accessToken);
    emails = await githubJson<GithubEmail[]>("https://api.github.com/user/emails", accessToken);
    const graph = await githubJson<{ data?: { viewer?: { contributionsCollection?: { contributionCalendar?: { totalContributions?: number } } } } }>(
      "https://api.github.com/graphql",
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({ query: "{ viewer { contributionsCollection { contributionCalendar { totalContributions } } } }" }),
      }
    );
    contributions = graph.data?.viewer?.contributionsCollection?.contributionCalendar?.totalContributions ?? 0;
  } catch (err: unknown) {
    console.error("GitHub link: upstream call failed:", err instanceof Error ? err.message : String(err));
    return json(502, { error: "github_unavailable" });
  }

  const subject = String(user.id);
  const owner = await db
    .prepare("SELECT user_id FROM user_identities WHERE provider = 'github' AND subject = ?")
    .bind(subject)
    .first<{ user_id: string }>();
  if (owner && owner.user_id !== payload.userId) {
    return json(409, { error: "github_already_linked" });
  }

  const primary = emails.find((e) => e.primary) ?? emails[0];
  const cf = (request as Request & { cf?: { asn?: number } }).cf;
  const assessment = await evaluateAntiSybil(
    {
      turnstileToken: payload.turnstile,
      clientIp: request.headers.get("cf-connecting-ip") ?? "0.0.0.0",
      asn: cf?.asn,
      githubProfile: {
        primaryEmail: primary?.email ?? "",
        isEmailVerified: primary?.verified ?? false,
        createdAt: user.created_at,
        publicRepos: user.public_repos,
        contributionsCount: contributions,
      },
    },
    { turnstileSecret: env.TURNSTILE_SECRET as string | undefined }
  );

  const settings = (result: string) => `${url.origin}/settings?github=${result}`;
  if (!assessment.passed) {
    return redirect(settings("refused"), clearOAuthCookie());
  }

  const eligible = communityEligible(assessment) ? 1 : 0;
  await db.batch([
    db
      .prepare(
        `INSERT INTO user_identities (user_id, provider, subject, username, email, profile_json)
         VALUES (?, 'github', ?, ?, ?, ?)
         ON CONFLICT(provider, subject) DO UPDATE SET username = excluded.username, email = excluded.email, profile_json = excluded.profile_json`
      )
      .bind(
        payload.userId,
        subject,
        user.login,
        primary?.email ?? null,
        JSON.stringify({ created_at: user.created_at, public_repos: user.public_repos, contributions, score: assessment.score })
      ),
    db
      .prepare("UPDATE users SET community_eligible = ?, sybil_score = ?, sybil_assessed_at = datetime('now') WHERE id = ?")
      .bind(eligible, assessment.score, payload.userId),
  ]);
  invalidatePoolRights(payload.userId);
  return redirect(settings("linked"), clearOAuthCookie());
}

