import { describe, it, expect, vi } from "vitest";
import { TokenVerifier, hashToken } from "./auth";
import type { WorkerEnv } from "./env";

describe("TokenVerifier", () => {
  const TEST_TOKEN = "kc_test_token_abcdef123456";
  const TEST_TENANT = "tenant-test-42";

  function createMockEnv(rowsByHash: Map<string, Record<string, unknown>>): {
    mockEnv: WorkerEnv;
    boundParams: unknown[];
    prepareQuery: string | null;
  } {
    const boundParams: unknown[] = [];
    let prepareQuery: string | null = null;

    const mockD1 = {
      prepare: vi.fn((query: string) => {
        prepareQuery = query;
        return {
          bind: vi.fn((...params: unknown[]) => {
            boundParams.push(...params);
            const hash = String(params[0] ?? "");
            return {
              first: vi.fn(async () => {
                const row = rowsByHash.get(hash);
                return row ?? null;
              }),
            };
          }),
        };
      }),
    };

    const mockEnv = {
      D1_DB: mockD1,
    } as unknown as WorkerEnv;

    return { mockEnv, boundParams, prepareQuery };
  }

  it("returns isAuthenticated: true and correct tenantId for a valid token", async () => {
    const tokenHash = await hashToken(TEST_TOKEN);
    const rows = new Map<string, Record<string, unknown>>([
      [
        tokenHash,
        {
          id: "token-1",
          hash_sha256: tokenHash,
          tenant_id: TEST_TENANT,
        },
      ],
    ]);

    const { mockEnv, boundParams } = createMockEnv(rows);
    const verifier = new TokenVerifier(mockEnv);

    const result = await verifier.verifyToken(TEST_TOKEN);

    expect(result.isAuthenticated).toBe(true);
    expect(result.tenantId).toBe(TEST_TENANT);
    expect(boundParams[0]).toBe(tokenHash);
    expect(boundParams[0]).not.toBe(TEST_TOKEN);
  });

  it("handles bearer token prefixed with 'Bearer '", async () => {
    const tokenHash = await hashToken(TEST_TOKEN);
    const rows = new Map<string, Record<string, unknown>>([
      [
        tokenHash,
        {
          id: "token-1",
          hash_sha256: tokenHash,
          tenant_id: TEST_TENANT,
        },
      ],
    ]);

    const { mockEnv } = createMockEnv(rows);
    const verifier = new TokenVerifier(mockEnv);

    const result = await verifier.verifyToken(`Bearer ${TEST_TOKEN}`);

    expect(result.isAuthenticated).toBe(true);
    expect(result.tenantId).toBe(TEST_TENANT);
  });

  it("returns isAuthenticated: false for an invalid token", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const { mockEnv } = createMockEnv(rows);
    const verifier = new TokenVerifier(mockEnv);

    const result = await verifier.verifyToken("invalid_or_unknown_token");

    expect(result.isAuthenticated).toBe(false);
  });

  it("returns isAuthenticated: false for an expired token", async () => {
    const tokenHash = await hashToken(TEST_TOKEN);
    const rows = new Map<string, Record<string, unknown>>([
      [
        tokenHash,
        {
          id: "token-expired",
          hash_sha256: tokenHash,
          tenant_id: TEST_TENANT,
          expires_at: new Date(Date.now() - 100000).toISOString(),
        },
      ],
    ]);

    const { mockEnv } = createMockEnv(rows);
    const verifier = new TokenVerifier(mockEnv);

    const result = await verifier.verifyToken(TEST_TOKEN);

    expect(result.isAuthenticated).toBe(false);
  });

  it("returns isAuthenticated: false for empty or malformed token strings", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const { mockEnv } = createMockEnv(rows);
    const verifier = new TokenVerifier(mockEnv);

    expect((await verifier.verifyToken("")).isAuthenticated).toBe(false);
    expect((await verifier.verifyToken("   ")).isAuthenticated).toBe(false);
    expect((await verifier.verifyToken("Bearer ")).isAuthenticated).toBe(false);
  });

  it("supports fallback column token_hash and camelCase tenantId", async () => {
    const tokenHash = await hashToken(TEST_TOKEN);
    const rows = new Map<string, Record<string, unknown>>([
      [
        tokenHash,
        {
          id: "token-legacy",
          token_hash: tokenHash,
          tenantId: "tenant-camel-case",
        },
      ],
    ]);

    const { mockEnv } = createMockEnv(rows);
    const verifier = new TokenVerifier(mockEnv);

    const result = await verifier.verifyToken(TEST_TOKEN);

    expect(result.isAuthenticated).toBe(true);
    expect(result.tenantId).toBe("tenant-camel-case");
  });
});
