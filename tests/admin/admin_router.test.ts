import { describe, it, expect } from "vitest";
import { handleAdminRequest } from "../../src/worker/gateway/admin_handler";
import { verifyAdminRequest } from "../../src/worker/gateway/admin_verifier";
import type { WorkerEnv } from "../../src/worker/auth/types";
import type { RouterHandler } from "../../src/worker/router/index";

function createMockEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  const users = new Map<string, any>();
  const auditLogs: any[] = [];
  const apiKeys = new Map<string, any>();

  const mockDb = {
    prepare(query: string) {
      return {
        bind(...args: any[]) {
          return {
            async run() {
              if (query.includes("UPDATE users SET tier")) {
                const [tier, id] = args;
                const u = users.get(id) || { id };
                u.tier = tier;
                users.set(id, u);
              } else if (query.includes("UPDATE users SET is_quarantined")) {
                const [isQuar, reason, id] = args;
                const u = users.get(id) || { id };
                u.is_quarantined = isQuar;
                u.quarantine_reason = reason;
                users.set(id, u);
              } else if (query.includes("INSERT INTO admin_audit_logs")) {
                auditLogs.push(args);
              } else if (query.includes("UPDATE api_keys SET community_routing_status")) {
                const [targetId] = args.reverse();
                const k = apiKeys.get(targetId) || { id: targetId };
                k.community_routing_status = "ACTIVE";
                apiKeys.set(targetId, k);
              }
              return { success: true, meta: { changes: 1 } };
            },
            async first() {
              if (query.includes("SELECT id, email, tier, role, is_quarantined FROM users")) {
                const [id] = args;
                return users.get(id) || null;
              }
              return null;
            },
            async all() {
              if (query.includes("FROM users")) {
                return { results: Array.from(users.values()) };
              }
              if (query.includes("FROM api_keys")) {
                return { results: Array.from(apiKeys.values()) };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };

  return {
    ADMIN_TOKEN: "admin-master-key-secret-12345",
    DB: mockDb as any,
    ...overrides,
  } as unknown as WorkerEnv;
}

const mockRouterHandler = {
  handle: async () => new Response("OK"),
} as unknown as RouterHandler;

describe("Admin Gateway & Zero-Knowledge Verification (Production Invariants)", () => {
  describe("verifyAdminRequest (Zero-Knowledge Denial)", () => {
    it("returns false when no Authorization header or token is present", async () => {
      const req = new Request("https://admin.keycollective.ai/api/admin/surveillance");
      const env = createMockEnv();
      const verified = await verifyAdminRequest(req, env);
      expect(verified).toBe(false);
    });

    it("returns false for non-admin arbitrary token", async () => {
      const req = new Request("https://admin.keycollective.ai/api/admin/surveillance", {
        headers: { Authorization: "Bearer bogus-token-12345" },
      });
      const env = createMockEnv();
      const verified = await verifyAdminRequest(req, env);
      expect(verified).toBe(false);
    });

    it("returns true when request matches ADMIN_TOKEN", async () => {
      const req = new Request("https://admin.keycollective.ai/api/admin/surveillance", {
        headers: { Authorization: "Bearer admin-master-key-secret-12345" },
      });
      const env = createMockEnv();
      const verified = await verifyAdminRequest(req, env);
      expect(verified).toBe(true);
    });

    it("returns false when request matches KC_MASTER_KEY but not ADMIN_TOKEN", async () => {
      const req = new Request("https://admin.keycollective.ai/api/admin/surveillance", {
        headers: { Authorization: "Bearer kc-encryption-key-only" },
      });
      const env = createMockEnv({
        ADMIN_TOKEN: "admin-secret-token",
        KC_MASTER_KEY: "kc-encryption-key-only",
      });
      const verified = await verifyAdminRequest(req, env);
      expect(verified).toBe(false);
    });

    it("supports token query param for browser address bar navigation", async () => {
      const req = new Request("https://admin.keycollective.ai/api/admin/surveillance?token=admin-master-key-secret-12345");
      const env = createMockEnv();
      const verified = await verifyAdminRequest(req, env);
      expect(verified).toBe(true);
    });
  });

  describe("handleAdminRequest (Live Endpoints)", () => {
    it("GET /api/admin/surveillance returns tenant and pool aggregates", async () => {
      const req = new Request("https://admin.keycollective.ai/api/admin/surveillance");
      const env = createMockEnv();
      const res = await handleAdminRequest(req, env, mockRouterHandler);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe("success");
      expect(data.pool).toBeDefined();
      expect(data.pool.providers).toBeInstanceOf(Array);
    });

    it("POST /api/admin/tenants/:id/tier overrides tenant tier in D1", async () => {
      const req = new Request("https://admin.keycollective.ai/api/admin/tenants/usr_123/tier", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ new_tier: "ultra", reason: "Enterprise VIP" }),
      });
      const env = createMockEnv();
      const res = await handleAdminRequest(req, env, mockRouterHandler);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.target_tenant_id).toBe("usr_123");
      expect(data.target_tenant_tier).toBe("ultra");
    });

    it("POST /api/admin/tenants/:id/quarantine toggles quarantine status", async () => {
      const req = new Request("https://admin.keycollective.ai/api/admin/tenants/usr_bad/quarantine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_quarantined: true, reason: "Sybil violation" }),
      });
      const env = createMockEnv();
      const res = await handleAdminRequest(req, env, mockRouterHandler);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.target_tenant_id).toBe("usr_bad");
      expect(data.is_quarantined).toBe(true);
    });

    it("POST /api/admin/circuit-breaker overrides provider circuit state", async () => {
      const req = new Request("https://admin.keycollective.ai/api/admin/circuit-breaker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "groq", state: "TRIPPED", reason: "Upstream 503 incident" }),
      });
      const env = createMockEnv();
      const res = await handleAdminRequest(req, env, mockRouterHandler);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.provider).toBe("groq");
      expect(data.state).toBe("TRIPPED");
    });

    it("POST /api/admin/kill-switch disarms or engages edge freeze", async () => {
      const req = new Request("https://admin.keycollective.ai/api/admin/kill-switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: true, reason: "Security drill" }),
      });
      const env = createMockEnv();
      const res = await handleAdminRequest(req, env, mockRouterHandler);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.active).toBe(true);
    });
  });
});
