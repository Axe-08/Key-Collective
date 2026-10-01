import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import {
  createUser,
  createApiKey,
  addProviderKey,
  createSession,
} from "../helpers/world";
import { lookupSession } from "../../src/auth/session/store";
import {
  deriveTenantKey,
  decrypt,
} from "../../src/crypto/encryption";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    KC_MASTER_KEY?: string;
  }
}

interface UserRow {
  id: string;
  email: string;
  tier: string;
  role: string;
  created_at: string;
}

interface AuthTokenRow {
  id: string;
  hash_sha256: string;
  tenant_id: string;
  rpm_limit: number;
  created_at: string;
}

interface ApiKeyRow {
  id: string;
  tenant_id: string;
  label: string;
  provider: string;
  encrypted_key_b64: string;
  nonce_b64: string;
  key_prefix: string;
  key_suffix: string;
  pool_type: string;
  status: string;
  created_at: string;
}

describe("World Test Helper", () => {
  describe("createUser", () => {
    it("creates a users row in D1 with default options", async () => {
      const user = await createUser();

      expect(user.id).toMatch(/^usr_goog_[a-f0-9]{16}$/);
      expect(user.email).toBe(`${user.id}@example.test`);
      expect(user.tier).toBe("free");
      expect(user.role).toBe("user");

      const row = await env.DB.prepare(
        "SELECT id, email, tier, role, created_at FROM users WHERE id = ?"
      )
        .bind(user.id)
        .first<UserRow>();

      expect(row).not.toBeNull();
      expect(row?.id).toBe(user.id);
      expect(row?.email).toBe(user.email);
      expect(row?.tier).toBe("free");
      expect(row?.role).toBe("user");
      expect(row?.created_at).toBeDefined();
    });

    it("creates a users row in D1 with custom tier and email", async () => {
      const customEmail = `custom-${crypto.randomUUID()}@example.org`;
      const user = await createUser({ tier: "pro", email: customEmail });

      expect(user.tier).toBe("pro");
      expect(user.email).toBe(customEmail);

      const row = await env.DB.prepare(
        "SELECT id, email, tier, role FROM users WHERE id = ?"
      )
        .bind(user.id)
        .first<UserRow>();

      expect(row).not.toBeNull();
      expect(row?.email).toBe(customEmail);
      expect(row?.tier).toBe("pro");
      expect(row?.role).toBe("user");
    });
  });

  describe("createApiKey", () => {
    it("creates an auth_tokens row in D1 and returns plaintext token", async () => {
      const user = await createUser();
      const plaintext = await createApiKey(user, { rpmLimit: 120 });

      expect(plaintext).toMatch(/^kc_live_[a-f0-9]{32}$/);

      const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(plaintext)
      );
      const expectedHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const row = await env.DB.prepare(
        "SELECT id, hash_sha256, tenant_id, rpm_limit, created_at FROM auth_tokens WHERE hash_sha256 = ?"
      )
        .bind(expectedHash)
        .first<AuthTokenRow>();

      expect(row).not.toBeNull();
      expect(row?.id).toMatch(/^tok_[a-f0-9]{16}$/);
      expect(row?.tenant_id).toBe(user.id);
      expect(row?.rpm_limit).toBe(120);
      expect(row?.hash_sha256).toBe(expectedHash);
    });

    it("uses default rpmLimit of 60 when none specified", async () => {
      const user = await createUser();
      const plaintext = await createApiKey(user);

      const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(plaintext)
      );
      const expectedHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const row = await env.DB.prepare(
        "SELECT rpm_limit FROM auth_tokens WHERE hash_sha256 = ?"
      )
        .bind(expectedHash)
        .first<AuthTokenRow>();

      expect(row).not.toBeNull();
      expect(row?.rpm_limit).toBe(60);
    });
  });

  describe("addProviderKey", () => {
    it("encrypts with tenant subkey and inserts api_keys row directly via SQL", async () => {
      const user = await createUser();
      const rawSecret = "sk-ant-api03-very-secret-token-key-1234";

      const keyResult = await addProviderKey(user, {
        provider: "anthropic",
        pool: "COMMUNITY",
        plaintext: rawSecret,
      });

      expect(keyResult.id).toMatch(/^key_[a-f0-9]{16}$/);
      expect(keyResult.tenant_id).toBe(user.id);
      expect(keyResult.provider).toBe("anthropic");
      expect(keyResult.pool).toBe("COMMUNITY");

      const row = await env.DB.prepare(
        "SELECT id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_prefix, key_suffix, pool_type, status, created_at FROM api_keys WHERE id = ?"
      )
        .bind(keyResult.id)
        .first<ApiKeyRow>();

      expect(row).not.toBeNull();
      expect(row?.tenant_id).toBe(user.id);
      expect(row?.label).toBe("anthropic-key");
      expect(row?.provider).toBe("anthropic");
      expect(row?.pool_type).toBe("COMMUNITY");
      expect(row?.status).toBe("Healthy");
      expect(row?.key_prefix).toBe(rawSecret.slice(0, 4));
      expect(row?.key_suffix).toBe(rawSecret.slice(-4));

      // Architectural invariant: Plaintext keys must never be stored in persistent storage
      expect(row?.encrypted_key_b64).not.toBe(rawSecret);

      // Verify AES-256-GCM decryption using tenant subkey
      const masterKey =
        (env as unknown as { KC_MASTER_KEY?: string }).KC_MASTER_KEY ||
        "test-master-key-please-rotate";
      const subkey = await deriveTenantKey(masterKey, user.id);
      const decrypted = await decrypt(
        row!.encrypted_key_b64,
        subkey,
        row!.nonce_b64
      );

      expect(decrypted).toBe(rawSecret);
    });

    it("supports custom pool type like PRIVATE", async () => {
      const user = await createUser();
      const rawSecret = "sk-openai-custom-private-key-9876";

      const keyResult = await addProviderKey(user, {
        provider: "openai",
        pool: "PRIVATE",
        plaintext: rawSecret,
      });

      expect(keyResult.pool).toBe("PRIVATE");

      const row = await env.DB.prepare(
        "SELECT pool_type FROM api_keys WHERE id = ?"
      )
        .bind(keyResult.id)
        .first<ApiKeyRow>();

      expect(row?.pool_type).toBe("PRIVATE");
    });
  });
});

describe("World Test Helper: identities and sessions", () => {
  it("creates an ACTIVE user with a google identity by default", async () => {
    const user = await createUser();

    const row = await env.DB.prepare("SELECT registration_status, community_eligible FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ registration_status: string; community_eligible: number }>();
    const ids = await env.DB.prepare("SELECT provider FROM user_identities WHERE user_id = ? ORDER BY provider")
      .bind(user.id)
      .all<{ provider: string }>();
    expect(row).toEqual({ registration_status: "ACTIVE", community_eligible: 0 });
    expect(ids.results.map((r) => r.provider)).toEqual(["google"]);
  });

  it("adds a github identity, eligibility, status and role on request", async () => {
    const user = await createUser({ github: true, eligible: true, registrationStatus: "PENDING_CONSENT", role: "admin" });

    const row = await env.DB.prepare("SELECT registration_status, community_eligible, role FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ registration_status: string; community_eligible: number; role: string }>();
    const ids = await env.DB.prepare("SELECT provider FROM user_identities WHERE user_id = ? ORDER BY provider")
      .bind(user.id)
      .all<{ provider: string }>();
    expect(row).toEqual({ registration_status: "PENDING_CONSENT", community_eligible: 1, role: "admin" });
    expect(ids.results.map((r) => r.provider)).toEqual(["github", "google"]);
    expect(user.role).toBe("admin");
  });

  it("creates a user with no identities when google is false", async () => {
    const user = await createUser({ google: false });

    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?")
      .bind(user.id)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("createSession returns a cookie for a live session of the requested kind", async () => {
    const user = await createUser();

    const { token, csrfToken, cookie } = await createSession(user, { kind: "admin" });

    expect(cookie).toBe(`kc_session=${token}`);
    expect(await lookupSession(env.DB, token)).toMatchObject({ userId: user.id, kind: "admin", csrfToken });
  });
});
