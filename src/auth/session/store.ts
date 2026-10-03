/**
 * Key Collective — console and admin sessions (WP-3.1)
 *
 * The cookie carries 32 random bytes (base64url); D1 stores only their SHA-256.
 * The CSRF token is derived from the raw session token, so it is stable for the session
 * and cannot be computed from anything stored in D1.
 */

import {
  bytesToHex,
  secureRandomBytes,
  stringToBytes,
  timingSafeEqualStrings,
  uint8ArrayToBase64Url,
} from "../../crypto/utils";

export type SessionKind = "console" | "admin";

export const SESSION_COOKIE = "kc_session";
export const SESSION_TTL_SECONDS = 1209600;

export interface SessionContext {
  userId: string;
  kind: SessionKind;
  expiresAt: string;
  csrfToken: string;
  email: string;
  role: string;
}

interface SessionRow {
  user_id: string;
  kind: SessionKind;
  expires_at: string;
  email: string;
  role: string;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", stringToBytes(input));
  return bytesToHex(new Uint8Array(digest));
}

export function generateSessionToken(): string {
  return uint8ArrayToBase64Url(secureRandomBytes(32));
}

export function hashSessionToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export function generateCsrfToken(sessionToken: string): Promise<string> {
  return sha256Hex(`kc-csrf:${sessionToken}`);
}

export async function createSession(
  db: D1Database,
  userId: string,
  kind: SessionKind,
  meta: { ip?: string; userAgent?: string; ttlSeconds?: number } = {}
): Promise<{ token: string; csrfToken: string; expiresAt: string }> {
  const token = generateSessionToken();
  // Expiry comes from SQLite's clock, the same clock lookupSession compares against.
  const row = await db
    .prepare(
      `INSERT INTO sessions (id_hash, user_id, kind, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, datetime('now', ?), ?, ?) RETURNING expires_at`
    )
    .bind(
      await hashSessionToken(token),
      userId,
      kind,
      `${meta.ttlSeconds ?? SESSION_TTL_SECONDS} seconds`,
      meta.ip ?? null,
      meta.userAgent ?? null
    )
    .first<{ expires_at: string }>();
  const expiresAt = row?.expires_at ?? "";
  return { token, csrfToken: await generateCsrfToken(token), expiresAt };
}

export async function lookupSession(db: D1Database, token: string): Promise<SessionContext | null> {
  const row = await db
    .prepare(
      `SELECT s.user_id, s.kind, s.expires_at, u.email, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now')`
    )
    .bind(await hashSessionToken(token))
    .first<SessionRow>();
  if (!row) return null;
  return {
    userId: row.user_id,
    kind: row.kind,
    expiresAt: row.expires_at,
    csrfToken: await generateCsrfToken(token),
    email: row.email,
    role: row.role,
  };
}

export async function revokeSession(db: D1Database, token: string): Promise<void> {
  await db
    .prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id_hash = ? AND revoked_at IS NULL")
    .bind(await hashSessionToken(token))
    .run();
}

export function buildSessionCookie(token: string, maxAge: number = SESSION_TTL_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function buildClearSessionCookie(): string {
  return buildSessionCookie("", 0);
}

/** The admin host's session cookie (QA-15 option A). Separate from kc_session. */
export const ADMIN_SESSION_COOKIE = "kc_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 43200;

/**
 * The cookie Domain that lets the admin host receive a cookie set on the console host:
 * the longest common parent of both hosts, with at least two labels. Null (host-only)
 * when the hosts share no such parent.
 */
export function adminCookieDomain(consoleHost: unknown, adminHost: unknown): string | null {
  const labels = (h: unknown): string[] =>
    typeof h === "string" ? h.split(":")[0].trim().toLowerCase().split(".").filter((l) => l.length > 0) : [];
  const a = labels(consoleHost);
  const b = labels(adminHost);
  const common: string[] = [];
  while (common.length < a.length && common.length < b.length) {
    const la = a[a.length - 1 - common.length];
    const lb = b[b.length - 1 - common.length];
    if (la !== lb) break;
    common.unshift(la);
  }
  // Both hosts must sit strictly below the parent, and a single label (a TLD) is never a cookie domain.
  if (common.length < 2 || common.length >= a.length || common.length >= b.length) return null;
  return common.join(".");
}

export function buildAdminSessionCookie(
  token: string,
  domain: string | null,
  maxAge: number = ADMIN_SESSION_TTL_SECONDS
): string {
  const domainAttr = domain ? `; Domain=${domain}` : "";
  return `${ADMIN_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}${domainAttr}`;
}

/** Reads a cookie value from a Cookie header; null when absent or empty. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

export const PENDING_COOKIE = "kc_pending";
export const PENDING_TTL_SECONDS = 900;

async function pendingSignature(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    stringToBytes(`kc-pending:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, stringToBytes(payload));
  return uint8ArrayToBase64Url(new Uint8Array(sig));
}

/** A signed, 15-minute token naming a user who still has to give registration consent. */
export async function createPendingToken(secret: string, userId: string, nowMs: number = Date.now()): Promise<string> {
  const payload = `${userId}.${nowMs + PENDING_TTL_SECONDS * 1000}`;
  return `${payload}.${await pendingSignature(secret, payload)}`;
}

/** Returns the user id of a valid, unexpired pending token; null otherwise. */
export async function verifyPendingToken(secret: string, token: string, nowMs: number = Date.now()): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  if (!timingSafeEqualStrings(sig, await pendingSignature(secret, `${userId}.${exp}`))) return null;
  return Number(exp) > nowMs ? userId : null;
}

export function buildPendingCookie(token: string, maxAge: number = PENDING_TTL_SECONDS): string {
  return `${PENDING_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
