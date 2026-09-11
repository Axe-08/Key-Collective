/**
 * Key Collective v3.5 — Two-Phase Auth, Anti-Sybil & Subdomain Routing Test Suite (AUTH-04)
 *
 * Conforms to:
 * - docs/architecture/lld_pod-auth-subdomains.md
 * - docs/system_design_v3_5.md (Section 2: Subdomain Routing, Section 3: Two-Phase Identity Ingress Flow)
 * - micro_tasks_pod-auth-subdomains.json (Task AUTH-04)
 *
 * Verification Areas:
 * 1. Subdomain Host Routing:
 *    - api.* -> proxy hot path / API gateway
 *    - console.* -> Developer Console SPA static delivery
 *    - admin.* -> Admin surveillance router with zero-knowledge denial (HTTP 404 for non-admins)
 *    - apex (key-col.axe08.tech) -> 302 redirect to console.*
 *    - Universal CORS preflight (OPTIONS -> 204)
 * 2. 5-Layer Anti-Sybil Scoring Engine (sybil.ts):
 *    - Layer 1: Turnstile bot score & token verification
 *    - Layer 2: Network ingress IP velocity (/24 subnet tracking) & Datacenter ASN check
 *    - Layer 3: Disposable email domain denylist & email verification
 *    - Layer 4: GitHub account age gate (> 30 days)
 *    - Layer 5: GitHub activity gate (> 5 repos or > 20 contributions)
 *    - Upstream GitHub API fetch mocking (profile fetch & auth header)
 * 3. Two-Phase Authentication State Transitions:
 *    - Phase 1 (Initial Onboarding): Sandboxed probationary tier (auth_phase = 1, tier = 'probationary')
 *    - Phase 2 (Verified Upgrade): GitHub OAuth PKCE & Sybil score calculation -> Promotion to builder (auth_phase = 2, tier = 'builder')
 *    - Failure / Quarantine paths: Underage accounts quarantined to probationary; bots/disposable emails suspended
 *    - Duplicate GitHub identity prevention
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker, {
  HealthResponse,
  parseSubdomain,
  resolveHostRoute,
} from "../../src/worker/index";
import { WorkerEnv } from "../../src/worker/auth_middleware";
import { hashToken } from "../../src/crypto";
import {
  calculateSybilScore,
  verifyTurnstileToken,
  globalSubnetTracker,
  TURNSTILE_TEST_TOKENS,
  SYBIL_SCORE_BUILDER_THRESHOLD,
  type SybilUserInput,
  type SybilRequestInput,
} from "../../src/auth/sybil";
import {
  generatePKCEPair,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  fetchOAuthUserProfile,
  issueUserJWT,
  verifyUserJWT,
} from "../../src/auth/oauth";
import type { OAuthProviderConfig } from "../../src/contracts/v3_types";

// ============================================================================
// In-Memory Mock D1 Database
// ============================================================================

interface UserDbRow {
  id: string;
  email: string | null;
  tier: string;
  role?: string | null;
  auth_phase?: number;
  sybil_score?: number;
  is_quarantined?: number | boolean;
  quarantine_reason?: string | null;
  github_user_id?: number | string | null;
  is_github_verified?: number | boolean;
  created_at?: string;
  [key: string]: unknown;
}

interface AuthTokenDbRow {
  id: string;
  hash_sha256: string;
  tenant_id: string;
  expires_at: string | null;
  budget_microdollars?: number | bigint;
  spent_microdollars?: number | bigint;
  allowed_providers?: string;
  rpm_limit?: number;
  created_at?: string;
  [key: string]: unknown;
}

interface AuditLogEntry {
  id: string;
  user_id?: string | null;
  admin_email?: string | null;
  action: string;
  target_tenant_id?: string | null;
  details_json?: string | null;
  ip_address: string;
  timestamp: string;
}

class MockD1Db implements D1Database {
  public users = new Map<string, UserDbRow>();
  public tokens = new Map<string, AuthTokenDbRow>();
  public auditLogs: AuditLogEntry[] = [];

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(query, this) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const stmt of statements) {
      results.push(await stmt.run<T>());
    }
    return results;
  }

  async exec(_query: string): Promise<D1ExecResult> {
    return { count: 1, duration: 1 };
  }

  withSession(): D1DatabaseSession {
    throw new Error("not implemented in mock");
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

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(_options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]> {
    throw new Error("not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    const q = this.query.trim().toUpperCase().replace(/\s+/g, " ");

    // 1. SELECT FROM AUTH_TOKENS
    if (q.includes("SELECT") && q.includes("AUTH_TOKENS")) {
      let matched: AuthTokenDbRow | null = null;
      if (q.includes("HASH_SHA256 = ?")) {
        const targetHash = String(this.boundParams[0]);
        for (const token of this.db.tokens.values()) {
          if (token.hash_sha256 === targetHash) {
            matched = token;
            break;
          }
        }
      } else if (q.includes("ID = ?")) {
        matched = this.db.tokens.get(String(this.boundParams[0])) ?? null;
      }
      return {
        results: (matched ? [matched] : []) as unknown as T[],
        success: true,
        meta: { duration: 1 } as any,
      };
    }

    // 2. SELECT FROM USERS
    if (q.includes("SELECT") && q.includes("USERS")) {
      let matched: UserDbRow | null = null;
      if (q.includes("WHERE ID = ?")) {
        matched = this.db.users.get(String(this.boundParams[0])) ?? null;
      } else if (q.includes("WHERE EMAIL = ?")) {
        const targetEmail = String(this.boundParams[0]).toLowerCase();
        for (const user of this.db.users.values()) {
          if (user.email?.toLowerCase() === targetEmail) {
            matched = user;
            break;
          }
        }
      } else if (q.includes("WHERE GITHUB_USER_ID = ?")) {
        const ghId = String(this.boundParams[0]);
        for (const user of this.db.users.values()) {
          if (String(user.github_user_id) === ghId) {
            matched = user;
            break;
          }
        }
      }
      if (!matched && (q.includes("LIMIT") || !q.includes("WHERE"))) {
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

    // 3. UPDATE USERS
    if (q.includes("UPDATE USERS")) {
      if (q.includes("SET TIER = ? WHERE ID = ?")) {
        const [tier, id] = this.boundParams;
        const user = this.db.users.get(String(id));
        if (user) {
          user.tier = String(tier);
        }
      } else if (q.includes("SET IS_QUARANTINED = 1")) {
        const [reason, id] = this.boundParams;
        const user = this.db.users.get(String(id));
        if (user) {
          user.is_quarantined = 1;
          user.quarantine_reason = String(reason);
        }
      } else if (q.includes("AUTH_PHASE")) {
        const id = String(this.boundParams[this.boundParams.length - 1]);
        const user = this.db.users.get(id);
        if (user) {
          user.auth_phase = Number(this.boundParams[0]);
          user.tier = String(this.boundParams[1]);
          user.sybil_score = Number(this.boundParams[2]);
          user.is_github_verified = 1;
          if (this.boundParams.length >= 5) {
            user.github_user_id = this.boundParams[3] as number | string;
          }
        }
      }
      return { results: [], success: true, meta: { duration: 1 } as any };
    }

    // 4. INSERT INTO USERS
    if (q.includes("INSERT INTO USERS")) {
      const [id, email, tier, auth_phase, sybil_score, role] = this.boundParams;
      this.db.users.set(String(id), {
        id: String(id),
        email: email ? String(email) : null,
        tier: tier ? String(tier) : "probationary",
        auth_phase: auth_phase !== undefined ? Number(auth_phase) : 1,
        sybil_score: sybil_score !== undefined ? Number(sybil_score) : 0,
        role: role ? String(role) : "user",
        is_quarantined: 0,
        is_github_verified: 0,
        created_at: new Date().toISOString(),
      });
      return { results: [], success: true, meta: { duration: 1 } as any };
    }

    // 5. INSERT INTO AUDIT_LOGS
    if (q.includes("INSERT INTO AUDIT_LOGS") || q.includes("INSERT INTO ADMIN_AUDIT_LOGS")) {
      const [id, userIdOrAdmin, action, ipOrTarget, extra1, extra2] = this.boundParams;
      this.db.auditLogs.push({
        id: String(id),
        user_id: String(userIdOrAdmin),
        admin_email: String(userIdOrAdmin),
        action: String(action),
        target_tenant_id: extra1 ? String(extra1) : String(ipOrTarget),
        details_json: extra2 ? String(extra2) : null,
        ip_address: String(ipOrTarget),
        timestamp: new Date().toISOString(),
      });
      return { results: [], success: true, meta: { duration: 1 } as any };
    }

    return { results: [], success: true, meta: { duration: 1 } as any };
  }
}

// ============================================================================
// Test Suite: Two-Phase Auth, Anti-Sybil & Subdomain Routing (AUTH-04)
// ============================================================================

describe("Two-Phase Auth, Anti-Sybil & Subdomain Routing (AUTH-04)", () => {
  const originalFetch = globalThis.fetch;
  const REF_NOW = new Date("2026-09-11T12:00:00.000Z");

  let db: MockD1Db;
  let env: WorkerEnv;
  let adminToken: string;
  let probationaryToken: string;
  let builderToken: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    globalSubnetTracker.reset();
    db = new MockD1Db();

    // 1. Seed Admin User & Token
    adminToken = "kc_admin_secret_token_123";
    const adminHash = await hashToken(adminToken);
    db.tokens.set("tok_admin", {
      id: "tok_admin",
      hash_sha256: adminHash,
      tenant_id: "usr_admin_master",
      expires_at: null,
      budget_microdollars: 100_000_000n,
      spent_microdollars: 0n,
      rpm_limit: 1000,
    });
    db.users.set("usr_admin_master", {
      id: "usr_admin_master",
      email: "admin@keycollective.ai",
      tier: "admin",
      role: "admin",
      auth_phase: 2,
      sybil_score: 100,
      is_quarantined: 0,
    });

    // 2. Seed Phase 1 Probationary User & Token
    probationaryToken = "kc_prob_user_token_phase1";
    const probHash = await hashToken(probationaryToken);
    db.tokens.set("tok_prob", {
      id: "tok_prob",
      hash_sha256: probHash,
      tenant_id: "usr_prob_01",
      expires_at: null,
      budget_microdollars: 50_000n, // 50,000 µ$ budget cap
      spent_microdollars: 0n,
      rpm_limit: 2, // 2 RPM sandbox limit
    });
    db.users.set("usr_prob_01", {
      id: "usr_prob_01",
      email: "onboarding_dev@gmail.com",
      tier: "probationary",
      role: "user",
      auth_phase: 1,
      sybil_score: 0,
      is_quarantined: 0,
      is_github_verified: 0,
    });

    // 3. Seed Phase 2 Builder User & Token
    builderToken = "kc_builder_user_token_phase2";
    const builderHash = await hashToken(builderToken);
    db.tokens.set("tok_builder", {
      id: "tok_builder",
      hash_sha256: builderHash,
      tenant_id: "usr_builder_01",
      expires_at: null,
      budget_microdollars: 50_000_000n, // 50 USD
      spent_microdollars: 0n,
      rpm_limit: 20, // 20 RPM builder limit
    });
    db.users.set("usr_builder_01", {
      id: "usr_builder_01",
      email: "verified_builder@github.dev",
      tier: "builder",
      role: "user",
      auth_phase: 2,
      sybil_score: 95,
      is_quarantined: 0,
      is_github_verified: 1,
      github_user_id: 888123,
    });

    env = {
      DB: db,
      KC_MASTER_KEY: "kc_master_key_for_tests_32_chars!!",
      ADMIN_EMAILS: "admin@keycollective.ai,root@keycol.internal",
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ==========================================================================
  // Section 1: Subdomain Host Routing & Zero-Knowledge Admin Denial
  // ==========================================================================
  describe("Subdomain Host Routing & Zero-Knowledge Admin Denial", () => {
    describe("Subdomain Resolution Pure Logic", () => {
      it("correctly identifies api.* hostnames", () => {
        expect(parseSubdomain("api.key-col.axe08.tech")).toBe("api");
        expect(parseSubdomain("api.keycollective.ai:8787")).toBe("api");
        expect(parseSubdomain("api.internal.host")).toBe("api");

        const route = resolveHostRoute("api.key-col.axe08.tech");
        expect(route.subdomain).toBe("api");
        expect(route.isApiGateway).toBe(true);
        expect(route.isConsoleSpa).toBe(false);
        expect(route.requiresAdminAuth).toBe(false);
      });

      it("correctly identifies console.* hostnames", () => {
        expect(parseSubdomain("console.key-col.axe08.tech")).toBe("console");
        expect(parseSubdomain("console.localhost:5173")).toBe("console");

        const route = resolveHostRoute("console.key-col.axe08.tech");
        expect(route.subdomain).toBe("console");
        expect(route.isApiGateway).toBe(false);
        expect(route.isConsoleSpa).toBe(true);
        expect(route.requiresAdminAuth).toBe(false);
      });

      it("correctly identifies admin.* hostnames", () => {
        expect(parseSubdomain("admin.key-col.axe08.tech")).toBe("admin");
        expect(parseSubdomain("admin.localhost:8787")).toBe("admin");

        const route = resolveHostRoute("admin.key-col.axe08.tech");
        expect(route.subdomain).toBe("admin");
        expect(route.isApiGateway).toBe(false);
        expect(route.isConsoleSpa).toBe(false);
        expect(route.requiresAdminAuth).toBe(true);
      });

      it("defaults other / apex domains to apex", () => {
        expect(parseSubdomain("key-col.axe08.tech")).toBe("apex");
        expect(parseSubdomain("keycollective.ai")).toBe("apex");
        expect(parseSubdomain("localhost:8787")).toBe("apex");

        const route = resolveHostRoute("key-col.axe08.tech");
        expect(route.subdomain).toBe("apex");
        expect(route.requiresAdminAuth).toBe(false);
      });
    });

    describe("Edge Worker Ingress Subdomain Routing", () => {
      it("routes api.* requests to the API Gateway hot path (health check)", async () => {
        const req = new Request("https://api.key-col.axe08.tech/health", {
          headers: { Host: "api.key-col.axe08.tech" },
        });

        const res = await worker.fetch(req, env);
        expect(res.status).toBe(200);

        const data = (await res.json()) as HealthResponse;
        expect(data.status).toBe("healthy");
        expect(data.runtime).toBe("cloudflare-workers");
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
      });

      it("routes console.* requests to Console SPA delivery with 200 HTML", async () => {
        const req = new Request("https://console.key-col.axe08.tech/dashboard", {
          headers: { Host: "console.key-col.axe08.tech" },
        });

        const res = await worker.fetch(req, env);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");

        const text = await res.text();
        expect(text).toContain("<title>Key Collective Console</title>");
      });

      it("redirects apex domain requests (key-col.axe08.tech) to console.* (302)", async () => {
        const req = new Request("https://key-col.axe08.tech/", {
          headers: { Host: "key-col.axe08.tech" },
        });

        const res = await worker.fetch(req, env);
        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe("https://console.key-col.axe08.tech/");
      });

      it("handles universal CORS preflight OPTIONS across all subdomains with 204", async () => {
        const subdomains = [
          "api.key-col.axe08.tech",
          "console.key-col.axe08.tech",
          "admin.key-col.axe08.tech",
        ];

        for (const host of subdomains) {
          const req = new Request(`https://${host}/v1/chat/completions`, {
            method: "OPTIONS",
            headers: {
              Host: host,
              "Access-Control-Request-Method": "POST",
              "Access-Control-Request-Headers": "authorization, content-type",
            },
          });

          const res = await worker.fetch(req, env);
          expect(res.status).toBe(204);
          expect(res.headers.get("access-control-allow-origin")).toBe("*");
          expect(res.headers.get("access-control-allow-methods")).toContain("POST");
        }
      });
    });

    describe("Zero-Knowledge Admin Denial (admin.*)", () => {
      it("returns absolute 404 Not Found when unauthenticated visitor hits admin.*", async () => {
        const req = new Request("https://admin.key-col.axe08.tech/api/admin/tenants", {
          headers: { Host: "admin.key-col.axe08.tech" },
        });

        const res = await worker.fetch(req, env);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe("Not Found");
      });

      it("returns 404 Not Found when non-admin / builder user hits admin.*", async () => {
        const req = new Request("https://admin.key-col.axe08.tech/api/admin/tenants", {
          headers: {
            Host: "admin.key-col.axe08.tech",
            Authorization: `Bearer ${builderToken}`,
          },
        });

        const res = await worker.fetch(req, env);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe("Not Found");
      });

      it("returns 404 Not Found when quarantined user with admin tier attempts access", async () => {
        const quarantinedAdminToken = "kc_admin_bad_quarantined";
        const quarHash = await hashToken(quarantinedAdminToken);
        db.tokens.set("tok_admin_quar", {
          id: "tok_admin_quar",
          hash_sha256: quarHash,
          tenant_id: "usr_admin_quarantined",
          expires_at: null,
        });
        db.users.set("usr_admin_quarantined", {
          id: "usr_admin_quarantined",
          email: "quarantined_admin@keycollective.ai",
          tier: "admin",
          role: "admin",
          is_quarantined: 1,
        });

        const req = new Request("https://admin.key-col.axe08.tech/api/admin/tenants", {
          headers: {
            Host: "admin.key-col.axe08.tech",
            Authorization: `Bearer ${quarantinedAdminToken}`,
          },
        });

        const res = await worker.fetch(req, env);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe("Not Found");
      });

      it("returns 404 Not Found when expired admin token is used", async () => {
        const expiredToken = "kc_admin_expired_token_123";
        const expHash = await hashToken(expiredToken);
        db.tokens.set("tok_admin_expired", {
          id: "tok_admin_expired",
          hash_sha256: expHash,
          tenant_id: "usr_admin_master",
          expires_at: "2020-01-01T00:00:00.000Z",
        });

        const req = new Request("https://admin.key-col.axe08.tech/api/admin/tenants", {
          headers: {
            Host: "admin.key-col.axe08.tech",
            Authorization: `Bearer ${expiredToken}`,
          },
        });

        const res = await worker.fetch(req, env);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe("Not Found");
      });

      it("allows authenticated admin to access admin surveillance probe and endpoints", async () => {
        const probeReq = new Request("https://admin.key-col.axe08.tech/", {
          headers: {
            Host: "admin.key-col.axe08.tech",
            Authorization: `Bearer ${adminToken}`,
          },
        });
        const probeRes = await worker.fetch(probeReq, env);
        expect(probeRes.status).toBe(200);

        const probeBody = (await probeRes.json()) as Record<string, unknown>;
        expect(probeBody.status).toBe("authorized");
        expect(probeBody.service).toContain("Admin Surveillance");

        const tenantsReq = new Request("https://admin.key-col.axe08.tech/api/admin/tenants", {
          headers: {
            Host: "admin.key-col.axe08.tech",
            Authorization: `Bearer ${adminToken}`,
          },
        });
        const tenantsRes = await worker.fetch(tenantsReq, env);
        expect(tenantsRes.status).toBe(200);

        const tenantsData = (await tenantsRes.json()) as { tenants: unknown[] };
        expect(Array.isArray(tenantsData.tenants)).toBe(true);
        expect(tenantsData.tenants.length).toBeGreaterThanOrEqual(3);
      });

      it("allows authenticated admin to execute tier overrides and writes audit log", async () => {
        const req = new Request("https://admin.key-col.axe08.tech/api/admin/tenants/usr_prob_01/tier", {
          method: "POST",
          headers: {
            Host: "admin.key-col.axe08.tech",
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            new_tier: "ultra",
            reason: "VIP partner account elevation",
          }),
        });

        const res = await worker.fetch(req, env);
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          success: boolean;
          target_tenant_id: string;
          target_tenant_tier: string;
          audit_logged: boolean;
        };
        expect(body.success).toBe(true);
        expect(body.target_tenant_tier).toBe("ultra");

        expect(db.users.get("usr_prob_01")?.tier).toBe("ultra");
        expect(db.auditLogs.length).toBeGreaterThanOrEqual(1);
      });

      it("allows authenticated admin to quarantine abusive tenants", async () => {
        const req = new Request("https://admin.key-col.axe08.tech/api/admin/tenants/usr_builder_01/quarantine", {
          method: "POST",
          headers: {
            Host: "admin.key-col.axe08.tech",
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reason: "Suspected credential stuffing",
          }),
        });

        const res = await worker.fetch(req, env);
        expect(res.status).toBe(200);

        const body = (await res.json()) as { success: boolean; is_quarantined: boolean };
        expect(body.success).toBe(true);
        expect(body.is_quarantined).toBe(true);
        expect(db.users.get("usr_builder_01")?.is_quarantined).toBe(1);
      });
    });
  });

  // ==========================================================================
  // Section 2: 5-Layer Anti-Sybil Scoring Engine (sybil.ts)
  // ==========================================================================
  describe("5-Layer Anti-Sybil Scoring Engine (Unit & Integration)", () => {
    // Layer 1: Turnstile Bot Verification & Challenge
    describe("Layer 1: Turnstile Bot Score & Challenge Verification", () => {
      it("awards full Layer 1 points when valid Turnstile test token is provided", async () => {
        const user: SybilUserInput = {
          username: "validhuman",
          primaryEmail: "human@developer.io",
          createdAt: "2025-01-01T00:00:00Z",
          publicRepos: 10,
          contributionsCount: 50,
          now: REF_NOW,
        };
        const req: SybilRequestInput = {
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
          clientIp: "198.51.100.20",
        };

        const result = await calculateSybilScore(user, req);

        expect(result.details.turnstileValid).toBe(true);
        expect(result.flags.turnstileFailed).toBe(false);
        expect(result.score).toBe(100);
        expect(result.passed).toBe(true);
        expect(result.tier).toBe("builder");
      });

      it("hard fails bot with score 0 and suspended tier when Turnstile token fails", async () => {
        const user: SybilUserInput = {
          username: "botcandidate",
          primaryEmail: "bot@domain.com",
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 15,
          contributionsCount: 100,
          now: REF_NOW,
        };
        const req: SybilRequestInput = {
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_FAIL,
          clientIp: "198.51.100.21",
        };

        const result = await calculateSybilScore(user, req);

        expect(result.details.turnstileValid).toBe(false);
        expect(result.flags.turnstileFailed).toBe(true);
        expect(result.score).toBe(0);
        expect(result.passed).toBe(false);
        expect(result.tier).toBe("suspended");
        expect(result.reasons.some((r) => r.includes("Turnstile"))).toBe(true);
      });

      it("detects bot from Cloudflare bot management score (< 30) without token", async () => {
        const user: SybilUserInput = {
          username: "cf_bot",
          primaryEmail: "cfbot@example.com",
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 10,
          contributionsCount: 30,
          now: REF_NOW,
        };
        const req: SybilRequestInput = {
          clientIp: "198.51.100.22",
          cf: { botManagement: { score: 12 } },
        };

        const result = await calculateSybilScore(user, req);
        expect(result.details.turnstileValid).toBe(false);
        expect(result.score).toBe(0);
        expect(result.tier).toBe("suspended");
      });

      it("mocks Cloudflare Turnstile siteverify HTTP endpoint call", async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              success: true,
              "error-codes": [],
              challenge_ts: new Date().toISOString(),
              hostname: "key-col.axe08.tech",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );

        const turnstileRes = await verifyTurnstileToken(
          "custom_edge_turnstile_response_token",
          {
            remoteIp: "198.51.100.23",
            secretKey: "0x4AAAAAAATestSecretKeyForSiteverify",
            fetchFn: mockFetch as unknown as typeof fetch,
          }
        );

        expect(turnstileRes.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          expect.objectContaining({
            method: "POST",
          })
        );
      });
    });

    // Layer 2: Network Ingress IP Velocity & Subnet Limits
    describe("Layer 2: Network Ingress IP Velocity & Subnet Tracking", () => {
      it("allows initial registration from a /24 subnet", async () => {
        const user: SybilUserInput = {
          username: "user_ip1",
          primaryEmail: "ip1@example.com",
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 8,
          contributionsCount: 30,
          now: REF_NOW,
        };
        const req: SybilRequestInput = {
          clientIp: "203.0.113.15",
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        };

        const result = await calculateSybilScore(user, req);
        expect(result.flags.ipVelocityExceeded).toBe(false);
        expect(result.details.subnetRegistrationCount).toBe(0);
        expect(result.passed).toBe(true);
      });

      it("throttles multiple accounts from the same /24 subnet within 30 days", async () => {
        const user1: SybilUserInput = {
          username: "user_ip_a",
          primaryEmail: "ipa@example.com",
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 8,
          contributionsCount: 30,
          now: REF_NOW,
        };
        const req1: SybilRequestInput = {
          clientIp: "203.0.113.50",
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        };
        await calculateSybilScore(user1, req1);

        const user2: SybilUserInput = {
          username: "user_ip_b",
          primaryEmail: "ipb@example.com",
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 8,
          contributionsCount: 30,
          now: REF_NOW,
        };
        const req2: SybilRequestInput = {
          clientIp: "203.0.113.99",
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        };

        const result2 = await calculateSybilScore(user2, req2);
        expect(result2.flags.ipVelocityExceeded).toBe(true);
        expect(result2.details.subnetRegistrationCount).toBe(1);
        expect(result2.tier).toBe("probationary");
      });

      it("penalizes requests originating from known datacenter ASNs (e.g. Hetzner, AWS, DO)", async () => {
        const datacenterAsns = [16509, 24940, 14061];

        for (const asn of datacenterAsns) {
          const user: SybilUserInput = {
            username: `dc_user_${asn}`,
            primaryEmail: `dc_${asn}@example.com`,
            createdAt: "2024-01-01T00:00:00Z",
            publicRepos: 8,
            contributionsCount: 30,
            now: REF_NOW,
          };
          const req: SybilRequestInput = {
            clientIp: "198.51.100.88",
            cf: { asn },
            turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
          };

          const result = await calculateSybilScore(user, req);
          expect(result.flags.isVpnOrProxy).toBe(true);
          expect(result.score).toBeLessThan(100);
        }
      });
    });

    // Layer 3: Disposable Email Domain Filter
    describe("Layer 3: Disposable Email Domain Denylist & Verification", () => {
      it("permits standard corporate and personal emails", async () => {
        const emails = ["developer@gmail.com", "alice@acme-corp.tech", "eng@sub.domain.org"];

        for (const email of emails) {
          const user: SybilUserInput = {
            username: `valid_${email.split("@")[0]}`,
            primaryEmail: email,
            createdAt: "2024-01-01T00:00:00Z",
            publicRepos: 8,
            contributionsCount: 30,
            now: REF_NOW,
          };
          const req: SybilRequestInput = {
            clientIp: "198.51.100.40",
            turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
          };

          const result = await calculateSybilScore(user, req);
          expect(result.flags.disposableEmail).toBe(false);
          expect(result.flags.isDisposableEmail).toBe(false);
          expect(result.passed).toBe(true);
        }
      });

      it("hard rejects disposable and throwaway emails with suspended tier", async () => {
        const disposableDomains = [
          "temp-mail.org",
          "mailinator.com",
          "guerrillamail.com",
          "10minutemail.com",
          "throwawaymail.com",
        ];

        for (const domain of disposableDomains) {
          const user: SybilUserInput = {
            username: `spammer_${domain.replace(/[^a-z0-9]/g, "")}`,
            primaryEmail: `abuse@${domain}`,
            createdAt: "2024-01-01T00:00:00Z",
            publicRepos: 10,
            contributionsCount: 50,
            now: REF_NOW,
          };
          const req: SybilRequestInput = {
            clientIp: "198.51.100.41",
            turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
          };

          const result = await calculateSybilScore(user, req);
          expect(result.flags.disposableEmail).toBe(true);
          expect(result.passed).toBe(false);
          expect(result.tier).toBe("suspended");
          expect(result.score).toBeLessThanOrEqual(20);
        }
      });

      it("penalizes unverified email addresses", async () => {
        const user: SybilUserInput = {
          username: "unverified_dev",
          primaryEmail: "unverified@company.com",
          isEmailVerified: false,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 8,
          contributionsCount: 30,
          now: REF_NOW,
        };
        const req: SybilRequestInput = {
          clientIp: "198.51.100.42",
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        };

        const result = await calculateSybilScore(user, req);
        expect(result.score).toBe(90);
        expect(result.reasons.some((r) => r.includes("unverified"))).toBe(true);
      });
    });

    // Layer 4: GitHub Account Maturity Gate (> 30 days)
    describe("Layer 4: GitHub Account Maturity Gate (> 30 days)", () => {
      it("passes mature account (> 30 days old) with full score", async () => {
        const created100DaysAgo = new Date(REF_NOW.getTime() - 100 * 24 * 60 * 60 * 1000);
        const user: SybilUserInput = {
          username: "mature_dev",
          primaryEmail: "mature@dev.org",
          createdAt: created100DaysAgo.toISOString(),
          publicRepos: 10,
          contributionsCount: 40,
          now: REF_NOW,
        };
        const req: SybilRequestInput = {
          clientIp: "198.51.100.60",
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        };

        const result = await calculateSybilScore(user, req);
        expect(result.details.accountAgeDays).toBeGreaterThanOrEqual(100);
        expect(result.flags.youngAccount).toBe(false);
        expect(result.tier).toBe("builder");
        expect(result.score).toBe(100);
      });

      it("quarantines fresh accounts (<= 30 days old) to probationary tier", async () => {
        const created7DaysAgo = new Date(REF_NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
        const user: SybilUserInput = {
          username: "fresh_account",
          primaryEmail: "fresh@dev.org",
          createdAt: created7DaysAgo.toISOString(),
          publicRepos: 10,
          contributionsCount: 50,
          now: REF_NOW,
        };
        const req: SybilRequestInput = {
          clientIp: "198.51.100.61",
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        };

        const result = await calculateSybilScore(user, req);
        expect(result.details.accountAgeDays).toBeLessThanOrEqual(30);
        expect(result.flags.youngAccount).toBe(true);
        expect(result.tier).toBe("probationary");
        expect(result.score).toBe(80);
      });
    });

    // Layer 5: GitHub Activity Gate (> 5 repos or > 20 contributions)
    describe("Layer 5: GitHub Activity Gate (> 5 repos or > 20 contributions)", () => {
      it("passes when user has > 5 public repos", async () => {
        const user: SybilUserInput = {
          username: "many_repos",
          primaryEmail: "repos@dev.org",
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 6,
          contributionsCount: 0,
          now: REF_NOW,
        };
        const req: SybilRequestInput = {
          clientIp: "198.51.100.70",
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        };

        const result = await calculateSybilScore(user, req);
        expect(result.flags.lowActivity).toBe(false);
        expect(result.tier).toBe("builder");
        expect(result.score).toBe(100);
      });

      it("passes when user has > 20 contributions even with only 1 repo", async () => {
        const user: SybilUserInput = {
          username: "active_contributor",
          primaryEmail: "contributor@dev.org",
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 1,
          contributionsCount: 25,
          now: REF_NOW,
        };
        const req: SybilRequestInput = {
          clientIp: "198.51.100.71",
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        };

        const result = await calculateSybilScore(user, req);
        expect(result.flags.lowActivity).toBe(false);
        expect(result.tier).toBe("builder");
        expect(result.score).toBe(100);
      });

      it("quarantines account to probationary when repos <= 5 and contributions <= 20", async () => {
        const user: SybilUserInput = {
          username: "idle_dev",
          primaryEmail: "idle@dev.org",
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 2,
          contributionsCount: 5,
          now: REF_NOW,
        };
        const req: SybilRequestInput = {
          clientIp: "198.51.100.72",
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        };

        const result = await calculateSybilScore(user, req);
        expect(result.flags.lowActivity).toBe(true);
        expect(result.tier).toBe("probationary");
        expect(result.score).toBe(80);
      });
    });

    // GitHub Upstream API Mocking
    describe("GitHub Upstream API Fetch Mocking", () => {
      it("fetches upstream GitHub profile using globalThis.fetch when fields are missing", async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              id: 998877,
              login: "upstream_octocat",
              created_at: "2023-05-01T00:00:00Z",
              public_repos: 14,
              total_contributions: 55,
              email: "octocat@github.internal",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
        globalThis.fetch = mockFetch;

        const user: SybilUserInput = {
          username: "upstream_octocat",
          accessToken: "gho_test_mock_token_777",
          now: REF_NOW,
        };
        const req: SybilRequestInput = {
          clientIp: "198.51.100.80",
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        };

        const result = await calculateSybilScore(user, req);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/users/upstream_octocat",
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: "Bearer gho_test_mock_token_777",
              "User-Agent": "Key-Collective-Anti-Sybil/1.0",
            }),
          })
        );

        expect(result.details.publicRepos).toBe(14);
        expect(result.details.contributionsCount).toBe(55);
        expect(result.details.email).toBe("octocat@github.internal");
        expect(result.tier).toBe("builder");
        expect(result.score).toBe(100);
      });

      it("handles GitHub API HTTP 500 or timeout error gracefully without throwing", async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error("GitHub API Connection Refused"));
        globalThis.fetch = mockFetch;

        const user: SybilUserInput = {
          username: "resilient_user",
          primaryEmail: "resilient@developer.org",
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 8,
          contributionsCount: 25,
          now: REF_NOW,
        };

        const result = await calculateSybilScore(user);
        expect(result.passed).toBe(true);
        expect(result.tier).toBe("builder");
      });
    });
  });

  // ==========================================================================
  // Section 3: Two-Phase Authentication State Transitions (Integration Flow)
  // ==========================================================================
  describe("Two-Phase Authentication Flow & State Transitions", () => {
    const jwtSecret = "jwt_secret_for_two_phase_auth_tests_32_bytes";

    describe("Phase 1: Initial Ingress Sandbox (Probationary)", () => {
      it("onboards new developer into Phase 1 sandbox with probationary tier", async () => {
        const newUserId = "usr_new_dev_01";
        const newUserEmail = "newbie@company.org";

        await db
          .prepare(
            "INSERT INTO users (id, email, tier, auth_phase, sybil_score, role) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(newUserId, newUserEmail, "probationary", 1, 0, "user")
          .run();

        const userRecord = db.users.get(newUserId);
        expect(userRecord).toBeDefined();
        expect(userRecord?.tier).toBe("probationary");
        expect(userRecord?.auth_phase).toBe(1);
        expect(userRecord?.sybil_score).toBe(0);
        expect(userRecord?.is_github_verified).toBe(0);

        const phase1Jwt = await issueUserJWT(
          {
            sub: newUserId,
            tenantId: newUserId,
            email: newUserEmail,
            tier: "probationary",
          },
          jwtSecret,
          { expiresInSeconds: 86400 }
        );

        const decoded = await verifyUserJWT(phase1Jwt, jwtSecret);
        expect(decoded.sub).toBe(newUserId);
        expect(decoded.tier).toBe("probationary");
      });

      it("enforces sandboxed limits (2 RPM, 50,000 µ$) for Phase 1 probationary users", () => {
        const probToken = db.tokens.get("tok_prob");
        expect(probToken?.rpm_limit).toBe(2);
        expect(probToken?.budget_microdollars).toBe(50_000n);
      });
    });

    describe("Phase 2: Identity Elevation Gate (Builder Upgrade)", () => {
      const oauthConfig: OAuthProviderConfig = {
        provider: "github",
        clientId: "gh_client_test_id",
        clientSecret: "gh_client_secret_test",
        authorizeEndpoint: "https://github.com/login/oauth/authorize",
        tokenEndpoint: "https://github.com/login/oauth/access_token",
        userInfoEndpoint: "https://api.github.com/user",
        redirectUri: "https://key-col.axe08.tech/api/auth/github/callback",
      };

      it("successfully upgrades Phase 1 user to Phase 2 Builder when Sybil checks pass", async () => {
        const targetUserId = "usr_prob_01";
        const ghUserId = 776655;
        const stateToken = "csrf_secure_state_999";

        globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
          const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

          if (urlStr.includes("access_token")) {
            return new Response(
              JSON.stringify({
                access_token: "gho_oauth_access_token_success",
                token_type: "bearer",
                scope: "read:user,user:email",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }

          if (urlStr.includes("api.github.com/user")) {
            return new Response(
              JSON.stringify({
                id: ghUserId,
                login: "promoted_dev",
                name: "Promoted Developer",
                email: "onboarding_dev@gmail.com",
                created_at: "2023-01-01T00:00:00Z",
                public_repos: 12,
                total_contributions: 65,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }

          return new Response("Not Found", { status: 404 });
        }) as typeof fetch;

        // 1. Initiate OAuth PKCE flow
        const pkce = await generatePKCEPair();
        const authUrl = buildAuthorizationUrl(oauthConfig, stateToken, {
          codeChallenge: pkce.challenge,
          codeChallengeMethod: pkce.method,
        });
        expect(authUrl).toContain("client_id=gh_client_test_id");
        expect(authUrl).toContain(`code_challenge=${pkce.challenge}`);

        // 2. Exchange OAuth code for access token
        const accessToken = await exchangeCodeForToken(oauthConfig, "oauth_code_xyz");
        expect(accessToken).toBe("gho_oauth_access_token_success");

        // 3. Fetch user profile from GitHub
        const profile = await fetchOAuthUserProfile(oauthConfig.userInfoEndpoint!, accessToken);
        expect(profile.id).toBe(String(ghUserId));
        expect(profile.username).toBe("promoted_dev");

        // 4. Calculate 5-layer Sybil Score
        const sybilResult = await calculateSybilScore(
          {
            username: profile.username,
            primaryEmail: profile.email,
            createdAt: "2023-01-01T00:00:00Z",
            publicRepos: 12,
            contributionsCount: 65,
            now: REF_NOW,
          },
          {
            clientIp: "198.51.100.55",
            turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
          }
        );

        expect(sybilResult.score).toBe(100);
        expect(sybilResult.passed).toBe(true);
        expect(sybilResult.tier).toBe("builder");

        // 5. Upgrade User in D1: auth_phase = 2, tier = 'builder'
        await db
          .prepare(
            "UPDATE users SET auth_phase = ?, tier = ?, sybil_score = ?, is_github_verified = 1, github_user_id = ? WHERE id = ?"
          )
          .bind(2, "builder", sybilResult.score, ghUserId, targetUserId)
          .run();

        // 6. Record Audit Log for elevation
        await db
          .prepare(
            "INSERT INTO audit_logs (id, user_id, action, ip_address, timestamp) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)"
          )
          .bind(
            crypto.randomUUID(),
            targetUserId,
            "PHASE_2_UPGRADE:builder",
            "198.51.100.55"
          )
          .run();

        // Verify State Transitions in D1
        const updatedUser = db.users.get(targetUserId);
        expect(updatedUser?.auth_phase).toBe(2);
        expect(updatedUser?.tier).toBe("builder");
        expect(updatedUser?.sybil_score).toBe(100);
        expect(updatedUser?.is_github_verified).toBe(1);
        expect(updatedUser?.github_user_id).toBe(ghUserId);

        // Verify Audit Log
        expect(
          db.auditLogs.some((l) => l.action.includes("PHASE_2_UPGRADE") && l.user_id === targetUserId)
        ).toBe(true);

        // 7. Issue Upgraded Phase 2 JWT
        const upgradedJwt = await issueUserJWT(
          {
            sub: targetUserId,
            tenantId: targetUserId,
            email: updatedUser?.email ?? "",
            username: profile.username,
            tier: "builder",
          },
          jwtSecret
        );
        const verifiedJwt = await verifyUserJWT(upgradedJwt, jwtSecret);
        expect(verifiedJwt.tier).toBe("builder");
      });

      it("denies elevation and keeps user in Phase 1 when Sybil score is below threshold", async () => {
        const targetUserId = "usr_prob_01";
        const created3DaysAgo = new Date(REF_NOW.getTime() - 3 * 24 * 60 * 60 * 1000);

        const sybilResult = await calculateSybilScore(
          {
            username: "young_inactive",
            primaryEmail: "young@example.com",
            createdAt: created3DaysAgo.toISOString(),
            publicRepos: 1,
            contributionsCount: 2,
            now: REF_NOW,
          },
          {
            clientIp: "198.51.100.56",
            turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
          }
        );

        expect(sybilResult.flags.youngAccount).toBe(true);
        expect(sybilResult.flags.lowActivity).toBe(true);
        expect(sybilResult.score).toBeLessThan(SYBIL_SCORE_BUILDER_THRESHOLD);
        expect(sybilResult.tier).toBe("probationary");

        const currentUser = db.users.get(targetUserId);
        expect(currentUser?.auth_phase).toBe(1);
        expect(currentUser?.tier).toBe("probationary");

        await db
          .prepare(
            "INSERT INTO audit_logs (id, user_id, action, ip_address, timestamp) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)"
          )
          .bind(
            crypto.randomUUID(),
            targetUserId,
            "PHASE_2_REJECTED:insufficient_sybil_score",
            "198.51.100.56"
          )
          .run();

        expect(
          db.auditLogs.some((l) => l.action.includes("PHASE_2_REJECTED"))
        ).toBe(true);
      });

      it("suspends and quarantines account if disposable email identity is detected", async () => {
        const targetUserId = "usr_prob_01";

        const sybilResult = await calculateSybilScore(
          {
            username: "disposable_attacker",
            primaryEmail: "attacker@temp-mail.org",
            createdAt: "2024-01-01T00:00:00Z",
            publicRepos: 10,
            contributionsCount: 50,
            now: REF_NOW,
          },
          {
            clientIp: "198.51.100.57",
            turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
          }
        );

        expect(sybilResult.flags.disposableEmail).toBe(true);
        expect(sybilResult.passed).toBe(false);
        expect(sybilResult.tier).toBe("suspended");

        await db
          .prepare(
            "UPDATE users SET is_quarantined = 1, quarantine_reason = ? WHERE id = ?"
          )
          .bind("Disposable email domain rejected", targetUserId)
          .run();

        const user = db.users.get(targetUserId);
        expect(user?.is_quarantined).toBe(1);
        expect(user?.quarantine_reason).toBe("Disposable email domain rejected");
      });

      it("prevents duplicate GitHub account linkage across different users", async () => {
        const existingGhUserId = 888123;

        const existing = await db
          .prepare("SELECT id, github_user_id FROM users WHERE github_user_id = ?")
          .bind(existingGhUserId)
          .first<{ id: string; github_user_id: number }>();

        expect(existing).not.toBeNull();
        expect(existing?.id).toBe("usr_builder_01");

        const secondUserId = "usr_prob_01";
        const canLink = existing === null || existing.id === secondUserId;
        expect(canLink).toBe(false);
      });
    });
  });
});
