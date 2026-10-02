/**
 * @file admin_verifier.ts
 * Admin credential verification enforcing zero-knowledge denial invariants.
 */

import { hashToken } from "../../crypto";
import { timingSafeEqualStrings } from "../../crypto/utils";
import { lookupSession, readCookie } from "../../auth/session/store";
import type { WorkerEnv } from "../auth/index";
import type { WorkerOptions } from "./types";

export const ADMIN_SESSION_COOKIE = "kc_admin_session";

function adminEmails(env: WorkerEnv): string[] {
  return String(env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * An admin session needs all three: a live session of kind 'admin', users.role = 'admin',
 * and the user's email in ADMIN_EMAILS.
 */
async function verifyAdminSession(token: string, env: WorkerEnv): Promise<boolean> {
  const db = (env.DB || env.D1_DB) as D1Database | undefined;
  if (!db) return false;
  try {
    const session = await lookupSession(db, token);
    return (
      session !== null &&
      session.kind === "admin" &&
      session.role === "admin" &&
      adminEmails(env).includes(session.email.toLowerCase())
    );
  } catch {
    return false;
  }
}

/**
 * Verifies whether an incoming request to admin.* originates from an authorized administrator.
 * Enforces zero-knowledge denial: returns boolean without leaking details.
 */
export async function verifyAdminRequest(
  request: Request,
  env: WorkerEnv,
  options: WorkerOptions = {}
): Promise<boolean> {
  let rawToken: string | undefined;

  const authHeader =
    request.headers.get("authorization") ||
    request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    rawToken = authHeader.substring(7).trim();
  }

  // Break-glass admin token: accepted only via the x-kc-admin-token header,
  // and only when the request carries no Origin header (never from a browser).
  const breakGlass =
    request.headers.get("x-kc-admin-token") || request.headers.get("X-Kc-Admin-Token");
  const origin = request.headers.get("origin") || request.headers.get("Origin");
  const adminToken = env.ADMIN_TOKEN as string | undefined;
  if (breakGlass && !origin && adminToken && adminToken.trim().length > 0) {
    if (timingSafeEqualStrings(breakGlass.trim(), adminToken.trim())) {
      return true;
    }
  }

  const adminSession = readCookie(request, ADMIN_SESSION_COOKIE);
  if (adminSession) {
    return verifyAdminSession(adminSession, env);
  }

  if (!rawToken) {
    return false;
  }

  // 1. Custom verifyAdmin hook if provided in options
  if (options.verifyAdmin) {
    try {
      return await options.verifyAdmin(rawToken, request, env);
    } catch {
      return false;
    }
  }

  // 2. Options adminTokens list if provided
  if (options.adminTokens && options.adminTokens.length > 0) {
    for (const adminTok of options.adminTokens) {
      if (timingSafeEqualStrings(rawToken, adminTok)) {
        return true;
      }
    }
  }

  // 3. Check D1 Database
  const db = (env.DB || env.D1_DB) as D1Database | undefined;
  if (!db || typeof db.prepare !== "function") {
    return false;
  }

  try {
    const tokenHash = await hashToken(rawToken);

    // Look up in auth_tokens
    const tokenStmt = db.prepare(
      "SELECT id, tenant_id, expires_at FROM auth_tokens WHERE hash_sha256 = ?"
    );
    const tokenRow = await tokenStmt.bind(tokenHash).first<{
      id: string;
      tenant_id: string;
      expires_at: string | null;
    }>();

    if (tokenRow) {
      if (tokenRow.expires_at) {
        const expiresAtMs = new Date(tokenRow.expires_at).getTime();
        if (Date.now() >= expiresAtMs) {
          return false;
        }
      }

      // Check users table for this tenant
      try {
        const userStmt = db.prepare(
          "SELECT id, email, tier, role, is_quarantined FROM users WHERE id = ?"
        );
        const userRow = await userStmt.bind(tokenRow.tenant_id).first<{
          id: string;
          email: string | null;
          tier: string | null;
          role: string | null;
          is_quarantined: number | boolean | null;
        }>();

        if (userRow) {
          if (userRow.is_quarantined === 1 || userRow.is_quarantined === true) {
            return false;
          }
          if (userRow.role === "admin") {
            return true;
          }
          if (userRow.email && env.ADMIN_EMAILS) {
            const adminEmails = String(env.ADMIN_EMAILS)
              .split(",")
              .map((e) => e.trim().toLowerCase());
            if (adminEmails.includes(userRow.email.toLowerCase())) {
              return true;
            }
          }
        }
      } catch {
        // Ignore table schema differences
      }
    }

    return false;
  } catch {
    return false;
  }
}
