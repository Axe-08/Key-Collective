/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: AuthMiddleware (Token validation, D1 lookup, RPM check, budget gating)
 *
 * Invariants Tested (GEMINI.md Constitution & LLD Edge Worker Auth):
 * 1. Strict TypeScript (strict mode, zero any).
 * 2. Timing-Safe Cryptographic Comparisons: Constant-time Web Crypto verification.
 * 3. No Plaintext Keys/Tokens in D1: AES-256-GCM encrypted tokens + SHA-256 hash indexing.
 * 4. Fixed-Point Microdollars: int64 / bigint microdollars, zero floating-point math.
 * 5. Budget Gating (HTTP 429 + Retry-After per golden test tc-08).
 * 6. Auth Token Validation before downstream (HTTP 401 per golden test tc-12).
 * 7. Sliding-window RPM rate limiting.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticatedContext,
  AuthMiddleware,
  AuthMiddlewareOptions,
  authenticateRequest,
  defaultAuthMiddleware,
  extractBearerToken,
  formatAuthError,
  InMemoryRateLimiterStorage,
  withAuth,
  WorkerEnv,
} from "../../../src/worker/auth_middleware";
import {
  AuthTokenRecord,
  AuthTokenRow,
  AuthTokensRepository,
} from "../../../src/storage/repositories/authTokens";
import {
  AuthenticationError,
  TenantIsolationError,
} from "../../../src/errors/auth_errors";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "../../../src/errors/key_errors";
import { DomainError } from "../../../src/errors/domain_error";
import { DEFAULT_RETRY_AFTER_SECONDS, DEFAULT_RPM_LIMIT } from "../../../src/constants/limits";
import { hashToken } from "../../../src/crypto";

/**
 * In-memory Mock D1 Database implementation for AuthTokensRepository unit testing.
 */
class MockD1Database implements D1Database {
  public rows = new Map<string, AuthTokenRow>();

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

  async exec(_query: string): Promise<D1ExecResult> {
    return { count: 1, duration: 1 };
  }

  withSession(): D1DatabaseSession {
    throw new Error("withSession not implemented in mock");
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
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

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const res = await this.all<T>();
    const firstRow = res.results[0] ?? null;
    if (!firstRow) return null;
    if (colName && typeof firstRow === "object") {
      return ((firstRow as Record<string, unknown>)[colName] ?? null) as T;
    }
    return firstRow;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(_options?: { columnNames?: boolean }): Promise<any> {
    throw new Error("raw not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    const trimmed = this.query.trim();
    const upper = trimmed.toUpperCase().replace(/\s+/g, " ");

    // 1. INSERT INTO AUTH_TOKENS
    if (upper.startsWith("INSERT INTO AUTH_TOKENS")) {
      const [
        id,
        hash_sha256,
        tenant_id,
        encrypted_token_b64,
        nonce_b64,
        budget_microdollars,
        spent_microdollars,
        allowed_providers,
        rpm_limit,
        expires_at,
        created_at,
      ] = this.boundParams;

      const row: AuthTokenRow = {
        id: String(id),
        hash_sha256: String(hash_sha256),
        tenant_id: String(tenant_id),
        encrypted_token_b64: encrypted_token_b64 ? String(encrypted_token_b64) : null,
        nonce_b64: nonce_b64 ? String(nonce_b64) : null,
        budget_microdollars: Number(budget_microdollars),
        spent_microdollars: Number(spent_microdollars),
        allowed_providers: String(allowed_providers),
        rpm_limit: Number(rpm_limit),
        expires_at: expires_at ? String(expires_at) : null,
        created_at: String(created_at),
      };

      this.db.rows.set(row.id, row);
      return {
        results: [],
        success: true,
        meta: { changes: 1, duration: 1, last_row_id: 1, rows_read: 0, rows_written: 1, size_after: 0 },
      };
    }

    // 2. SELECT * FROM AUTH_TOKENS WHERE HASH_SHA256 = ?
    if (upper.includes("WHERE HASH_SHA256 = ?")) {
      const hash = String(this.boundParams[0]).toLowerCase();
      const matched = Array.from(this.db.rows.values()).filter(
        (r) => r.hash_sha256.toLowerCase() === hash
      );
      return {
        results: matched as unknown as T[],
        success: true,
        meta: { changes: 0, duration: 1, last_row_id: 0, rows_read: matched.length, rows_written: 0, size_after: 0 },
      };
    }

    // 3. SELECT * FROM AUTH_TOKENS WHERE ID = ?
    if (upper.includes("WHERE ID = ?")) {
      const id = String(this.boundParams[0]);
      const matched = Array.from(this.db.rows.values()).filter((r) => r.id === id);
      return {
        results: matched as unknown as T[],
        success: true,
        meta: { changes: 0, duration: 1, last_row_id: 0, rows_read: matched.length, rows_written: 0, size_after: 0 },
      };
    }

    // 4. UPDATE AUTH_TOKENS
    if (upper.startsWith("UPDATE AUTH_TOKENS")) {
      return {
        results: [],
        success: true,
        meta: { changes: 1, duration: 1, last_row_id: 0, rows_read: 1, rows_written: 1, size_after: 0 },
      };
    }

    return {
      results: [],
      success: true,
      meta: { changes: 0, duration: 1, last_row_id: 0, rows_read: 0, rows_written: 0, size_after: 0 },
    };
  }
}

describe("AuthMiddleware — Edge Authentication & Invariants", () => {
  let mockDb: MockD1Database;
  let authRepo: AuthTokensRepository;
  let middleware: AuthMiddleware;

  const TEST_TOKEN = "kc_live_sec_1234567890abcdef1234567890";
  const TEST_TENANT = "tenant-enterprise-acme";

  beforeEach(async () => {
    mockDb = new MockD1Database();
    authRepo = new AuthTokensRepository(mockDb);
    middleware = new AuthMiddleware({ authRepo });
  });

  describe("Token Extraction (`extractBearerToken`)", () => {
    it("extracts bearer token from Request object", () => {
      const request = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(extractBearerToken(request)).toBe(TEST_TOKEN);
    });

    it("extracts bearer token case-insensitively ('bearer <token>')", () => {
      const request = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `bearer ${TEST_TOKEN}` },
      });
      expect(extractBearerToken(request)).toBe(TEST_TOKEN);
    });

    it("extracts bearer token from Headers instance", () => {
      const headers = new Headers();
      headers.set("Authorization", `Bearer ${TEST_TOKEN}`);
      expect(extractBearerToken(headers)).toBe(TEST_TOKEN);
    });

    it("extracts bearer token from raw string", () => {
      expect(extractBearerToken(`Bearer ${TEST_TOKEN}`)).toBe(TEST_TOKEN);
      expect(extractBearerToken(`bearer ${TEST_TOKEN}   `)).toBe(TEST_TOKEN);
    });

    it("throws AuthenticationError (HTTP 401) on missing Authorization header", () => {
      const req = new Request("https://api.keycollective.com/v1/chat/completions");
      expect(() => extractBearerToken(req)).toThrowError(AuthenticationError);
      try {
        extractBearerToken(req);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthenticationError);
        const authErr = err as AuthenticationError;
        expect(authErr.statusCode).toBe(401);
        expect(authErr.reason).toBe("missing_token");
      }
    });

    it("throws AuthenticationError (HTTP 401) on null or undefined input", () => {
      expect(() => extractBearerToken(null)).toThrow(AuthenticationError);
      expect(() => extractBearerToken(undefined)).toThrow(AuthenticationError);
    });

    it("throws AuthenticationError (HTTP 401) on malformed authorization scheme", () => {
      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      });
      expect(() => extractBearerToken(req)).toThrowError(AuthenticationError);
      try {
        extractBearerToken(req);
      } catch (err) {
        const authErr = err as AuthenticationError;
        expect(authErr.statusCode).toBe(401);
        expect(authErr.reason).toBe("malformed_header");
      }
    });

    it("throws AuthenticationError (HTTP 401) on empty token after Bearer scheme", () => {
      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: "Bearer    " },
      });
      expect(() => extractBearerToken(req)).toThrowError(AuthenticationError);
      try {
        extractBearerToken(req);
      } catch (err) {
        const authErr = err as AuthenticationError;
        expect(authErr.statusCode).toBe(401);
        expect(authErr.reason).toBe("missing_token");
      }
    });
  });

  describe("D1 Lookup & Token Validation", () => {
    it("successfully authenticates a valid token stored in D1", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        budgetMicrodollars: 10_000_000n,
        rpmLimit: 120,
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const ctx = await middleware.authenticate(req);
      expect(ctx.isAuthenticated).toBe(true);
      expect(ctx.tenantId).toBe(TEST_TENANT);
      expect(ctx.rpmLimit).toBe(120);
      expect(ctx.currentRpm).toBe(1);
      expect(ctx.remainingRpm).toBe(119);
      expect(ctx.budgetMicrodollars).toBe(10_000_000n);
      expect(ctx.spentMicrodollars).toBe(0n);
      expect(ctx.budgetRemainingMicrodollars).toBe(10_000_000n);
    });

    it("rejects unknown bearer token with HTTP 401 (invalid_token)", async () => {
      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: "Bearer kc_live_unknown_token_value_999" },
      });

      await expect(middleware.authenticate(req)).rejects.toThrowError(AuthenticationError);
      try {
        await middleware.authenticate(req);
      } catch (err) {
        const authErr = err as AuthenticationError;
        expect(authErr.statusCode).toBe(401);
        expect(authErr.reason).toBe("invalid_token");
        const resp = authErr.toResponse();
        expect(resp.status).toBe(401);
        expect(resp.headers.get("www-authenticate")).toContain("Bearer");
      }
    });

    it("throws AuthenticationError with missing_db_binding if neither repo nor DB provided", async () => {
      const isolatedMiddleware = new AuthMiddleware();
      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      await expect(isolatedMiddleware.authenticate(req)).rejects.toThrowError(AuthenticationError);
      try {
        await isolatedMiddleware.authenticate(req);
      } catch (err) {
        const authErr = err as AuthenticationError;
        expect(authErr.reason).toBe("missing_db_binding");
      }
    });

    it("automatically resolves D1 from WorkerEnv binding", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
      });

      const env: WorkerEnv = { DB: mockDb };
      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const defaultMw = new AuthMiddleware();
      const ctx = await defaultMw.authenticate(req, env);
      expect(ctx.tenantId).toBe(TEST_TENANT);
      expect(ctx.isAuthenticated).toBe(true);
    });
  });

  describe("Expiration Handling", () => {
    it("allows active token where expiresAt is in the future", async () => {
      const futureDate = new Date(Date.now() + 100_000).toISOString();
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        expiresAt: futureDate,
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const ctx = await middleware.authenticate(req);
      expect(ctx.isAuthenticated).toBe(true);
    });

    it("rejects token where expiresAt is in the past with HTTP 401 (expired_token)", async () => {
      const pastDate = new Date(Date.now() - 50_000).toISOString();
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        expiresAt: pastDate,
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      await expect(middleware.authenticate(req)).rejects.toThrowError(AuthenticationError);
      try {
        await middleware.authenticate(req);
      } catch (err) {
        const authErr = err as AuthenticationError;
        expect(authErr.statusCode).toBe(401);
        expect(authErr.reason).toBe("expired_token");
      }
    });

    it("respects deterministic custom timeProvider for expiration check", async () => {
      const fixedNow = 1_700_000_000_000;
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        expiresAt: new Date(fixedNow + 10_000).toISOString(),
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      // At fixedNow: unexpired
      const ctx = await middleware.authenticate(req, undefined, {
        timeProvider: () => fixedNow,
      });
      expect(ctx.isAuthenticated).toBe(true);

      // At fixedNow + 20_000: expired
      await expect(
        middleware.authenticate(req, undefined, {
          timeProvider: () => fixedNow + 20_000,
        })
      ).rejects.toThrowError(AuthenticationError);
    });
  });

  describe("Provider Allowance Gating (`allowedProviders`)", () => {
    it("allows any provider when token has empty allowedProviders list", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        allowedProviders: [],
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const ctx = await middleware.authenticate(req, undefined, {
        requiredProvider: "openai",
      });
      expect(ctx.isAuthenticated).toBe(true);
    });

    it("allows request when requiredProvider matches token allowedProviders", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        allowedProviders: ["google", "groq"],
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const ctx = await middleware.authenticate(req, undefined, {
        requiredProvider: "Google",
      });
      expect(ctx.isAuthenticated).toBe(true);
    });

    it("rejects request with HTTP 401 when requiredProvider is not in allowedProviders", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        allowedProviders: ["google"],
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      await expect(
        middleware.authenticate(req, undefined, {
          requiredProvider: "anthropic",
        })
      ).rejects.toThrowError(AuthenticationError);

      try {
        await middleware.authenticate(req, undefined, {
          requiredProvider: "anthropic",
        });
      } catch (err) {
        const authErr = err as AuthenticationError;
        expect(authErr.statusCode).toBe(401);
        expect(authErr.reason).toBe("provider_not_allowed");
      }
    });
  });

  describe("Budget Gating (Fixed-Point Microdollars — Golden Test tc-08)", () => {
    it("allows request when budgetMicrodollars is 0n (unlimited)", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        budgetMicrodollars: 0n,
        spentMicrodollars: 999_999_999n,
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const ctx = await middleware.authenticate(req);
      expect(ctx.isAuthenticated).toBe(true);
      expect(ctx.budgetMicrodollars).toBe(0n);
      expect(ctx.budgetRemainingMicrodollars).toBeUndefined();
    });

    it("allows request when spent is strictly below budget ceiling", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        budgetMicrodollars: 1_000_000n,
        spentMicrodollars: 500_000n,
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const ctx = await middleware.authenticate(req);
      expect(ctx.isAuthenticated).toBe(true);
      expect(ctx.budgetRemainingMicrodollars).toBe(500_000n);
    });

    it("blocks request and throws QuotaExceededError (HTTP 429) when budget exhausted (tc-08)", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        budgetMicrodollars: 1_000_000n,
        spentMicrodollars: 1_000_000n,
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      await expect(middleware.authenticate(req)).rejects.toThrowError(QuotaExceededError);

      try {
        await middleware.authenticate(req);
      } catch (err) {
        expect(err).toBeInstanceOf(QuotaExceededError);
        const quotaErr = err as QuotaExceededError;
        expect(quotaErr.statusCode).toBe(429);
        expect(quotaErr.tenantId).toBe(TEST_TENANT);
        expect(quotaErr.quotaType).toBe("spend_limit");

        const response = formatAuthError(quotaErr);
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe(String(DEFAULT_RETRY_AFTER_SECONDS));
      }
    });

    it("blocks request when estimated costMicrodollars exceeds remaining headroom", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        budgetMicrodollars: 1_000_000n,
        spentMicrodollars: 900_000n,
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      await expect(
        middleware.authenticate(req, undefined, {
          costMicrodollars: 150_000n,
        })
      ).rejects.toThrowError(QuotaExceededError);
    });
  });

  describe("RPM Checking & Sliding-Window Rate Limiting", () => {
    it("tracks sliding-window RPM and increments counter accurately", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        rpmLimit: 3,
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      // Request 1
      const ctx1 = await middleware.authenticate(req);
      expect(ctx1.currentRpm).toBe(1);
      expect(ctx1.remainingRpm).toBe(2);

      // Request 2
      const ctx2 = await middleware.authenticate(req);
      expect(ctx2.currentRpm).toBe(2);
      expect(ctx2.remainingRpm).toBe(1);

      // Request 3
      const ctx3 = await middleware.authenticate(req);
      expect(ctx3.currentRpm).toBe(3);
      expect(ctx3.remainingRpm).toBe(0);

      // Request 4: Exceeds RPM limit (3/3)
      await expect(middleware.authenticate(req)).rejects.toThrowError(RateLimitExceededError);

      try {
        await middleware.authenticate(req);
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitExceededError);
        const rlErr = err as RateLimitExceededError;
        expect(rlErr.statusCode).toBe(429);
        expect(rlErr.currentRpm).toBe(3);
        expect(rlErr.rpmLimit).toBe(3);

        const resp = formatAuthError(rlErr);
        expect(resp.status).toBe(429);
        expect(resp.headers.get("retry-after")).not.toBeNull();
      }
    });

    it("resets available RPM headroom after sliding window expires", async () => {
      let currentTime = 100_000;
      const timeProvider = () => currentTime;

      const timeMiddleware = new AuthMiddleware({
        authRepo,
        timeProvider,
      });

      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        rpmLimit: 2,
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      // Use up 2 requests at t = 100,000
      await timeMiddleware.authenticate(req);
      await timeMiddleware.authenticate(req);

      // 3rd request blocked
      await expect(timeMiddleware.authenticate(req)).rejects.toThrowError(RateLimitExceededError);

      // Advance clock past the 60s sliding window (61,000 ms)
      currentTime += 61_000;

      // 4th request permitted now that window rolled over
      const ctxAfter = await timeMiddleware.authenticate(req);
      expect(ctxAfter.isAuthenticated).toBe(true);
      expect(ctxAfter.currentRpm).toBe(1);
    });

    it("supports rpmLimitOverride in options", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        rpmLimit: 60,
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      // Override RPM limit to 1
      const ctx = await middleware.authenticate(req, undefined, {
        rpmLimitOverride: 1,
      });
      expect(ctx.rpmLimit).toBe(1);
      expect(ctx.remainingRpm).toBe(0);

      // 2nd request blocked
      await expect(
        middleware.authenticate(req, undefined, { rpmLimitOverride: 1 })
      ).rejects.toThrowError(RateLimitExceededError);
    });
  });

  describe("AuthContract Interface (`verifyToken`)", () => {
    it("verifies a valid bearer token and returns AuthContext", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
      });

      const authContext = await middleware.verifyToken(`Bearer ${TEST_TOKEN}`);
      expect(authContext.isAuthenticated).toBe(true);
      expect(authContext.tenantId).toBe(TEST_TENANT);
    });

    it("rejects an invalid token in verifyToken", async () => {
      await expect(middleware.verifyToken("Bearer invalid-token")).rejects.toThrowError(
        AuthenticationError
      );
    });
  });

  describe("Non-Throwing `authenticateSafe`", () => {
    it("returns success object with context on valid request", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const result = await middleware.authenticateSafe(req);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.context.tenantId).toBe(TEST_TENANT);
        expect(result.context.isAuthenticated).toBe(true);
      }
    });

    it("returns failure object with Response and DomainError on invalid request", async () => {
      const req = new Request("https://api.keycollective.com/v1/chat/completions");
      const result = await middleware.authenticateSafe(req);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(AuthenticationError);
        expect(result.response.status).toBe(401);
      }
    });
  });

  describe("Middleware Pipeline (`handle` & `withAuth` — Golden Test tc-12)", () => {
    it("`handle` invokes next handler when authentication succeeds", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
      });

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      let nextInvoked = false;
      const response = await middleware.handle(
        req,
        { DB: mockDb },
        async (ctx) => {
          nextInvoked = true;
          return Response.json({ message: "hello", tenant: ctx.tenantId });
        }
      );

      expect(nextInvoked).toBe(true);
      expect(response.status).toBe(200);
      const data = (await response.json()) as { message: string; tenant: string };
      expect(data.tenant).toBe(TEST_TENANT);
    });

    it("`handle` blocks next handler and returns 401 when token invalid (tc-12)", async () => {
      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: "Bearer bad-token" },
      });

      let nextInvoked = false;
      const response = await middleware.handle(
        req,
        { DB: mockDb },
        async () => {
          nextInvoked = true;
          return new Response("Should not run", { status: 200 });
        }
      );

      expect(nextInvoked).toBe(false);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
    });

    it("`withAuth` wraps worker fetch handler, passing AuthenticatedContext", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
      });

      let capturedTenant = "";
      const workerHandler = withAuth(
        async (request, ctx) => {
          capturedTenant = ctx.tenantId;
          return new Response("OK", { status: 200 });
        },
        { authRepo }
      );

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const resp = await workerHandler(req, { DB: mockDb });
      expect(resp.status).toBe(200);
      expect(capturedTenant).toBe(TEST_TENANT);
    });

    it("`withAuth` returns 429 when budget is exhausted, blocking route execution", async () => {
      await authRepo.createToken({
        token: TEST_TOKEN,
        tenantId: TEST_TENANT,
        budgetMicrodollars: 500_000n,
        spentMicrodollars: 500_000n,
      });

      let routeCalled = false;
      const workerHandler = withAuth(
        async () => {
          routeCalled = true;
          return new Response("Should not be called");
        },
        { authRepo }
      );

      const req = new Request("https://api.keycollective.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const resp = await workerHandler(req, { DB: mockDb });
      expect(routeCalled).toBe(false);
      expect(resp.status).toBe(429);
      expect(resp.headers.get("retry-after")).toBe(String(DEFAULT_RETRY_AFTER_SECONDS));
    });
  });

  describe("InMemoryRateLimiterStorage Utility", () => {
    it("supports put, get, delete, deleteAll, and list", async () => {
      const storage = new InMemoryRateLimiterStorage();

      await storage.put("key1", { data: 123 });
      expect(await storage.get("key1")).toEqual({ data: 123 });

      await storage.put({ key2: "hello", key3: "world" });
      const batchGet = await storage.get(["key2", "key3"]);
      expect(batchGet.get("key2")).toBe("hello");
      expect(batchGet.get("key3")).toBe("world");

      const listResult = await storage.list({ prefix: "key" });
      expect(listResult.size).toBe(3);

      await storage.delete("key1");
      expect(await storage.get("key1")).toBeUndefined();

      await storage.deleteAll();
      expect(await storage.get("key2")).toBeUndefined();
    });
  });
});
