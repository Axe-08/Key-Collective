/**
 * Key Collective v4 — S1 Header Impersonation Security Tests
 *
 * Invariants Tested:
 * 1. Strict TypeScript: Zero any.
 * 2. Unauthenticated requests to /api/* rejected with HTTP 401 by default.
 * 3. No credentials + x-tenant-id: admin -> POST /api/admin/pool/manage returns 401 and api_keys unchanged.
 * 4. No credentials + x-tenant-id: usr_goog_victim -> GET /api/keys returns 401.
 * 5. Invalid bearer + GET /api/keys -> 401 (not swallowed).
 * 6. Valid token for tenant A + x-tenant-id: B -> acts as A (header ignored) and returns only A's data.
 * 7. DELETE /api/keys/<B's key> with A's token -> 404 and the row still exists.
 * 8. Allow-list for GET /api/session returns 200 { success: true, user: null } when unauthenticated.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { createUser, createApiKey, addProviderKey } from "../../helpers/world";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    KC_MASTER_KEY?: string;
  }
}

interface KeySummary {
  id: string;
  provider: string;
}

interface SessionResponse {
  success: boolean;
  user: {
    id: string;
    email: string;
  } | null;
}

const testEnv: WorkerEnv = {
  ...env,
  TENANT_QUOTA: undefined,
};

describe("S1 Security: Header Impersonation & Auth Enforcement", () => {
  it("rejects unauthenticated admin pool management request with 401 and preserves keys", async () => {
    const user = await createUser();
    await addProviderKey(user, {
      provider: "google",
      plaintext: "AIzaSy_dummy_key_to_preserve",
    });

    const initialCountRow = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM api_keys"
    ).first<{ count: number }>();
    const initialCount = initialCountRow?.count ?? 0;
    expect(initialCount).toBeGreaterThan(0);

    const req = new Request("https://console.test/api/admin/pool/manage", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "admin",
      },
      body: JSON.stringify({ action: "PURGE_ALL_KEYS" }),
    });

    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(401);

    const finalCountRow = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM api_keys"
    ).first<{ count: number }>();
    expect(finalCountRow?.count).toBe(initialCount);
  });

  it("rejects unauthenticated request to /api/keys with x-tenant-id header with 401", async () => {
    const victim = await createUser();
    await addProviderKey(victim, {
      provider: "groq",
      plaintext: "gsk_victim_secret_key",
    });

    const req = new Request("https://console.test/api/keys", {
      method: "GET",
      headers: {
        "x-tenant-id": victim.id,
      },
    });

    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(401);
  });

  it("rejects request to /api/keys with invalid Bearer token with 401", async () => {
    const req = new Request("https://console.test/api/keys", {
      method: "GET",
      headers: {
        authorization: "Bearer invalid_or_expired_token_xyz",
      },
    });

    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(401);
  });

  it("ignores x-tenant-id header when valid Bearer token for tenant A is provided", async () => {
    const userA = { id: "default" };
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, tier, role, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)"
    )
      .bind(userA.id, "default@example.test", "free", "user")
      .run();

    const tokenA = await createApiKey(userA);
    await addProviderKey(userA, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_tenantA_secret_key",
    });

    const userB = await createUser();
    await addProviderKey(userB, {
      provider: "google",
      pool: "PRIVATE",
      plaintext: "AIzaSy_tenantB_secret_key",
    });

    const req = new Request("https://console.test/api/keys", {
      method: "GET",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "x-tenant-id": userB.id,
      },
    });

    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(200);

    const keys = (await res.json()) as KeySummary[];
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k.provider).toBe("groq");
      expect(k.provider).not.toBe("google");
    }
  });

  it("returns 404 when attempting to delete another tenant's key and preserves the key", async () => {
    const userA = await createUser();
    const tokenA = await createApiKey(userA);

    const userB = await createUser();
    const keyB = await addProviderKey(userB, {
      provider: "google",
      plaintext: "AIzaSy_userB_key_to_protect",
    });

    const req = new Request(`https://console.test/api/keys/${keyB.id}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${tokenA}`,
      },
    });

    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(404);

    const keyBRow = await env.DB.prepare(
      "SELECT id FROM api_keys WHERE id = ?"
    )
      .bind(keyB.id)
      .first<{ id: string }>();
    expect(keyBRow).not.toBeNull();
    expect(keyBRow?.id).toBe(keyB.id);
  });

  it("allows unauthenticated GET /api/session returning user null", async () => {
    const req = new Request("https://console.test/api/session", {
      method: "GET",
    });

    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(200);

    const data = (await res.json()) as SessionResponse;
    expect(data.success).toBe(true);
    expect(data.user).toBeNull();
  });
});
