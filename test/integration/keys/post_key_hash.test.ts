/**
 * Key Collective — key_hash write-on-insert & backfill maintenance tests
 *
 * Invariants Tested:
 * 1. POST /api/keys writes a SHA-256 hex `key_hash` for the raw key at insert time.
 * 2. POST /api/admin/maintenance/backfill-key-hash (admin host) requires a break-glass
 *    header matching env.BREAK_GLASS_TOKEN; without it, the route is denied (403) and
 *    no rows are touched.
 * 3. With a valid break-glass header, the maintenance route decrypts existing rows with
 *    NULL key_hash, computes their SHA-256 hex digest, and persists it via UPDATE.
 * 4. Plaintext keys are never present anywhere in the maintenance route's JSON response.
 */

import { describe, expect, it } from "vitest";
import { fetchMock } from "cloudflare:test";
import { mockTurnstile } from "../../helpers/upstream";
import { handlePostKeys } from "../../../src/worker/router/dashboard/keys/post_key";
import { handleAdminRequest } from "../../../src/worker/gateway/admin_handler";
import { deriveTenantKey, encrypt } from "../../../src/crypto/encryption/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import type { RouterHandler } from "../../../src/worker/router/index";

const MASTER_KEY = "test-master-key-for-key-hash-suite";

interface ApiKeyRow {
  id: string;
  tenant_id: string;
  encrypted_key_b64: string;
  nonce_b64: string;
  key_hash: string | null;
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private boundParams: unknown[] = [];

  constructor(
    private readonly query: string,
    private readonly db: MockD1Database
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundParams = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const res = await this.all<T>();
    return (res.results[0] ?? null) as T | null;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  raw<T = unknown[]>(): Promise<T[]> {
    throw new Error("raw not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    // Pool-rights lookups (WP-3.3): an ACTIVE user with a google identity.
    if (this.query.includes("SELECT registration_status, is_quarantined, community_eligible FROM users")) {
      return { results: [{ registration_status: "ACTIVE", is_quarantined: 0, community_eligible: 0 }] as unknown as T[], success: true, meta: { duration: 1 } as D1Response["meta"] };
    }
    if (this.query.includes("SELECT provider FROM user_identities")) {
      return { results: [{ provider: "google" }] as unknown as T[], success: true, meta: { duration: 1 } as D1Response["meta"] };
    }
    const trimmed = this.query.trim();
    const upper = trimmed.toUpperCase().replace(/\s+/g, " ");

    if (upper.startsWith("INSERT INTO API_KEYS")) {
      const [
        id,
        tenant_id,
        _label,
        _provider,
        encrypted_key_b64,
        nonce_b64,
        _key_prefix,
        _key_suffix,
        _rpm_limit,
        _rpd_limit,
        _priority,
        _pool_type,
        _comm_status,
        _obs_until,
        key_hash,
      ] = this.boundParams as string[];
      this.db.keys.push({
        id,
        tenant_id,
        encrypted_key_b64,
        nonce_b64,
        key_hash: key_hash ?? null,
      });
      return { results: [] as unknown as T[], success: true, meta: { duration: 1 } as D1Response["meta"] };
    }

    if (upper.startsWith("INSERT INTO CONSENT_ATTESTATIONS")) {
      return { results: [] as unknown as T[], success: true, meta: { duration: 1 } as D1Response["meta"] };
    }

    if (upper.startsWith("SELECT") && upper.includes("PROJECT_HASH_REGISTRY")) {
      return { results: [] as unknown as T[], success: true, meta: { duration: 1 } as D1Response["meta"] };
    }

    if (upper.startsWith("SELECT") && upper.includes("FROM API_KEYS") && upper.includes("KEY_HASH IS NULL")) {
      const rows = this.db.keys.filter((k) => k.key_hash === null || k.key_hash === undefined);
      return { results: rows as unknown as T[], success: true, meta: { duration: 1 } as D1Response["meta"] };
    }

    if (upper.startsWith("UPDATE API_KEYS SET KEY_HASH")) {
      const [keyHash, id] = this.boundParams as [string, string];
      const row = this.db.keys.find((k) => k.id === id);
      if (row) row.key_hash = keyHash;
      return { results: [] as unknown as T[], success: true, meta: { duration: 1, changes: 1 } as D1Response["meta"] };
    }

    return { results: [] as unknown as T[], success: true, meta: { duration: 1 } as D1Response["meta"] };
  }
}

class MockD1Database implements D1Database {
  public keys: ApiKeyRow[] = [];

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const stmt of statements) {
      results.push(await stmt.run<T>());
    }
    return results;
  }

  async exec(): Promise<D1ExecResult> {
    return { count: 1, duration: 1 };
  }

  withSession(): D1DatabaseSession {
    throw new Error("withSession not implemented in mock");
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}

const noopRouterHandler = { handle: async () => new Response("not used") } as unknown as RouterHandler;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("Write key_hash on insert + backfill maintenance route", () => {
  describe("POST /api/keys writes key_hash at insert", () => {
    it("stores a SHA-256 hex key_hash matching the raw key on insert", async () => {
      const db = new MockD1Database();
      const env: WorkerEnv = { DB: db, KC_MASTER_KEY: MASTER_KEY, TURNSTILE_SECRET: "test-secret" };
      fetchMock.disableNetConnect();
      mockTurnstile(true);

      const rawKey = "gsk_super_secret_raw_key_0001";
      const request = new Request("https://api.keycollective.ai/api/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-turnstile-token": "turnstile-token-verified-by-mocked-siteverify",
        },
        body: JSON.stringify({
          provider: "groq",
          label: "test-key",
          key: rawKey,
          k1: true,
          k2: true,
        }),
      });

      const res = await handlePostKeys(request, env, "tenant-a", MASTER_KEY);
      expect(res.status).toBe(201);

      expect(db.keys.length).toBe(1);
      const inserted = db.keys[0];
      expect(inserted.key_hash).toBeTruthy();

      const expectedHash = await sha256Hex(rawKey);
      expect(inserted.key_hash).toBe(expectedHash);

      // The response body must never contain the raw key or its hash directly.
      const bodyText = await res.text();
      expect(bodyText).not.toContain(rawKey);
    });
  });

  describe("POST /api/admin/maintenance/backfill-key-hash", () => {
    async function seedRowMissingHash(db: MockD1Database, tenantId: string, rawKey: string): Promise<string> {
      const tenantKey = await deriveTenantKey(MASTER_KEY, tenantId);
      const { ciphertextB64, nonceB64 } = await encrypt(rawKey, tenantKey);
      const id = `key_backfill_${tenantId}`;
      db.keys.push({
        id,
        tenant_id: tenantId,
        encrypted_key_b64: ciphertextB64,
        nonce_b64: nonceB64,
        key_hash: null,
      });
      return id;
    }

    it("denies the request when the break-glass header is missing", async () => {
      const db = new MockD1Database();
      await seedRowMissingHash(db, "tenant-a", "sk-plaintext-should-not-leak");
      const env: WorkerEnv = { DB: db, KC_MASTER_KEY: MASTER_KEY, BREAK_GLASS_TOKEN: "correct-break-glass-secret" };

      const request = new Request("https://admin.keycollective.ai/api/admin/maintenance/backfill-key-hash", {
        method: "POST",
      });

      const res = await handleAdminRequest(request, env, noopRouterHandler, {});
      expect(res.status).toBe(403);
      expect(db.keys[0].key_hash).toBeNull();
    });

    it("denies the request when the break-glass header is wrong", async () => {
      const db = new MockD1Database();
      await seedRowMissingHash(db, "tenant-a", "sk-plaintext-should-not-leak");
      const env: WorkerEnv = { DB: db, KC_MASTER_KEY: MASTER_KEY, BREAK_GLASS_TOKEN: "correct-break-glass-secret" };

      const request = new Request("https://admin.keycollective.ai/api/admin/maintenance/backfill-key-hash", {
        method: "POST",
        headers: { "x-break-glass-authorization": "wrong-secret" },
      });

      const res = await handleAdminRequest(request, env, noopRouterHandler, {});
      expect(res.status).toBe(403);
      expect(db.keys[0].key_hash).toBeNull();
    });

    it("backfills key_hash for rows with NULL key_hash given a valid break-glass header, without leaking plaintext", async () => {
      const db = new MockD1Database();
      const rawKeyA = "sk-plaintext-tenant-a-key";
      const rawKeyB = "sk-plaintext-tenant-b-key";
      await seedRowMissingHash(db, "tenant-a", rawKeyA);
      await seedRowMissingHash(db, "tenant-b", rawKeyB);

      const env: WorkerEnv = { DB: db, KC_MASTER_KEY: MASTER_KEY, BREAK_GLASS_TOKEN: "correct-break-glass-secret" };

      const request = new Request("https://admin.keycollective.ai/api/admin/maintenance/backfill-key-hash", {
        method: "POST",
        headers: { "x-break-glass-authorization": "correct-break-glass-secret" },
      });

      const res = await handleAdminRequest(request, env, noopRouterHandler, {});
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; updated: number };
      expect(body.success).toBe(true);
      expect(body.updated).toBe(2);

      const expectedHashA = await sha256Hex(rawKeyA);
      const expectedHashB = await sha256Hex(rawKeyB);
      const rowA = db.keys.find((k) => k.tenant_id === "tenant-a");
      const rowB = db.keys.find((k) => k.tenant_id === "tenant-b");
      expect(rowA?.key_hash).toBe(expectedHashA);
      expect(rowB?.key_hash).toBe(expectedHashB);

      // The maintenance route's response must never contain either plaintext raw key.
      const rawResText = JSON.stringify(body);
      expect(rawResText).not.toContain(rawKeyA);
      expect(rawResText).not.toContain(rawKeyB);
    });
  });
});
