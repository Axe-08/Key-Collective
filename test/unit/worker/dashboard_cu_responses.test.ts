import { describe, expect, it } from "vitest";
import { handleGetStats } from "../../../src/worker/router/dashboard/metrics_routes";
import { handlePoolRoute } from "../../../src/worker/pool_routes";
import { PoolStatsSchema } from "../../../src/contracts/api/responses";
import type { WorkerEnv } from "../../../src/worker/auth/types";
import type { KeyPoolContract } from "../../../src/contracts/key_pool";

describe("Dashboard CU responses and microdollar purge", () => {
  function createMockEnv(): WorkerEnv {
    const mockDb: D1Database = {
      prepare(query: string) {
        const createStatement = () => ({
          first: async <T>(): Promise<T | null> => {
            if (query.includes("SELECT registration_status, is_quarantined, community_eligible FROM users")) {
              return { registration_status: "ACTIVE", is_quarantined: 0, community_eligible: 1 } as unknown as T;
            }
            if (query.includes("dispatched_communal") && query.includes("FROM api_keys")) {
              return {
                total_keys: 4,
                community_active_keys: 3,
                total_dispatched_today: 100,
                total_communal_served: 40,
              } as unknown as T;
            }
            if (query.includes("FROM api_keys")) {
              return {
                total_count: 4,
                healthy_count: 3,
                rate_limited_count: 1,
                invalid_count: 0,
                rpm_sum: 120,
                rpd_sum: 5000,
              } as unknown as T;
            }
            if (query.includes("FROM cost_ledger") && query.includes("cu_sum")) {
              return {
                requests_today: 42,
                avg_lat: 85,
                cu_sum: 1250,
              } as unknown as T;
            }
            if (query.includes("FROM auth_tokens")) {
              return {
                total_budget_cu: 10000,
              } as unknown as T;
            }
            if (query.includes("FROM contributor_standing")) {
              return {
                community_debt_cu: 350,
                community_debt_micro_cu: 350,
                daily_contributed_cu: 1000,
                consecutive_debt_free_days: 5,
                trusted_contributor: 1,
                multiplier_ceiling: 450,
                current_multiplier: 200,
              } as unknown as T;
            }
            return null;
          },
          all: async <T>(): Promise<D1Result<T>> => {
            if (query.includes("SELECT provider FROM user_identities")) {
              return { results: [{ provider: "google" }, { provider: "github" }] as unknown as T[], success: true, meta: {} as D1Response["meta"] };
            }
            return { results: [], success: true, meta: {} } as unknown as D1Result<T>;
          },
          run: async (): Promise<D1Response> => {
            return { success: true, meta: {} } as unknown as D1Response;
          },
        });

        return {
          ...createStatement(),
          bind(..._args: unknown[]) {
            return createStatement() as unknown as D1PreparedStatement;
          },
        } as unknown as D1PreparedStatement;
      },
      dump: async () => new ArrayBuffer(0),
      batch: async <T>() => [] as unknown as D1Result<T>[],
      exec: async () => ({ count: 0, duration: 0 }),
    };

    return {
      DB: mockDb,
    };
  }

  const mockGetKeyPool = (): KeyPoolContract => ({
    getKey: async () => "key-123",
    recordUsage: async () => {},
    recordResult: async () => {},
  });

  describe("handleGetStats (/api/stats)", () => {
    it("reports CU fields and removes total_spend_today_microdollars", async () => {
      const env = createMockEnv();
      const response = await handleGetStats(env, "tenant_alpha", mockGetKeyPool);
      expect(response.status).toBe(200);

      const json = (await response.json()) as Record<string, unknown>;

      // Validates schema contract
      const parsed = PoolStatsSchema.parse(json);
      expect(parsed.cu_used_today).toBe(1250);
      expect(parsed.cu_allowance_today).toBe(10000);

      // Invariant: No microdollar or dollar fields in stats payload
      expect("total_spend_today_microdollars" in json).toBe(false);
      const keysWithDollar = Object.keys(json).filter((k) =>
        k.toLowerCase().includes("dollar")
      );
      expect(keysWithDollar).toEqual([]);
      const keysWithMicro = Object.keys(json).filter((k) =>
        k.toLowerCase().includes("microdollar")
      );
      expect(keysWithMicro).toEqual([]);
    });

    it("reports zero CU fields for unauthenticated or guest users without dollar fields", async () => {
      const env = createMockEnv();
      const response = await handleGetStats(env, "anonymous", mockGetKeyPool);
      expect(response.status).toBe(200);

      const json = (await response.json()) as Record<string, unknown>;
      const parsed = PoolStatsSchema.parse(json);
      expect(parsed.cu_used_today).toBe(0);
      expect(parsed.cu_allowance_today).toBe(0);
      expect("total_spend_today_microdollars" in json).toBe(false);
      expect(Object.keys(json).filter((k) => k.toLowerCase().includes("dollar"))).toEqual([]);
    });
  });

  describe("handlePoolRoute (/api/pool/*)", () => {
    it("handlePoolStanding reports CU standing and balance fields with no dollar or micro_cu fields", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/pool/standing");
      const ctx = { waitUntil: () => {} };

      const response = await handlePoolRoute(
        "/api/pool/standing",
        "GET",
        req,
        env,
        "tenant_alpha",
        ctx
      );
      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);

      const json = (await response!.json()) as Record<string, unknown>;

      expect(json.community_debt_cu).toBe(350);
      expect(json.daily_contributed_cu).toBe(1000);
      expect(json.cu_contributed_today).toBe(1000);
      expect(json.cu_consumed_today).toBe(350);
      expect(json.net_cu_balance).toBe(650);

      expect("community_debt_micro_cu" in json).toBe(false);
      expect(Object.keys(json).filter((k) => k.toLowerCase().includes("dollar"))).toEqual([]);
      expect(Object.keys(json).filter((k) => k.toLowerCase().includes("microdollar"))).toEqual([]);
    });

    it("handlePoolContribution reports CU contribution and debt fields with no dollar fields", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/pool/contribution");
      const ctx = { waitUntil: () => {} };

      const response = await handlePoolRoute(
        "/api/pool/contribution",
        "GET",
        req,
        env,
        "tenant_alpha",
        ctx
      );
      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);

      const json = (await response!.json()) as Record<string, unknown>;

      expect(json.community_debt_cu).toBe(350);
      expect(json.cu_contributed_today).toBe(1000);
      expect(json.cu_consumed_today).toBe(350);
      expect(json.net_cu_balance).toBe(650);
      expect(json.total_keys).toBe(4);
      expect(json.community_active_keys).toBe(3);

      expect("community_debt_micro_cu" in json).toBe(false);
      expect(Object.keys(json).filter((k) => k.toLowerCase().includes("dollar"))).toEqual([]);
      expect(Object.keys(json).filter((k) => k.toLowerCase().includes("microdollar"))).toEqual([]);
    });

    it("reports zero CU standing for unauthenticated users and refuses their contribution view", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/pool/standing");
      const ctx = { waitUntil: () => {} };

      const standingRes = await handlePoolRoute(
        "/api/pool/standing",
        "GET",
        req,
        env,
        "anonymous",
        ctx
      );
      expect(standingRes).not.toBeNull();
      const standingJson = (await standingRes!.json()) as Record<string, unknown>;
      expect(standingJson.community_debt_cu).toBe(0);
      expect(standingJson.cu_contributed_today).toBe(0);
      expect(standingJson.cu_consumed_today).toBe(0);
      expect(standingJson.net_cu_balance).toBe(0);
      expect("community_debt_micro_cu" in standingJson).toBe(false);

      const contribRes = await handlePoolRoute(
        "/api/pool/contribution",
        "GET",
        req,
        env,
        "anonymous",
        ctx
      );
      // Community contribution needs communityPool (WP-3.3), which an anonymous caller lacks.
      expect(contribRes).not.toBeNull();
      expect(contribRes!.status).toBe(403);
      expect(await contribRes!.json()).toEqual({ error: "github_link_required" });
    });
  });
});
