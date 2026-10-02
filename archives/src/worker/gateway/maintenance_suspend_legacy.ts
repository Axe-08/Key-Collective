/**
 * @file maintenance_suspend_legacy.ts
 * Archived one-off maintenance route: POST /api/admin/maintenance/suspend-unclaimed-legacy
 * Extracted from src/worker/gateway/admin_handler.ts in WP-7.7 (T-7.7.4).
 */

import type { WorkerEnv } from "../../../src/worker/auth/index";
import type { WorkerOptions } from "../../../src/worker/gateway/types";
import { applyCors } from "../../../src/worker/gateway/subdomain";

export async function handleSuspendUnclaimedLegacy(
  _request: Request,
  env: WorkerEnv,
  options: WorkerOptions = {}
): Promise<Response> {
  const db = (env.DB || env.D1_DB) as D1Database | undefined;
  if (!db || typeof db.prepare !== "function") {
    const res = Response.json(
      { success: false, error: "Database not configured" },
      { status: 500 }
    );
    return options.cors !== false ? applyCors(res) : res;
  }

  const updateUsersRes = await db
    .prepare(
      "UPDATE users SET registration_status = 'SUSPENDED' WHERE (id LIKE 'gh_%' OR id LIKE 'usr_gh_%') AND registration_status = 'ACTIVE'"
    )
    .run();
  const suspendedUsers = updateUsersRes?.meta?.changes ?? 0;

  await db
    .prepare(
      "UPDATE api_keys SET status = 'QUARANTINED', community_routing_status = 'QUARANTINED' WHERE tenant_id IN (SELECT id FROM users WHERE registration_status = 'SUSPENDED' AND (id LIKE 'gh_%' OR id LIKE 'usr_gh_%'))"
    )
    .run();

  const res = Response.json({
    success: true,
    suspended_users: suspendedUsers,
  });
  return options.cors !== false ? applyCors(res) : res;
}
