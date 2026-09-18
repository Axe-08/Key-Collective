import { describe, it, expect } from "vitest";
import { DashboardRouter } from "../../../src/worker/router/dashboard/handler";
import type { WorkerEnv } from "../../../src/worker/auth/types";
import type { AuthMiddleware } from "../../../src/worker/auth/index";

describe("Dashboard Session & Telemetry Stream Endpoints", () => {
  const mockAuthMiddleware: AuthMiddleware = {
    authenticate: async (request: Request) => {
      const authHeader = request.headers.get("authorization");
      if (authHeader?.includes("user-token-123")) {
        return {
          tenantId: "usr_gh_testdev",
          tokenHash: "hash123",
          budgetMicrodollars: 50000000n,
          spentMicrodollars: 0n,
          allowedProviders: [],
          rpmLimit: 60,
        };
      }
      throw new Error("Invalid token");
    },
  };

  const users = new Map<string, any>();
  const mockDb = {
    prepare(query: string) {
      return {
        bind(...args: any[]) {
          return {
            async run() {
              if (query.includes("INSERT INTO users")) {
                const [id, email, tier, role, sybilScore] = args;
                users.set(id, { id, email, tier, role, sybil_score: sybilScore });
                return { success: true, meta: { changes: 1 } };
              }
              if (query.includes("UPDATE users SET tier")) {
                const [tier, role, id] = args;
                if (users.has(id)) {
                  const u = users.get(id);
                  u.tier = tier;
                  u.role = role;
                  return { success: true, meta: { changes: 1 } };
                }
                return { success: true, meta: { changes: 0 } };
              }
              return { success: true, meta: { changes: 1 } };
            },
            async first() {
              if (query.includes("SELECT id, email, tier, role, sybil_score FROM users WHERE id = ?")) {
                const [id] = args;
                return users.get(id) || null;
              }
              if (query.includes("SELECT tier, role FROM users WHERE id = ?")) {
                const [id] = args;
                return users.get(id) || null;
              }
              return null;
            },
            async all() {
              return { results: Array.from(users.values()) };
            },
          };
        },
      };
    },
  };

  const env: WorkerEnv = {
    KC_MASTER_KEY: "admin-master-key-xyz",
    DB: mockDb as any,
  } as unknown as WorkerEnv;

  const router = new DashboardRouter(
    { masterKey: "admin-master-key-xyz" },
    mockAuthMiddleware,
    () => ({} as any)
  );

  it("GET /api/session returns admin identity for master key", async () => {
    const req = new Request("https://key-col.axe08.tech/api/session", {
      headers: { authorization: "Bearer admin-master-key-xyz" },
    });
    const res = await router.handle(req, "/api/session", "GET", env);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.user.id).toBe("admin");
    expect(data.user.tier).toBe("admin");
    expect(data.user.role).toBe("admin");
  });

  it("GET /api/session returns user identity from D1 users table", async () => {
    users.set("usr_gh_testdev", {
      id: "usr_gh_testdev",
      email: "testdev@github.com",
      tier: "builder",
      role: "user",
      sybil_score: 92,
    });

    const req = new Request("https://key-col.axe08.tech/api/session", {
      headers: { authorization: "Bearer user-token-123" },
    });
    const res = await router.handle(req, "/api/session", "GET", env);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.user.id).toBe("usr_gh_testdev");
    expect(data.user.tier).toBe("builder");
  });

  it("GET /api/session returns null user for unauthenticated anonymous visitor", async () => {
    const req = new Request("https://key-col.axe08.tech/api/session");
    const res = await router.handle(req, "/api/session", "GET", env);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.user).toBeNull();
  });

  it("GET /api/telemetry/stream returns SSE headers and readable stream", async () => {
    const req = new Request("https://key-col.axe08.tech/api/telemetry/stream");
    const res = await router.handle(req, "/api/telemetry/stream", "GET", env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("no-cache");

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const chunk = await reader!.read();
    expect(chunk.done).toBe(false);
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain("data: {");
    expect(text).toContain("latency_ms");
    await reader!.cancel();
  });

  it("POST /api/admin/tenants/:id/tier updates role and upserts non-existent user", async () => {
    const req = new Request("https://key-col.axe08.tech/api/admin/tenants/usr_gh_newuser/tier", {
      method: "POST",
      headers: {
        authorization: "Bearer admin-master-key-xyz",
        "content-type": "application/json",
      },
      body: JSON.stringify({ new_tier: "admin", reason: "Promoted to admin" }),
    });

    const res = await router.handle(req, "/api/admin/tenants/usr_gh_newuser/tier", "POST", env);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.target_tenant_tier).toBe("admin");

    const saved = users.get("usr_gh_newuser");
    expect(saved).toBeDefined();
    expect(saved.tier).toBe("admin");
    expect(saved.role).toBe("admin");
  });
});
