/**
 * Key Collective — console session store (WP-3.1, T-3.1.2)
 *
 * Invariants Tested:
 * 1. A session token is 32 random bytes in base64url; only its SHA-256 is stored.
 * 2. lookupSession returns active sessions and null for expired, revoked or unknown ones.
 * 3. The CSRF token is stable per session and differs between sessions.
 * 4. The cookie is HttpOnly, Secure, SameSite=Lax, Path=/, 14 days, and has no Domain.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createSession,
  generateSessionToken,
  hashSessionToken,
  lookupSession,
  revokeSession,
} from "../../../src/auth/session/store";
import { base64UrlToUint8Array } from "../../../src/crypto/utils";
import { createUser } from "../../helpers/world";

describe("session store", () => {
  it("generates 32-byte base64url tokens and hashes them with SHA-256", async () => {
    const token = generateSessionToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(base64UrlToUint8Array(token).length).toBe(32);
    expect(generateSessionToken()).not.toBe(token);
    expect(await hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores only the hash of the token, with user, kind and expiry", async () => {
    const user = await createUser();

    const { token, expiresAt } = await createSession(env.DB, user.id, "console", { ip: "1.2.3.4" });

    const row = await env.DB.prepare("SELECT * FROM sessions WHERE user_id = ?")
      .bind(user.id)
      .first<{ id_hash: string; kind: string; expires_at: string; ip_address: string }>();
    expect(row?.id_hash).toBe(await hashSessionToken(token));
    expect(row?.id_hash).not.toContain(token);
    expect(row?.kind).toBe("console");
    expect(row?.ip_address).toBe("1.2.3.4");
    expect(row?.expires_at).toBe(expiresAt);
  });

  it("looks up an active session with its user and a stable CSRF token", async () => {
    const user = await createUser();
    const { token, csrfToken } = await createSession(env.DB, user.id, "console");
    const other = await createSession(env.DB, user.id, "console");

    const session = await lookupSession(env.DB, token);

    expect(session).toMatchObject({ userId: user.id, kind: "console", email: user.email, role: "user", csrfToken });
    expect(other.csrfToken).not.toBe(csrfToken);
  });

  it("returns null for expired, revoked and unknown sessions", async () => {
    const user = await createUser();
    const expired = await createSession(env.DB, user.id, "console", { ttlSeconds: -60 });
    const revoked = await createSession(env.DB, user.id, "console");

    await revokeSession(env.DB, revoked.token);

    expect(await lookupSession(env.DB, expired.token)).toBeNull();
    expect(await lookupSession(env.DB, revoked.token)).toBeNull();
    expect(await lookupSession(env.DB, generateSessionToken())).toBeNull();
    const row = await env.DB.prepare("SELECT revoked_at FROM sessions WHERE id_hash = ?")
      .bind(await hashSessionToken(revoked.token))
      .first<{ revoked_at: string | null }>();
    expect(row?.revoked_at).not.toBeNull();
  });

  it("builds a host-only Lax cookie and a clearing cookie", () => {
    const cookie = buildSessionCookie("abc");

    expect(cookie).toBe("kc_session=abc; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600");
    expect(cookie).not.toMatch(/domain/i);
    expect(buildClearSessionCookie()).toBe("kc_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  });
});
