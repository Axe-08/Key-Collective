/**
 * Key Collective — registration consent C1–C3 (WP-3.2, FR-15, AC-15)
 *
 * POST /api/auth/consent { c1, c2, c3 } with the kc_pending cookie from Google sign-in.
 * All three boxes are required; the attestations and the ACTIVE flip are one D1 batch.
 */

import type { WorkerEnv } from "../worker/auth/index";
import {
  PENDING_COOKIE,
  buildPendingCookie,
  buildSessionCookie,
  createSession,
  readCookie,
  verifyPendingToken,
} from "./session/store";

export const REGISTRATION_CONSENT_VERSION = "v1.0";
const CHECKBOXES = ["C1", "C2", "C3"] as const;

function json(status: number, body: unknown, headers?: Headers): Response {
  const h = headers ?? new Headers();
  h.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export async function handleConsent(request: Request, env: WorkerEnv): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const missing = CHECKBOXES.filter((id) => body[id.toLowerCase()] !== true);
  if (missing.length > 0) {
    return json(422, { error: "consent_required", missing });
  }

  const pending = readCookie(request, PENDING_COOKIE);
  const userId = pending ? await verifyPendingToken(String(env.KC_MASTER_KEY ?? ""), pending) : null;
  if (!userId || !env.DB) {
    return json(401, { error: "consent_required" });
  }

  const ip = request.headers.get("cf-connecting-ip");
  const userAgent = request.headers.get("user-agent");
  const now = Date.now();
  await env.DB.batch([
    ...CHECKBOXES.map((checkbox) =>
      env.DB!.prepare(
        `INSERT INTO consent_attestations (id, tenant_id, event_type, checkbox_id, consent_version, key_id, attested_at, ip_address, user_agent)
         VALUES (?, ?, 'REGISTRATION', ?, ?, NULL, ?, ?, ?)`
      ).bind(crypto.randomUUID(), userId, checkbox, REGISTRATION_CONSENT_VERSION, now, ip, userAgent)
    ),
    env.DB.prepare("UPDATE users SET registration_status = 'ACTIVE' WHERE id = ?").bind(userId),
    env.DB.prepare("INSERT OR IGNORE INTO contributor_standing (tenant_id) VALUES (?)").bind(userId),
  ]);

  const session = await createSession(env.DB, userId, "console", {
    ip: ip ?? undefined,
    userAgent: userAgent ?? undefined,
  });
  const headers = new Headers();
  headers.append("Set-Cookie", buildSessionCookie(session.token));
  headers.append("Set-Cookie", buildPendingCookie("", 0));
  return json(200, { success: true, status: "ACTIVE" }, headers);
}

/** Registration status of a user; null when the tenant has no users row (legacy tenants). */
export async function registrationStatus(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT registration_status FROM users WHERE id = ?")
    .bind(userId)
    .first<{ registration_status: string }>();
  return row?.registration_status ?? null;
}
