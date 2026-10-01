/**
 * Key Collective — pool rights (WP-3.3, section 2.3)
 *
 * privatePool needs a google identity; communityPool also needs a github identity and
 * community_eligible = 1. Inactive or quarantined users get neither.
 */

export interface RightsUserRow {
  registration_status: string;
  is_quarantined: number | boolean | null;
  community_eligible: number;
}

export interface RightsIdentityRow {
  provider: string;
}

export interface PoolRights {
  privatePool: boolean;
  communityPool: boolean;
  reason?: "inactive";
}

export function poolRights(u: RightsUserRow, ids: RightsIdentityRow[]): PoolRights {
  const google = ids.some((i) => i.provider === "google");
  const github = ids.some((i) => i.provider === "github");
  if (u.registration_status !== "ACTIVE" || u.is_quarantined) {
    return { privatePool: false, communityPool: false, reason: "inactive" };
  }
  return { privatePool: google, communityPool: google && github && u.community_eligible === 1 };
}

const RIGHTS_TTL_MS = 60_000;
const cache = new Map<string, { rights: PoolRights; expires: number }>();

/** Loads a user's rights from D1, cached for 60 s per isolate. */
export async function loadPoolRights(db: D1Database, userId: string, nowMs: number = Date.now()): Promise<PoolRights> {
  const hit = cache.get(userId);
  if (hit && hit.expires > nowMs) return hit.rights;
  const row = await db
    .prepare("SELECT registration_status, is_quarantined, community_eligible FROM users WHERE id = ?")
    .bind(userId)
    .first<RightsUserRow>();
  const ids = row
    ? (await db.prepare("SELECT provider FROM user_identities WHERE user_id = ?").bind(userId).all<RightsIdentityRow>()).results
    : [];
  const rights: PoolRights = row
    ? poolRights(row, ids ?? [])
    : { privatePool: false, communityPool: false, reason: "inactive" };
  cache.set(userId, { rights, expires: nowMs + RIGHTS_TTL_MS });
  return rights;
}

/** Drops a cached entry after the user's identities or eligibility change. */
export function invalidatePoolRights(userId: string): void {
  cache.delete(userId);
}

export function githubLinkRequired(): Response {
  return Response.json({ error: "github_link_required" }, { status: 403 });
}
