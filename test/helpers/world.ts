import { env } from "cloudflare:test";
import {
  deriveTenantKey,
  encrypt,
  generateNonceB64,
} from "../../src/crypto/encryption";
import { createSession as createStoredSession, type SessionKind } from "../../src/auth/session/store";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    KC_MASTER_KEY?: string;
  }
}

export { generateNonceB64 };

export interface TestUser {
  id: string;
  email: string;
  tier: string;
  role: string;
}

export interface CreateUserOptions {
  tier?: string;
  email?: string;
  role?: string;
  /** Adds a google identity (default true). */
  google?: boolean;
  /** Adds a github identity. */
  github?: boolean;
  /** Sets users.community_eligible. */
  eligible?: boolean;
  registrationStatus?: "PENDING_CONSENT" | "ACTIVE" | "SUSPENDED";
}

export interface CreateSessionOptions {
  kind?: SessionKind;
  ttlSeconds?: number;
}

export interface CreateApiKeyOptions {
  name?: string;
  rpmLimit?: number;
}

export interface AddProviderKeyOptions {
  provider: string;
  pool?: string;
  plaintext: string;
  rpmLimit?: number;
  rpdLimit?: number;
  priority?: number;
}

export interface ProviderKeyRecord {
  id: string;
  tenant_id: string;
  provider: string;
  pool: string;
}

export async function createUser({
  tier = "free",
  email,
  role = "user",
  google = true,
  github = false,
  eligible = false,
  registrationStatus = "ACTIVE",
}: CreateUserOptions = {}): Promise<TestUser> {
  const id = "usr_goog_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const userEmail = email || `${id}@example.test`;
  const statements = [
    env.DB.prepare(
      "INSERT INTO users (id, email, tier, role, registration_status, community_eligible, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
    ).bind(id, userEmail, tier, role, registrationStatus, eligible ? 1 : 0),
  ];
  if (google) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO user_identities (user_id, provider, subject, email) VALUES (?, 'google', ?, ?)"
      ).bind(id, id.slice("usr_goog_".length), userEmail)
    );
  }
  if (github) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO user_identities (user_id, provider, subject, username, email) VALUES (?, 'github', ?, ?, ?)"
      ).bind(id, `gh_${crypto.randomUUID().slice(0, 8)}`, `gh-${id.slice(-6)}`, userEmail)
    );
  }
  await env.DB.batch(statements);
  return { id, email: userEmail, tier, role };
}

/** Creates a live session for the user; `cookie` is ready for a Cookie header. */
export async function createSession(
  user: { id: string },
  { kind = "console", ttlSeconds }: CreateSessionOptions = {}
): Promise<{ token: string; csrfToken: string; cookie: string }> {
  const { token, csrfToken } = await createStoredSession(env.DB, user.id, kind, { ttlSeconds });
  return { token, csrfToken, cookie: `kc_session=${token}` };
}

export async function createApiKey(
  user: { id: string },
  opts: CreateApiKeyOptions = {}
): Promise<string> {
  const plaintext = "kc_live_" + crypto.randomUUID().replace(/-/g, "");
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(plaintext)
  );
  const hash_sha256 = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const tokenId = "tok_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await env.DB.prepare(
    "INSERT INTO auth_tokens (id, hash_sha256, tenant_id, rpm_limit, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)"
  )
    .bind(tokenId, hash_sha256, user.id, opts.rpmLimit || 60)
    .run();
  return plaintext;
}

export async function addProviderKey(
  user: { id: string },
  { provider, pool = "COMMUNITY", plaintext, rpmLimit = 15, rpdLimit = 1500, priority = 0 }: AddProviderKeyOptions
): Promise<ProviderKeyRecord> {
  const masterKey =
    (env as unknown as { KC_MASTER_KEY?: string }).KC_MASTER_KEY ||
    "test-master-key-please-rotate";
  const subkey = await deriveTenantKey(masterKey, user.id);
  const encrypted = await encrypt(plaintext, subkey);
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(plaintext)
  );
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const keyId = "key_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await env.DB.prepare(
    "INSERT INTO api_keys (id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_hash, key_prefix, key_suffix, rpm_limit, rpd_limit, priority, pool_type, status, hkdf_migrated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)"
  )
    .bind(
      keyId,
      user.id,
      `${provider}-key`,
      provider,
      encrypted.ciphertextB64,
      encrypted.nonceB64,
      keyHash,
      plaintext.slice(0, 4),
      plaintext.slice(-4),
      rpmLimit,
      rpdLimit,
      priority,
      pool,
      "HEALTHY"
    )
    .run();
  return { id: keyId, tenant_id: user.id, provider, pool };
}
