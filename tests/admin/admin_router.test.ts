import { describe, it, expect, beforeEach } from "vitest";
import {
  adminRouter,
  verifyAdmin,
  createMockRequest,
  createMockResponse,
  resetAdminStore,
  getTenants,
  updateTenantTier,
  setTenantQuarantine,
  getPoolHealth,
  resetCircuitBreakers,
} from "../../src/admin/admin_router";

describe("Admin Surveillance Router & Zero-Knowledge Denial (T1 Verification)", () => {
  beforeEach(() => {
    resetAdminStore();
  });

  describe("Zero-Knowledge Denial Middleware (verifyAdmin)", () => {
    it("returns 404 Not Found when no role is present (anonymity shield)", async () => {
      const req = createMockRequest({
        method: "GET",
        url: "/admin/api/tenants",
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: "Not Found" });
    });

    it("returns 404 Not Found for probationary tier / non-admin user", async () => {
      const req = createMockRequest({
        method: "GET",
        url: "/admin/api/tenants",
        role: "probationary",
        user: { role: "probationary", tier: "probationary" },
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: "Not Found" });
    });

    it("returns 404 Not Found for builder tier user", async () => {
      const req = createMockRequest({
        method: "GET",
        url: "/admin/api/tenants",
        role: "builder",
        user: { id: "usr_1", role: "builder", tier: "builder" },
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: "Not Found" });
    });

    it("returns 404 Not Found when x-user-role header is not admin", async () => {
      const req = createMockRequest({
        method: "GET",
        url: "/admin/api/tenants",
        headers: { "x-user-role": "builder" },
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: "Not Found" });
    });

    it("never returns 401 or 403 to avoid endpoint discovery", async () => {
      const invalidRoles = ["guest", "user", "developer", "ultra", "max", "", "undefined"];
      for (const r of invalidRoles) {
        const req = createMockRequest({
          method: "GET",
          url: "/admin/api/tenants",
          role: r,
        });
        const res = createMockResponse();
        await adminRouter(req, res);
        expect(res.statusCode).toBe(404);
      }
    });

    it("allows access when role is strictly admin via req.role", async () => {
      const req = createMockRequest({
        method: "GET",
        url: "/admin/api/tenants",
        role: "admin",
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(200);
      const data = res.body as { success: boolean; tenants: unknown[] };
      expect(data.success).toBe(true);
      expect(Array.isArray(data.tenants)).toBe(true);
      expect(data.tenants.length).toBeGreaterThan(0);
    });

    it("allows access when role is admin via req.user.role", async () => {
      const req = createMockRequest({
        method: "GET",
        url: "/admin/api/tenants",
        user: { id: "admin_1", email: "admin@key-col.axe08.tech", role: "admin" },
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(200);
      const data = res.body as { success: boolean };
      expect(data.success).toBe(true);
    });

    it("allows access when x-user-role header is admin", async () => {
      const req = createMockRequest({
        method: "GET",
        url: "/admin/api/tenants",
        headers: { "x-user-role": "admin" },
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(200);
      const data = res.body as { success: boolean };
      expect(data.success).toBe(true);
    });
  });

  describe("Admin Surveillance Endpoints Functionality", () => {
    it("GET /admin/api/tenants lists all active tenants with microdollar spends", async () => {
      const req = createMockRequest({
        method: "GET",
        url: "/admin/api/tenants",
        role: "admin",
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(200);
      const data = res.body as { success: boolean; tenants: Array<{ todaySpendMicrodollars: number }> };
      expect(data.success).toBe(true);
      expect(data.tenants.length).toBe(3);
      for (const t of data.tenants) {
        expect(typeof t.todaySpendMicrodollars).toBe("number");
      }
    });

    it("POST /admin/api/tenants/:id/role updates tenant tier", async () => {
      const req = createMockRequest({
        method: "POST",
        url: "/admin/api/tenants/tenant_probationary_01/role",
        role: "admin",
        body: { tier: "builder", reason: "Verified GitHub credentials" },
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(200);
      const data = res.body as { success: boolean; tenantId: string; tier: string };
      expect(data.success).toBe(true);
      expect(data.tenantId).toBe("tenant_probationary_01");
      expect(data.tier).toBe("builder");
    });

    it("POST /admin/api/tenants/:id/role rejects invalid tier", async () => {
      const req = createMockRequest({
        method: "POST",
        url: "/admin/api/tenants/tenant_probationary_01/role",
        role: "admin",
        body: { tier: "superadmin_invalid" },
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(400);
      const data = res.body as { error: string };
      expect(data.error).toContain("Invalid or missing tier");
    });

    it("POST /admin/api/tenants/:id/quarantine toggles quarantine status", async () => {
      const req = createMockRequest({
        method: "POST",
        url: "/admin/api/tenants/tenant_builder_02/quarantine",
        role: "admin",
        body: { isQuarantined: true, reason: "Sybil anomaly detected" },
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(200);
      const data = res.body as { success: boolean; tenantId: string; isQuarantined: boolean };
      expect(data.success).toBe(true);
      expect(data.tenantId).toBe("tenant_builder_02");
      expect(data.isQuarantined).toBe(true);
    });

    it("GET /admin/api/pool/health returns multi-provider circuit breaker state", async () => {
      const req = createMockRequest({
        method: "GET",
        url: "/admin/api/pool/health",
        role: "admin",
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(200);
      const data = res.body as { status: string; pools: Record<string, unknown> };
      expect(data.status).toBe("healthy");
      expect(data.pools.gemini).toBeDefined();
      expect(data.pools.groq).toBeDefined();
      expect(data.pools.cerebras).toBeDefined();
      expect(data.pools.deepseek).toBeDefined();
    });

    it("POST /admin/api/pool/circuit-breaker/reset resets tripped providers", async () => {
      const req = createMockRequest({
        method: "POST",
        url: "/admin/api/pool/circuit-breaker/reset",
        role: "admin",
        body: { provider: "gemini", reason: "Quota refreshed" },
      });
      const res = createMockResponse();

      await adminRouter(req, res);

      expect(res.statusCode).toBe(200);
      const data = res.body as { success: boolean; provider: string; state: string };
      expect(data.success).toBe(true);
      expect(data.provider).toBe("gemini");
      expect(data.state).toBe("NORMAL");
    });
  });
});
