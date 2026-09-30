/**
 * Key Collective — Schema Conformance Test Suite (WP-2.6 / T-2.6.4)
 *
 * Verifies:
 * 1. Every ApiKeyRepository method runs against the migrated D1 database (env.DB)
 *    without SQLite exceptions and produces the expected rows/results.
 * 2. Every SQL-writing handler (handlePostKeys, handleDeleteKey, handlePoolMode,
 *    handleRotateKeySecret, and admin routing-status updates) runs against env.DB,
 *    updating consent_attestations, project_hash_registry, and api_keys rows cleanly.
 * 3. KeyPoolDO loads and serves a 'HEALTHY' key from the migrated D1 database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { mockTurnstile } from "../helpers/upstream";
import { ApiKeyRepository } from "../../src/storage/repositories/api_keys/repository";
import { handlePostKeys } from "../../src/worker/router/dashboard/keys/post_key";
import {
  handleDeleteKey,
  handlePoolMode,
  handleRotateKeySecret,
} from "../../src/worker/router/dashboard/keys/ops";
import { handleAdminRequest } from "../../src/worker/gateway/admin_handler";
import { deriveTenantKey, encrypt } from "../../src/crypto/encryption/index";
import type { KeyStatus } from "../../src/types/models";
import type { WorkerEnv } from "../../src/worker/auth/index";
import type { RouterHandler } from "../../src/worker/router/index";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    KEY_POOL: DurableObjectNamespace;
    KC_MASTER_KEY: string;
    TURNSTILE_SECRET: string;
  }
}

const MASTER_KEY = "test-master-key-schema-conformance-32b!";
const dummyRouterHandler = { handle: async () => new Response("ok") } as unknown as RouterHandler;

describe("Schema Conformance Suite (Section 2.5)", () => {
  beforeEach(async () => {
    // Clean up test tables between runs
    await env.DB.prepare("DELETE FROM consent_attestations").run();
    await env.DB.prepare("DELETE FROM project_hash_registry").run();
    await env.DB.prepare("DELETE FROM api_keys").run();
  });

  describe("ApiKeyRepository D1 Conformance", () => {
    const tenantId = "tenant-repo-conformance";
    let repo: ApiKeyRepository;

    beforeEach(() => {
      repo = new ApiKeyRepository(env.DB, MASTER_KEY);
    });

    it("exercises create, getById, getByIdOrThrow, listByTenant, countByTenant, update, updateStatus, recordUsage, getActiveKeysForProvider, and delete", async () => {
      // 1. create
      const created = await repo.create({
        tenantId,
        label: "Primary Google Key",
        provider: "google",
        plaintextKey: "sk-google-plaintext-conformance-123456",
        rpmLimit: 60,
        rpdLimit: 1500,
        priority: 10,
        status: "HEALTHY" as KeyStatus,
      });

      expect(created.id).toBeDefined();
      expect(created.tenantId).toBe(tenantId);
      expect(created.provider).toBe("google");
      expect(created.status).toBe("HEALTHY");

      // Verify row in D1 directly
      const d1Row = await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?")
        .bind(created.id)
        .first<Record<string, unknown>>();
      expect(d1Row).not.toBeNull();
      expect(d1Row?.status).toBe("HEALTHY");
      expect(d1Row?.pool_type).toBe("PRIVATE");
      expect(typeof d1Row?.created_at).toBe("number");

      // 2. getById
      const fetched = await repo.getById(created.id, tenantId);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.status).toBe("HEALTHY");

      // 3. getByIdOrThrow
      const fetchedThrow = await repo.getByIdOrThrow(created.id, tenantId);
      expect(fetchedThrow.id).toBe(created.id);

      // 4. insertEncryptedKey
      const tenantKey = await deriveTenantKey(MASTER_KEY, tenantId);
      const { ciphertextB64, nonceB64 } = await encrypt("sk-groq-pre-encrypted-secret", tenantKey);
      const preEncId = crypto.randomUUID();
      const insertedEnc = await repo.insertEncryptedKey({
        id: preEncId,
        tenantId,
        label: "Groq Pre-Encrypted Key",
        provider: "groq",
        encryptedKeyB64: ciphertextB64,
        nonceB64,
        keyPrefix: "sk-groq",
        keySuffix: "cret",
        rpmLimit: 30,
        rpdLimit: 1000,
        priority: 5,
        status: "HEALTHY" as KeyStatus,
      });
      expect(insertedEnc.id).toBe(preEncId);

      // 5. listByTenant
      const allKeys = await repo.listByTenant(tenantId);
      expect(allKeys.length).toBe(2);

      const groqKeys = await repo.listByTenant(tenantId, { provider: "groq" });
      expect(groqKeys.length).toBe(1);
      expect(groqKeys[0].id).toBe(preEncId);

      // 6. countByTenant
      const count = await repo.countByTenant(tenantId);
      expect(count).toBe(2);

      const countGroq = await repo.countByTenant(tenantId, { provider: "groq" });
      expect(countGroq).toBe(1);

      // 7. getActiveKeysForProvider
      const activeGoogle = await repo.getActiveKeysForProvider(tenantId, "google");
      expect(activeGoogle.length).toBe(1);
      expect(activeGoogle[0].id).toBe(created.id);

      // 8. update
      const updated = await repo.update(created.id, tenantId, {
        label: "Updated Label",
        rpmLimit: 100,
        priority: 20,
      });
      expect(updated.label).toBe("Updated Label");
      expect(updated.rpmLimit).toBe(100);
      expect(updated.priority).toBe(20);

      // Verify update in D1
      const updatedD1 = await env.DB.prepare("SELECT label, rpm_limit, priority FROM api_keys WHERE id = ?")
        .bind(created.id)
        .first<{ label: string; rpm_limit: number; priority: number }>();
      expect(updatedD1?.label).toBe("Updated Label");
      expect(updatedD1?.rpm_limit).toBe(100);
      expect(updatedD1?.priority).toBe(20);

      // 9. updateStatus
      await repo.updateStatus(created.id, tenantId, "QUARANTINED" as KeyStatus);
      const statusD1 = await env.DB.prepare("SELECT status FROM api_keys WHERE id = ?")
        .bind(created.id)
        .first<{ status: string }>();
      expect(statusD1?.status).toBe("QUARANTINED");

      // 10. recordUsage
      const beforeUsage = Date.now();
      await repo.recordUsage(created.id, tenantId);
      const usageD1 = await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?")
        .bind(created.id)
        .first<{ last_used_at: number }>();
      expect(typeof usageD1?.last_used_at).toBe("number");
      expect(usageD1?.last_used_at).toBeGreaterThanOrEqual(beforeUsage);

      // 11. delete
      const deleted = await repo.delete(created.id, tenantId);
      expect(deleted).toBe(true);

      const remainingD1 = await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?")
        .bind(created.id)
        .first();
      expect(remainingD1).toBeNull();
    });
  });

  describe("SQL-Writing Handlers Conformance", () => {
    const tenantId = "usr_gh_conformance_tester";
    let workerEnv: WorkerEnv;

    beforeEach(() => {
      fetchMock.disableNetConnect();
      mockTurnstile(true);

      // DB-focused worker env without KEY_POOL stub to test direct SQL queries without DO side-effects
      workerEnv = {
        DB: env.DB,
        KC_MASTER_KEY: MASTER_KEY,
        TURNSTILE_SECRET: "test-secret",
      };
    });

    it("handlePostKeys writes rows to consent_attestations, project_hash_registry, and api_keys", async () => {
      // Mock Google model query probe so project extraction succeeds
      fetchMock
        .get("https://generativelanguage.googleapis.com")
        .intercept({ path: /^\/v1beta\/models\/invalid-model/ })
        .reply(400, {
          error: {
            code: 400,
            message: "API key not valid",
            status: "INVALID_ARGUMENT",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "API_KEY_INVALID",
                domain: "googleapis.com",
                metadata: {
                  consumer: "projects/conformance-gcp-project-9876",
                  service: "generativelanguage.googleapis.com",
                },
              },
            ],
          },
        });

      const rawKey = "AIzaSyConformanceTestKey987654321";
      const request = new Request("https://api.test/api/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-turnstile-token": "valid-token",
          "cf-connecting-ip": "198.51.100.42",
          "user-agent": "ConformanceTestSuite/1.0",
        },
        body: JSON.stringify({
          provider: "google",
          label: "Conformance Community Key",
          key: rawKey,
          k1: true,
          k2: true,
          pool_type: "COMMUNITY",
        }),
      });

      const res = await handlePostKeys(request, workerEnv, tenantId, MASTER_KEY);
      expect(res.status).toBe(201);
      const resBody = (await res.json()) as { id: string; provider: string; status: string };
      expect(resBody.id).toBeTruthy();
      expect(resBody.provider).toBe("google");

      // Verify api_keys row
      const keyRow = await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?")
        .bind(resBody.id)
        .first<{
          id: string;
          tenant_id: string;
          status: string;
          pool_type: string;
          community_routing_status: string;
          key_hash: string;
          created_at: number;
        }>();
      expect(keyRow).not.toBeNull();
      expect(keyRow?.tenant_id).toBe(tenantId);
      expect(keyRow?.status).toBe("HEALTHY");
      expect(keyRow?.pool_type).toBe("COMMUNITY");
      expect(keyRow?.community_routing_status).toBe("OBSERVATION");
      expect(keyRow?.key_hash).toBeTruthy();
      expect(typeof keyRow?.created_at).toBe("number");

      // Verify consent_attestations rows (K1 and K2)
      const consentRows = await env.DB.prepare(
        "SELECT checkbox_id, event_type, tenant_id, ip_address, user_agent FROM consent_attestations WHERE key_id = ? ORDER BY checkbox_id ASC"
      )
        .bind(resBody.id)
        .all<{
          checkbox_id: string;
          event_type: string;
          tenant_id: string;
          ip_address: string;
          user_agent: string;
        }>();
      expect(consentRows.results.length).toBe(2);
      expect(consentRows.results[0].checkbox_id).toBe("K1");
      expect(consentRows.results[1].checkbox_id).toBe("K2");
      expect(consentRows.results[0].event_type).toBe("KEY_SUBMISSION");
      expect(consentRows.results[0].tenant_id).toBe(tenantId);
      expect(consentRows.results[0].ip_address).toBe("198.51.100.42");
      expect(consentRows.results[0].user_agent).toBe("ConformanceTestSuite/1.0");

      // Verify project_hash_registry row
      const projRegistryRows = await env.DB.prepare(
        "SELECT project_hash, provider, state, tenant_id FROM project_hash_registry WHERE tenant_id = ?"
      )
        .bind(tenantId)
        .all<{ project_hash: string; provider: string; state: string; tenant_id: string }>();
      expect(projRegistryRows.results.length).toBe(1);
      expect(projRegistryRows.results[0].provider).toBe("google");
      expect(projRegistryRows.results[0].state).toBe("ACTIVE");
      expect(projRegistryRows.results[0].tenant_id).toBe(tenantId);
    });

    it("handleDeleteKey removes key from api_keys", async () => {
      const keyId = "key_to_delete_conformance";
      await env.DB.prepare(`
        INSERT INTO api_keys (
          id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
          key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
          pool_type, created_at
        ) VALUES (?, ?, 'To Delete', 'groq', 'Y2lwaGVy', 'bm9uY2U=', 'gsk_1234', '5678', 30, 1000, 1, 'HEALTHY', 'PRIVATE', ?)
      `).bind(keyId, tenantId, Date.now()).run();

      const deleteRes = await handleDeleteKey(`/api/keys/${keyId}`, workerEnv, tenantId);
      expect(deleteRes.status).toBe(200);

      const checkRow = await env.DB.prepare("SELECT id FROM api_keys WHERE id = ?")
        .bind(keyId)
        .first();
      expect(checkRow).toBeNull();
    });

    it("handlePoolMode toggles pool_type and routing status in api_keys", async () => {
      const keyId = "key_pool_mode_toggle";
      await env.DB.prepare(`
        INSERT INTO api_keys (
          id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
          key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
          pool_type, created_at
        ) VALUES (?, ?, 'Pool Toggle', 'groq', 'Y2lwaGVy', 'bm9uY2U=', 'gsk_1234', '5678', 30, 1000, 1, 'HEALTHY', 'PRIVATE', ?)
      `).bind(keyId, tenantId, Date.now()).run();

      // Ensure system time is not within freeze window (23:30 - 00:30 UTC)
      vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));

      const request = new Request(`https://api.test/api/keys/${keyId}/pool-mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pool_type: "COMMUNITY" }),
      });

      const res = await handlePoolMode(`/api/keys/${keyId}/pool-mode`, request, workerEnv, tenantId);
      expect(res.status).toBe(200);

      const updatedRow = await env.DB.prepare(
        "SELECT pool_type, community_routing_status, observation_until FROM api_keys WHERE id = ?"
      )
        .bind(keyId)
        .first<{
          pool_type: string;
          community_routing_status: string;
          observation_until: number;
        }>();
      expect(updatedRow?.pool_type).toBe("COMMUNITY");
      expect(updatedRow?.community_routing_status).toBe("OBSERVATION");
      expect(typeof updatedRow?.observation_until).toBe("number");

      vi.useRealTimers();
    });

    it("handleRotateKeySecret updates ciphertext, nonce, and masked prefix/suffix in api_keys", async () => {
      const keyId = "key_rotate_conformance";
      await env.DB.prepare(`
        INSERT INTO api_keys (
          id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
          key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
          pool_type, created_at
        ) VALUES (?, ?, 'To Rotate', 'groq', 'Y2lwaGVy', 'bm9uY2U=', 'gsk_old_', 'old_', 30, 1000, 1, 'HEALTHY', 'PRIVATE', ?)
      `).bind(keyId, tenantId, Date.now()).run();

      const newKey = "gsk_fresh_secret_rotated_key_9999";
      const request = new Request(`https://api.test/api/keys/${keyId}/rotate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ new_key: newKey }),
      });

      const res = await handleRotateKeySecret(
        `/api/keys/${keyId}/rotate`,
        request,
        workerEnv,
        tenantId,
        MASTER_KEY
      );
      expect(res.status).toBe(200);

      const rotatedRow = await env.DB.prepare(
        "SELECT encrypted_key_b64, nonce_b64, key_prefix, key_suffix FROM api_keys WHERE id = ?"
      )
        .bind(keyId)
        .first<{
          encrypted_key_b64: string;
          nonce_b64: string;
          key_prefix: string;
          key_suffix: string;
        }>();
      expect(rotatedRow).not.toBeNull();
      expect(rotatedRow?.encrypted_key_b64).not.toBe("Y2lwaGVy");
      expect(rotatedRow?.nonce_b64).not.toBe("bm9uY2U=");
      expect(rotatedRow?.key_prefix).toBe(newKey.slice(0, 8));
      expect(rotatedRow?.key_suffix).toBe(newKey.slice(-4));
    });

    it("admin key routing status updates update status and community_routing_status in api_keys", async () => {
      const keyId = "key_admin_status_update";
      await env.DB.prepare(`
        INSERT INTO api_keys (
          id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
          key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
          pool_type, community_routing_status, created_at
        ) VALUES (?, ?, 'Admin Status Key', 'groq', 'Y2lwaGVy', 'bm9uY2U=', 'gsk_1234', '5678', 30, 1000, 1, 'HEALTHY', 'COMMUNITY', 'OBSERVATION', ?)
      `).bind(keyId, tenantId, Date.now()).run();

      // Override to ACTIVE
      const activeReq = new Request(`https://admin.test/api/admin/keys/${keyId}/routing-status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE", reason: "Manual approval" }),
      });
      const activeRes = await handleAdminRequest(activeReq, workerEnv, dummyRouterHandler);
      expect(activeRes.status).toBe(200);

      const activeRow = await env.DB.prepare(
        "SELECT status, community_routing_status, observation_until FROM api_keys WHERE id = ?"
      )
        .bind(keyId)
        .first<{ status: string; community_routing_status: string; observation_until: unknown }>();
      expect(activeRow?.status).toBe("HEALTHY");
      expect(activeRow?.community_routing_status).toBe("ACTIVE");
      expect(activeRow?.observation_until).toBeNull();

      // Override to QUARANTINED
      const quarantineReq = new Request(`https://admin.test/api/admin/keys/${keyId}/routing-status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "QUARANTINED", reason: "Suspected leak" }),
      });
      const quarantineRes = await handleAdminRequest(quarantineReq, workerEnv, dummyRouterHandler);
      expect(quarantineRes.status).toBe(200);

      const quarantinedRow = await env.DB.prepare(
        "SELECT status, community_routing_status FROM api_keys WHERE id = ?"
      )
        .bind(keyId)
        .first<{ status: string; community_routing_status: string }>();
      expect(quarantinedRow?.status).toBe("QUARANTINED");
      expect(quarantinedRow?.community_routing_status).toBe("QUARANTINED");
    });
  });

  describe("KeyPoolDO Healthy Key Serving (Real DO + D1)", () => {
    it("loads and serves a HEALTHY key from D1 in a lease/get request", async () => {
      const doTenantId = "tenant-keypool-healthy-serving";
      const tenantKey = await deriveTenantKey(MASTER_KEY, doTenantId);
      const rawSecret = "gsk_healthy_serving_secret_key_123456";
      const { ciphertextB64, nonceB64 } = await encrypt(rawSecret, tenantKey);
      const keyId = "key_healthy_do_test_001";

      // Seed a key with canonical status 'HEALTHY' in D1
      await env.DB.prepare(`
        INSERT INTO api_keys (
          id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
          key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
          pool_type, dispatched_today, dispatched_communal, created_at
        ) VALUES (?, ?, 'Healthy Groq Key', 'groq', ?, ?, 'gsk_heal', '3456', 60, 1500, 10, 'HEALTHY', 'PRIVATE', 0, 0, ?)
      `).bind(
        keyId,
        doTenantId,
        ciphertextB64,
        nonceB64,
        Date.now()
      ).run();

      // Fetch KeyPoolDO stub via env.KEY_POOL.get(env.KEY_POOL.idFromName(tenantId))
      const doId = env.KEY_POOL.idFromName(doTenantId);
      const stub = env.KEY_POOL.get(doId);

      // Settle DO instance
      const settleRes = await stub.fetch("https://do.test/__test__/clock", {
        headers: { "x-tenant-id": doTenantId },
      });
      await settleRes.text();

      // Verify KeyPoolDO serves the healthy key in a get request
      const getRes = await stub.fetch("http://key-pool/keys/get", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": doTenantId,
        },
        body: JSON.stringify({ provider: "groq", tenantId: doTenantId }),
      });
      expect(getRes.status).toBe(200);

      const getBody = (await getRes.json()) as {
        keyId: string;
        key?: {
          id: string;
          provider: string;
          status: string;
          ciphertext: string;
        };
      };

      expect(getBody.keyId).toBe(keyId);
      expect(getBody.key?.id).toBe(keyId);
      expect(getBody.key?.provider).toBe("groq");
      expect(getBody.key?.status).toBe("HEALTHY");
      expect(getBody.key?.ciphertext).toBe(ciphertextB64);

      // Also verify GET /keys returns the healthy key
      const listRes = await stub.fetch("http://key-pool/keys?provider=groq", {
        headers: { "x-tenant-id": doTenantId },
      });
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as {
        keys: Array<{ id: string; provider: string; status: string }>;
      };
      const found = listBody.keys.find((k) => k.id === keyId);
      expect(found).toBeDefined();
      expect(found?.status).toBe("HEALTHY");
    });
  });
});
