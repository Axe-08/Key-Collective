import { describe, expect, it } from "vitest";
import { handleGetAnalyticsUsage } from "../../../src/worker/router/dashboard/metrics_routes";
import type { WorkerEnv } from "../../../src/worker/auth/types";

describe("Bounded 7-day live analytics rollup query (T-2.2.1)", () => {
  it("captures SQL passed to prepare and verifies it contains 7-day window condition", async () => {
    const preparedQueries: string[] = [];

    const mockDb = {
      prepare(query: string) {
        preparedQueries.push(query);
        const createStatement = () => ({
          bind(..._args: unknown[]) {
            return createStatement() as unknown as D1PreparedStatement;
          },
          all: async <T>() => ({
            results: [] as T[],
            success: true,
            meta: {} as D1Response["meta"],
          }),
          first: async <T>() => null as T | null,
          run: async () => ({ success: true, meta: {} as D1Response["meta"] }),
        });
        return createStatement() as unknown as D1PreparedStatement;
      },
      dump: async () => new ArrayBuffer(0),
      batch: async <T>() => [] as unknown as D1Result<T>[],
      exec: async () => ({ count: 0, duration: 0 }),
    } as unknown as D1Database;

    const env: WorkerEnv = { DB: mockDb };
    const response = await handleGetAnalyticsUsage(env, "tenant-123");
    expect(response.status).toBe(200);

    const costLedgerQuery = preparedQueries.find((q) => q.includes("FROM cost_ledger"));
    expect(costLedgerQuery).toBeDefined();
    expect(costLedgerQuery).toContain("created_at >= datetime('now', '-7 days')");
  });

  it("filters live cost_ledger records older than 8 days and returns only records within 7 days", async () => {
    interface LedgerRow {
      created_at: string;
      provider: string;
      model_id: string;
      prompt_tokens: number;
      completion_tokens: number;
      reasoning_tokens: number;
      cu: number;
      tenant_id: string;
    }

    const now = Date.now();
    const rows: LedgerRow[] = [
      {
        created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago (within 7 days)
        provider: "anthropic",
        model_id: "claude-3-5-sonnet",
        prompt_tokens: 100,
        completion_tokens: 50,
        reasoning_tokens: 0,
        cu: 150,
        tenant_id: "tenant-123",
      },
      {
        created_at: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(), // 9 days ago (older than 8 days)
        provider: "openai",
        model_id: "gpt-4o",
        prompt_tokens: 200,
        completion_tokens: 100,
        reasoning_tokens: 0,
        cu: 300,
        tenant_id: "tenant-123",
      },
    ];

    const mockDb = {
      prepare(query: string) {
        let boundTenant: string | undefined;

        const createStatement = () => ({
          bind(...args: unknown[]) {
            boundTenant = args[0] as string;
            return createStatement() as unknown as D1PreparedStatement;
          },
          all: async <T>() => {
            if (query.includes("FROM daily_cu_rollup")) {
              return { results: [] as T[], success: true, meta: {} as D1Response["meta"] };
            }
            if (query.includes("FROM cost_ledger")) {
              const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
              const filtered = rows.filter((r) => {
                if (boundTenant && r.tenant_id !== boundTenant) return false;
                if (query.includes("created_at >= datetime('now', '-7 days')")) {
                  return new Date(r.created_at).getTime() >= sevenDaysAgo;
                }
                return true;
              });

              const aggregated = filtered.map((r) => ({
                day: r.created_at.slice(0, 10),
                provider: r.provider === "google" ? "gemini" : r.provider,
                model: r.model_id,
                requests: 1,
                tokens: r.prompt_tokens + r.completion_tokens + r.reasoning_tokens,
                cu: r.cu,
              }));

              return {
                results: aggregated as unknown as T[],
                success: true,
                meta: {} as D1Response["meta"],
              };
            }
            return { results: [] as T[], success: true, meta: {} as D1Response["meta"] };
          },
          first: async <T>() => null as T | null,
          run: async () => ({ success: true, meta: {} as D1Response["meta"] }),
        });

        return createStatement() as unknown as D1PreparedStatement;
      },
      dump: async () => new ArrayBuffer(0),
      batch: async <T>() => [] as unknown as D1Result<T>[],
      exec: async () => ({ count: 0, duration: 0 }),
    } as unknown as D1Database;

    const env: WorkerEnv = { DB: mockDb };
    const response = await handleGetAnalyticsUsage(env, "tenant-123");
    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      usage: Array<{
        day: string;
        provider: string;
        model: string;
        requests: number;
        tokens: number;
        cu: number;
      }>;
    };

    expect(json.usage).toBeDefined();
    // Verify records older than 8 days (gpt-4o) are excluded
    expect(json.usage.some((u) => u.model === "gpt-4o")).toBe(false);
    // Verify records within 7-day window (claude-3-5-sonnet) are included
    expect(json.usage.some((u) => u.model === "claude-3-5-sonnet")).toBe(true);
    expect(json.usage).toHaveLength(1);
    expect(json.usage[0].cu).toBe(150);
  });
});
