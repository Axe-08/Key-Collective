/**
 * @file admin_verifier.ts
 * Admin credential verification enforcing zero-knowledge denial invariants.
 */

import { hashToken } from "../../crypto";
import type { WorkerEnv } from "../auth/index";
import type { WorkerOptions } from "./types";

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

  // Support browser address bar navigation via ?token= or ?admin_token= or cookie
  if (!rawToken) {
    try {
      const url = new URL(request.url);
      const queryToken = url.searchParams.get("token") || url.searchParams.get("admin_token");
      if (queryToken && queryToken.trim().length > 0) {
        rawToken = queryToken.trim();
      }
    } catch {
      // ignore url parsing error
    }
  }

  if (!rawToken) {
    const cookieHeader = request.headers.get("cookie") || request.headers.get("Cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)kc_auth_token=([^;]+)/);
      if (match && match[1]) {
        rawToken = decodeURIComponent(match[1].trim());
      }
    }
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
  if (options.adminTokens && options.adminTokens.includes(rawToken)) {
    return true;
  }

  // 3. Env master key or admin token match
  const masterKey = (env.KC_MASTER_KEY ||
    env.MASTER_KEY_PASSPHRASE ||
    env.ADMIN_TOKEN) as string | undefined;
  if (masterKey && rawToken === masterKey) {
    return true;
  }

  // 4. Check D1 Database
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

      if (tokenRow.tenant_id === "admin") {
        return true;
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
          if (userRow.tier === "admin" || userRow.role === "admin") {
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

    // Check users table directly
    try {
      const directUserStmt = db.prepare(
        "SELECT id, email, tier, role, is_quarantined FROM users WHERE id = ?"
      );
      const directUser = await directUserStmt.bind(rawToken).first<{
        id: string;
        email: string | null;
        tier: string | null;
        role: string | null;
        is_quarantined: number | boolean | null;
      }>();

      if (directUser) {
        if (directUser.is_quarantined === 1 || directUser.is_quarantined === true) {
          return false;
        }
        if (directUser.tier === "admin" || directUser.role === "admin") {
          return true;
        }
        if (directUser.email && env.ADMIN_EMAILS) {
          const adminEmails = String(env.ADMIN_EMAILS)
            .split(",")
            .map((e) => e.trim().toLowerCase());
          if (adminEmails.includes(directUser.email.toLowerCase())) {
            return true;
          }
        }
      }
    } catch {
      // Ignore table schema differences
    }

    return false;
  } catch {
    return false;
  }
}
