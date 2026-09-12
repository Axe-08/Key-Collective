/**
 * Key Collective v3.5 — Subdomain Routing Tests (AUTH-03)
 * Verifies Host-header based routing for:
 * - api.* -> proxy hot path
 * - console.* -> SPA static delivery
 * - admin.* -> admin surveillance router with zero-knowledge denial (returns 404 for non-admins)
 * - key-col.axe08.tech -> apex redirect to console
 */

import { beforeEach, describe, expect, it } from "vitest";
import worker, {
  createWorker,
  HealthResponse,
  MainWorker,
  parseSubdomain,
  resolveHostRoute,
} from "./index";
import { WorkerEnv } from "./auth_middleware";
import { hashToken } from "../crypto";

/**
 * Mock D1 Database supporting tokens, users, and audit logs.
 */
class MockD1Db implements D1Database {
  public tokens = new Map<string, any>();
  public users = new Map<string, any>();
  public auditLogs: any[] = [];

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(query, this) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const s of statements) {
      results.push(await s.run<T>());
    }
    return results;
  }

  async exec(_query: string): Promise<D1ExecResult> {
    return { count: 1, duration: 1 };
  }

  withSession(): D1DatabaseSession {
    throw new Error("not implemented");
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private boundParams: unknown[] = [];

  constructor(
    private readonly query: string,
    private readonly db: MockD1Db
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundParams = values;
    return this as unknown as D1PreparedStatement;
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const res = await this.all<T>();
    const row = res.results[0] ?? null;
    if (!row) return null;
    if (colName && typeof row === "object") {
      return ((row as Record<string, unknown>)[colName] ?? null) as T;
    }
    return row;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  raw<T = unknown[]>(_options?: any): Promise<any> {
    throw new Error("not implemented");
  }

  private executeQuery<T>(): D1Result<T> {
    const q = this.query.trim().toUpperCase().replace(/\s+/g, " ");

    // SELECT FROM AUTH_TOKENS
    if (q.includes("SELECT") && q.includes("AUTH_TOKENS")) {
      let matched: any = null;
      if (q.includes("HASH_SHA256 = ?")) {
        const hash = String(this.boundParams[0]);
        for (const r of this.db.tokens.values()) {
          if (r.hash_sha256 === hash) {
            matched = r;
            break;
          }
        }
      } else if (q.includes("ID = ?")) {
        matched = this.db.tokens.get(String(this.boundParams[0]));
      }
      return {
        results: (matched ? [matched] : []) as unknown as T[],
        success: true,
        meta: { duration: 1 } as any,
      };
    }

    // SELECT FROM USERS
    if (q.includes("SELECT") && q.includes("USERS")) {
      let matched: any = null;
      if (q.includes("ID = ?")) {
        const id = String(this.boundParams[0]);
        matched = this.db.users.get(id);
      }
      if (!matched && q.includes("LIMIT")) {
        return {
          results: Array.from(this.db.users.values()) as unknown as T[],
          success: true,
          meta: { duration: 1 } as any,
        };
      }
      return {
        results: (matched ? [matched] : []) as unknown as T[],
        success: true,
        meta: { duration: 1 } as any,
      };
    }

    // UPDATE USERS
    if (q.includes("UPDATE USERS")) {
      if (q.includes("SET TIER = ? WHERE ID = ?")) {
        const [tier, id] = this.boundParams;
        const u = this.db.users.get(String(id));
        if (u) {
          u.tier = String(tier);
        }
      } else if (q.includes("SET IS_QUARANTINED = 1")) {
        const [reason, id] = this.boundParams;
        const u = this.db.users.get(String(id));
        if (u) {
          u.is_quarantined = 1;
          u.quarantine_reason = String(reason);
        }
      }
      return { results: [], success: true, meta: { duration: 1 } as any };
    }

    // INSERT INTO AUDIT_LOGS
    if (q.includes("INSERT INTO AUDIT_LOGS") || q.includes("INSERT INTO ADMIN_AUDIT_LOGS")) {
      this.db.auditLogs.push(this.boundParams);
      return { results: [], success: true, meta: { duration: 1 } as any };
    }

    return { results: [], success: true, meta: { duration: 1 } as any };
  }
}

describe("Subdomain Routing (AUTH-03)", () => {
  let db: MockD1Db;
  let env: WorkerEnv;
  let adminToken: string;
  let builderToken: string;
  let expiredAdminToken: string;
  let quarantinedAdminToken: string;

  beforeEach(async () => {
    db = new MockD1Db();

    // 1. Seed admin user & token
    adminToken = "kc_admin_master_token";
    const adminHash = await hashToken(adminToken);
    db.tokens.set("tok_admin", {
      id: "tok_admin",
      hash_sha256: adminHash,
      tenant_id: "usr_admin_01",
      expires_at: null,
      budget_microdollars: 100_000_000,
      spent_microdollars: 0,
      allowed_providers: "[]",
      rpm_limit: 1000,
      created_at: new Date().toISOString(),
    });
    db.users.set("usr_admin_01", {
      id: "usr_admin_01",
      email: "admin@keycollective.ai",
      tier: "admin",
      role: "admin",
      is_quarantined: 0,
      created_at: new Date().toISOString(),
    });

    // 2. Seed regular builder user & token
    builderToken = "kc_builder_token";
    const builderHash = await hashToken(builderToken);
    db.tokens.set("tok_builder", {
      id: "tok_builder",
      hash_sha256: builderHash,
      tenant_id: "usr_builder_01",
      expires_at: null,
      budget_microdollars: 50_000_000,
      spent_microdollars: 0,
      allowed_providers: "[]",
      rpm_limit: 20,
      created_at: new Date().toISOString(),
    });
    db.users.set("usr_builder_01", {
      id: "usr_builder_01",
      email: "dev@external.io",
      tier: "builder",
      role: "user",
      is_quarantined: 0,
      created_at: new Date().toISOString(),
    });

    // 3. Seed target user for admin mutation
    db.users.set("usr_test_01", {
      id: "usr_test_01",
      email: "partner@enterprise.com",
      tier: "builder",
      role: "user",
      is_quarantined: 0,
      created_at: new Date().toISOString(),
    });

    // 4. Seed expired admin token
    expiredAdminToken = "kc_admin_expired_token";
    const expHash = await hashToken(expiredAdminToken);
    db.tokens.set("tok_admin_expired", {
      id: "tok_admin_expired",
      hash_sha256: expHash,
      tenant_id: "usr_admin_01",
      expires_at: "2020-01-01T00:00:00.000Z",
      budget_microdollars: 100_000_000,
      spent_microdollars: 0,
      allowed_providers: "[]",
      rpm_limit: 1000,
    });

    // 5. Seed quarantined admin user & token
    quarantinedAdminToken = "kc_admin_quarantined_token";
    const quarHash = await hashToken(quarantinedAdminToken);
    db.tokens.set("tok_admin_quar", {
      id: "tok_admin_quar",
      hash_sha256: quarHash,
      tenant_id: "usr_admin_bad",
      expires_at: null,
    });
    db.users.set("usr_admin_bad", {
      id: "usr_admin_bad",
      email: "rogue_admin@keycol.internal",
      tier: "admin",
      role: "admin",
      is_quarantined: 1,
    });

    env = {
      DB: db,
      ADMIN_EMAILS: "admin@keycollective.ai,superuser@keycol.internal",
    };
  });

  describe("Subdomain Parser & Decision Resolution", () => {
    it("correctly identifies api.* host as api gateway", () => {
      expect(parseSubdomain("api.key-col.axe08.tech")).toBe("api");
      expect(parseSubdomain("api.keycollective.ai:8787")).toBe("api");
      const decision = resolveHostRoute("api.key-col.axe08.tech");
      expect(decision.subdomain).toBe("api");
      expect(decision.isApiGateway).toBe(true);
      expect(decision.isConsoleSpa).toBe(false);
      expect(decision.requiresAdminAuth).toBe(false);
    });

    it("correctly identifies console.* host as console SPA", () => {
      expect(parseSubdomain("console.key-col.axe08.tech")).toBe("console");
      expect(parseSubdomain("console.localhost:5173")).toBe("console");
      const decision = resolveHostRoute("console.key-col.axe08.tech");
      expect(decision.subdomain).toBe("console");
      expect(decision.isApiGateway).toBe(false);
      expect(decision.isConsoleSpa).toBe(true);
      expect(decision.requiresAdminAuth).toBe(false);
    });

    it("correctly identifies admin.* host as admin surveillance router", () => {
      expect(parseSubdomain("admin.key-col.axe08.tech")).toBe("admin");
      expect(parseSubdomain("admin.localhost:8787")).toBe("admin");
      const decision = resolveHostRoute("admin.key-col.axe08.tech");
      expect(decision.subdomain).toBe("admin");
      expect(decision.isApiGateway).toBe(false);
      expect(decision.isConsoleSpa).toBe(false);
      expect(decision.requiresAdminAuth).toBe(true);
    });

    it("correctly defaults other/apex hosts to apex", () => {
      expect(parseSubdomain("key-col.axe08.tech")).toBe("apex");
      expect(parseSubdomain("localhost")).toBe("apex");
      expect(parseSubdomain("")).toBe("apex");
    });
  });

  describe("Subdomain 1: api.* -> Proxy Hot Path Gateway", () => {
    it("returns 200 and healthy payload on GET /health with Host: api.key-col.axe08.tech", async () => {
      const req = new Request("https://api.key-col.axe08.tech/health", {
        method: "GET",
        headers: { host: "api.key-col.axe08.tech" },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      const data = (await res.json()) as HealthResponse;
      expect(data.status).toBe("healthy");
      expect(data.runtime).toBe("cloudflare-workers");
    });

    it("returns 200 and edge proxy ready message on GET /", async () => {
      const req = new Request("https://api.key-col.axe08.tech/", {
        method: "GET",
        headers: { host: "api.key-col.axe08.tech" },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Key Collective v2 Edge Proxy Ready");
    });

    it("delegates chat completions to router hot path and rejects unauthenticated", async () => {
      const req = new Request("https://api.key-col.axe08.tech/v1/chat/completions", {
        method: "POST",
        headers: {
          host: "api.key-col.axe08.tech",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("AUTHENTICATION_FAILED");
    });
  });

  describe("Subdomain 2: console.* -> Developer Console SPA Static Delivery", () => {
    it("delivers SPA html fallback on GET / when ASSETS is not bound", async () => {
      const req = new Request("https://console.key-col.axe08.tech/", {
        method: "GET",
        headers: { host: "console.key-col.axe08.tech" },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("Key Collective Console");
    });

    it("delivers SPA html on client-side paths like /dashboard", async () => {
      const req = new Request("https://console.key-col.axe08.tech/dashboard", {
        method: "GET",
        headers: { host: "console.key-col.axe08.tech" },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    });

    it("serves static assets via env.ASSETS binding when present", async () => {
      const mockAssets = {
        fetch: async (r: Request | string) => {
          const u = typeof r === "string" ? new URL(r) : new URL(r.url);
          if (u.pathname === "/assets/app.js") {
            return new Response("console.log(\"app\");", {
              status: 200,
              headers: { "content-type": "application/javascript" },
            });
          }
          return new Response("Not Found", { status: 404 });
        },
      };

      const customEnv: WorkerEnv = {
        ...env,
        ASSETS: mockAssets,
      };

      const req = new Request("https://console.key-col.axe08.tech/assets/app.js", {
        method: "GET",
        headers: { host: "console.key-col.axe08.tech" },
      });
      const res = await worker.fetch(req, customEnv);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/javascript");
      expect(await res.text()).toBe("console.log(\"app\");");
    });

    it("routes /api/keys on console.* to routerHandler instead of returning SPA html", async () => {
      const req = new Request("https://console.key-col.axe08.tech/api/keys", {
        method: "GET",
        headers: { host: "console.key-col.axe08.tech" },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe("Subdomain 3: admin.* -> Admin Surveillance Router with Zero-Knowledge Denial", () => {
    it("allows browser access to admin.* with ?token= query parameter", async () => {
      const req = new Request(`https://admin.key-col.axe08.tech/?token=${adminToken}`, {
        method: "GET",
        headers: { host: "admin.key-col.axe08.tech" },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
    });

    it("TC-ADMIN-01: Non-admin access returns 404 zero-knowledge denial", async () => {
      // Golden Test TC-ADMIN-01
      const req = new Request("https://admin.key-col.axe08.tech/", {
        method: "GET",
        headers: {
          host: "admin.key-col.axe08.tech",
          authorization: `Bearer ${builderToken}`,
        },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).toBe("Not Found");
    });

    it("denies unauthenticated visitors with 404 Not Found (zero knowledge)", async () => {
      const req = new Request("https://admin.key-col.axe08.tech/", {
        method: "GET",
        headers: { host: "admin.key-col.axe08.tech" },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
    });

    it("denies expired admin tokens with 404 Not Found", async () => {
      const req = new Request("https://admin.key-col.axe08.tech/api/admin/tenants", {
        method: "GET",
        headers: {
          host: "admin.key-col.axe08.tech",
          authorization: `Bearer ${expiredAdminToken}`,
        },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
    });

    it("denies quarantined admin users with 404 Not Found", async () => {
      const req = new Request("https://admin.key-col.axe08.tech/", {
        method: "GET",
        headers: {
          host: "admin.key-col.axe08.tech",
          authorization: `Bearer ${quarantinedAdminToken}`,
        },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
    });

    it("allows authorized admin to inspect status probe", async () => {
      const req = new Request("https://admin.key-col.axe08.tech/", {
        method: "GET",
        headers: {
          host: "admin.key-col.axe08.tech",
          authorization: `Bearer ${adminToken}`,
        },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; service: string };
      expect(body.status).toBe("authorized");
      expect(body.service).toContain("Admin Surveillance");
    });

    it("allows authorized admin to list tenants on GET /api/admin/tenants", async () => {
      const req = new Request("https://admin.key-col.axe08.tech/api/admin/tenants", {
        method: "GET",
        headers: {
          host: "admin.key-col.axe08.tech",
          authorization: `Bearer ${adminToken}`,
        },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { tenants: any[] };
      expect(Array.isArray(body.tenants)).toBe(true);
      expect(body.tenants.length).toBeGreaterThan(0);
    });

    it("TC-ADMIN-02: Admin successfully overrides tenant tier to Ultra", async () => {
      // Golden Test TC-ADMIN-02
      const req = new Request(
        "https://admin.key-col.axe08.tech/api/admin/tenants/usr_test_01/tier",
        {
          method: "POST",
          headers: {
            host: "admin.key-col.axe08.tech",
            authorization: `Bearer ${adminToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            new_tier: "ultra",
            reason: "VIP Partner Provisioning",
          }),
        }
      );
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        target_tenant_tier: string;
        audit_logged: boolean;
      };
      expect(body.success).toBe(true);
      expect(body.target_tenant_tier).toBe("ultra");
      expect(body.audit_logged).toBe(true);

      // Verify D1 state
      const targetUser = db.users.get("usr_test_01");
      expect(targetUser.tier).toBe("ultra");
      expect(db.auditLogs.length).toBeGreaterThan(0);
    });

    it("Admin successfully quarantines abusive tenant", async () => {
      const req = new Request(
        "https://admin.key-col.axe08.tech/api/admin/tenants/usr_test_01/quarantine",
        {
          method: "POST",
          headers: {
            host: "admin.key-col.axe08.tech",
            authorization: `Bearer ${adminToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ reason: "Sybil attack detected" }),
        }
      );
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; is_quarantined: boolean };
      expect(body.success).toBe(true);
      expect(body.is_quarantined).toBe(true);

      const target = db.users.get("usr_test_01");
      expect(target.is_quarantined).toBe(1);
    });
  });

  describe("Subdomain 4: Apex Redirect", () => {
    it("redirects key-col.axe08.tech root to console.key-col.axe08.tech", async () => {
      const req = new Request("https://key-col.axe08.tech/", {
        method: "GET",
        headers: { host: "key-col.axe08.tech" },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://console.key-col.axe08.tech/");
    });
  });

  describe("CORS Preflight", () => {
    it("returns 204 across subdomains for OPTIONS requests", async () => {
      for (const host of [
        "api.key-col.axe08.tech",
        "console.key-col.axe08.tech",
        "admin.key-col.axe08.tech",
      ]) {
        const req = new Request(`https://${host}/v1/chat/completions`, {
          method: "OPTIONS",
          headers: { host },
        });
        const res = await worker.fetch(req, env);
        expect(res.status).toBe(204);
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
      }
    });
  });
});
