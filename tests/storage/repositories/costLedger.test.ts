/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: Cost Ledger & Daily Spend Rollup Repository (storage-repo-ledger)
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - Fixed-Point Microdollars: All financial costs in int64 / bigint microdollars.
 *   Zero floating-point math for financials.
 * - Per-Tenant Isolation: Queries enforce strict tenant_id boundaries.
 *   Zero cross-tenant state leakage.
 * - Strict TypeScript: No `any`, strict null checks.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  CostLedgerError,
  CostLedgerEvent,
  CostLedgerEventInput,
  CostLedgerRepository,
  DailySpendRollup,
  DailySpendRollupInput,
  InvalidCostLedgerEventError,
  TenantIsolationViolationError,
  calculateEventCostMicrodollars,
  formatCalendarDay,
  isCostLedgerEvent,
  isDailySpendRollup,
  validateMicrodollars,
} from "../../../src/storage/repositories/costLedger";

/**
 * Creates a fully populated D1Meta object satisfying Cloudflare Workers types.
 */
function createMeta(changes = 0): D1Meta & Record<string, unknown> {
  return {
    changes,
    duration: 1,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: 0,
    changed_db: changes > 0,
  };
}

/**
 * In-memory Mock D1 PreparedStatement for Cost Ledger testing.
 */
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

  async first<T = Record<string, unknown>>(_colName?: string): Promise<T | null> {
    const res = await this.all<T>();
    return res.results[0] ?? null;
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
    throw new Error("raw is not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    if (this.db.shouldFail) {
      throw new Error("Simulated D1 storage failure");
    }

    const trimmed = this.query.trim();
    const upper = trimmed.toUpperCase().replace(/\s+/g, " ");

    // 1. INSERT INTO cost_ledger
    if (upper.startsWith("INSERT INTO COST_LEDGER")) {
      const [
        id,
        request_id,
        tenant_id,
        key_id,
        provider,
        model_id,
        prompt_tokens,
        completion_tokens,
        cached_tokens,
        reasoning_tokens,
        cost_microdollars,
        latency_ms,
        status_code,
        created_at,
      ] = this.boundParams as [
        string,
        string,
        string,
        string,
        string,
        string,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        string
      ];

      this.db.ledgerRows.set(id, {
        id,
        request_id,
        tenant_id,
        key_id,
        provider,
        model_id,
        prompt_tokens,
        completion_tokens,
        cached_tokens,
        reasoning_tokens,
        cost_microdollars,
        latency_ms,
        status_code,
        created_at,
      });

      return {
        success: true,
        meta: createMeta(1),
        results: [],
      };
    }

    // 2. INSERT INTO daily_spend_rollup ... ON CONFLICT
    if (upper.startsWith("INSERT INTO DAILY_SPEND_ROLLUP")) {
      const [
        tenant_id,
        day,
        provider,
        model_id,
        requests_delta,
        tokens_delta,
        cost_delta,
      ] = this.boundParams as [
        string,
        string,
        string,
        string,
        number,
        number,
        number
      ];

      const key = `${tenant_id}:${day}:${provider}:${model_id}`;
      const existing = this.db.rollupRows.get(key);

      if (existing) {
        if (upper.includes("DO UPDATE SET TOTAL_REQUESTS = EXCLUDED.TOTAL_REQUESTS")) {
          // Overwrite mode (from reconciliation)
          existing.total_requests = requests_delta;
          existing.total_tokens = tokens_delta;
          existing.total_cost_microdollars = cost_delta;
        } else {
          // Increment mode (from standard upsert)
          existing.total_requests += requests_delta;
          existing.total_tokens += tokens_delta;
          existing.total_cost_microdollars += cost_delta;
        }
      } else {
        this.db.rollupRows.set(key, {
          tenant_id,
          day,
          provider,
          model_id,
          total_requests: requests_delta,
          total_tokens: tokens_delta,
          total_cost_microdollars: cost_delta,
        });
      }

      return {
        success: true,
        meta: createMeta(1),
        results: [],
      };
    }

    // 3. DELETE FROM daily_spend_rollup WHERE tenant_id = ? AND day = ?
    if (upper.startsWith("DELETE FROM DAILY_SPEND_ROLLUP")) {
      const [tenant_id, day] = this.boundParams as [string, string];
      let changes = 0;
      for (const [k, v] of this.db.rollupRows.entries()) {
        if (v.tenant_id === tenant_id && v.day === day) {
          this.db.rollupRows.delete(k);
          changes++;
        }
      }
      return {
        success: true,
        meta: createMeta(changes),
        results: [],
      };
    }

    // 4. SELECT * FROM cost_ledger WHERE tenant_id = ? AND id = ?
    if (upper.includes("FROM COST_LEDGER WHERE TENANT_ID = ? AND ID = ?")) {
      const [tenant_id, id] = this.boundParams as [string, string];
      const row = this.db.ledgerRows.get(id);
      const matched = row && row.tenant_id === tenant_id ? [row] : [];
      return {
        success: true,
        meta: createMeta(0),
        results: matched as unknown as T[],
      };
    }

    // 5. SELECT * FROM cost_ledger WHERE tenant_id = ? AND request_id = ?
    if (upper.includes("FROM COST_LEDGER WHERE TENANT_ID = ? AND REQUEST_ID = ?")) {
      const [tenant_id, request_id] = this.boundParams as [string, string];
      const matched = Array.from(this.db.ledgerRows.values()).filter(
        (r) => r.tenant_id === tenant_id && r.request_id === request_id
      );
      matched.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return {
        success: true,
        meta: createMeta(0),
        results: matched as unknown as T[],
      };
    }

    // 6. SELECT COUNT(*) as count FROM cost_ledger WHERE tenant_id = ?
    if (upper.startsWith("SELECT COUNT(*) AS COUNT FROM COST_LEDGER WHERE TENANT_ID = ?")) {
      const [tenant_id] = this.boundParams as [string];
      let rows = Array.from(this.db.ledgerRows.values()).filter(
        (r) => r.tenant_id === tenant_id
      );

      let paramIndex = 1;
      if (upper.includes("AND CREATED_AT >=")) {
        const since = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.created_at >= since);
      }
      if (upper.includes("AND CREATED_AT <=")) {
        const until = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.created_at <= until);
      }

      return {
        success: true,
        meta: createMeta(0),
        results: [{ count: rows.length }] as unknown as T[],
      };
    }

    // 7. Reconciliation aggregation: SELECT provider, model_id, COUNT(*) ... FROM cost_ledger WHERE tenant_id = ? AND substr(created_at, 1, 10) = ?
    if (
      upper.includes("FROM COST_LEDGER WHERE TENANT_ID = ? AND SUBSTR(CREATED_AT, 1, 10) = ? GROUP BY PROVIDER, MODEL_ID")
    ) {
      const [tenant_id, day] = this.boundParams as [string, string];
      const matching = Array.from(this.db.ledgerRows.values()).filter(
        (r) => r.tenant_id === tenant_id && r.created_at.slice(0, 10) === day
      );

      const groups = new Map<
        string,
        {
          provider: string;
          model_id: string;
          total_requests: number;
          total_tokens: number;
          total_cost_microdollars: number;
        }
      >();

      for (const r of matching) {
        const gKey = `${r.provider}:${r.model_id}`;
        const existing = groups.get(gKey);
        const tokens = r.prompt_tokens + r.completion_tokens + r.reasoning_tokens;
        if (existing) {
          existing.total_requests += 1;
          existing.total_tokens += tokens;
          existing.total_cost_microdollars += r.cost_microdollars;
        } else {
          groups.set(gKey, {
            provider: r.provider,
            model_id: r.model_id,
            total_requests: 1,
            total_tokens: tokens,
            total_cost_microdollars: r.cost_microdollars,
          });
        }
      }

      return {
        success: true,
        meta: createMeta(0),
        results: Array.from(groups.values()) as unknown as T[],
      };
    }

    // 8. General list from cost_ledger
    if (upper.startsWith("SELECT * FROM COST_LEDGER WHERE TENANT_ID = ?")) {
      const [tenant_id] = this.boundParams as [string];
      let rows = Array.from(this.db.ledgerRows.values()).filter(
        (r) => r.tenant_id === tenant_id
      );

      let paramIndex = 1;
      if (upper.includes("AND CREATED_AT >=")) {
        const since = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.created_at >= since);
      }
      if (upper.includes("AND CREATED_AT <=")) {
        const until = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.created_at <= until);
      }
      if (upper.includes("AND PROVIDER = ?")) {
        const provider = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.provider === provider);
      }
      if (upper.includes("AND MODEL_ID = ?")) {
        const modelId = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.model_id === modelId);
      }
      if (upper.includes("AND KEY_ID = ?")) {
        const keyId = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.key_id === keyId);
      }

      const isAsc = upper.includes("ORDER BY CREATED_AT ASC");
      rows.sort((a, b) =>
        isAsc
          ? a.created_at.localeCompare(b.created_at)
          : b.created_at.localeCompare(a.created_at)
      );

      if (upper.includes("LIMIT ?")) {
        const limit = this.boundParams[paramIndex++] as number;
        if (upper.includes("OFFSET ?")) {
          const offset = this.boundParams[paramIndex++] as number;
          rows = rows.slice(offset, offset + limit);
        } else {
          rows = rows.slice(0, limit);
        }
      }

      return {
        success: true,
        meta: createMeta(0),
        results: rows as unknown as T[],
      };
    }

    // 9. Spend summary aggregation from daily_spend_rollup
    if (upper.includes("FROM DAILY_SPEND_ROLLUP WHERE TENANT_ID = ?") && upper.includes("SUM(TOTAL_COST_MICRODOLLARS)")) {
      const [tenant_id] = this.boundParams as [string];
      let rows = Array.from(this.db.rollupRows.values()).filter(
        (r) => r.tenant_id === tenant_id
      );

      let paramIndex = 1;
      if (upper.includes("AND DAY >=")) {
        const start = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.day >= start);
      }
      if (upper.includes("AND DAY <=")) {
        const end = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.day <= end);
      }

      let totalCost = 0;
      let totalRequests = 0;
      let totalTokens = 0;

      for (const r of rows) {
        totalCost += r.total_cost_microdollars;
        totalRequests += r.total_requests;
        totalTokens += r.total_tokens;
      }

      return {
        success: true,
        meta: createMeta(0),
        results: [
          {
            total_cost: totalCost,
            total_requests: totalRequests,
            total_tokens: totalTokens,
          },
        ] as unknown as T[],
      };
    }

    // 10. General list from daily_spend_rollup
    if (upper.startsWith("SELECT * FROM DAILY_SPEND_ROLLUP WHERE TENANT_ID = ?")) {
      const [tenant_id] = this.boundParams as [string];
      let rows = Array.from(this.db.rollupRows.values()).filter(
        (r) => r.tenant_id === tenant_id
      );

      let paramIndex = 1;
      if (upper.includes("AND DAY >=")) {
        const start = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.day >= start);
      }
      if (upper.includes("AND DAY <=")) {
        const end = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.day <= end);
      }
      if (upper.includes("AND PROVIDER = ?")) {
        const provider = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.provider === provider);
      }
      if (upper.includes("AND MODEL_ID = ?")) {
        const modelId = this.boundParams[paramIndex++] as string;
        rows = rows.filter((r) => r.model_id === modelId);
      }

      const isAsc = upper.includes("ORDER BY DAY ASC");
      rows.sort((a, b) =>
        isAsc ? a.day.localeCompare(b.day) : b.day.localeCompare(a.day)
      );

      if (upper.includes("LIMIT ?")) {
        const limit = this.boundParams[paramIndex++] as number;
        if (upper.includes("OFFSET ?")) {
          const offset = this.boundParams[paramIndex++] as number;
          rows = rows.slice(offset, offset + limit);
        } else {
          rows = rows.slice(0, limit);
        }
      }

      return {
        success: true,
        meta: createMeta(0),
        results: rows as unknown as T[],
      };
    }

    throw new Error(`Mock D1 unhandled query pattern: ${this.query}`);
  }
}

/**
 * In-memory Mock implementation of Cloudflare D1Database for unit testing.
 */
class MockD1Database implements D1Database {
  public ledgerRows = new Map<
    string,
    {
      id: string;
      request_id: string;
      tenant_id: string;
      key_id: string;
      provider: string;
      model_id: string;
      prompt_tokens: number;
      completion_tokens: number;
      cached_tokens: number;
      reasoning_tokens: number;
      cost_microdollars: number;
      latency_ms: number;
      status_code: number;
      created_at: string;
    }
  >();

  public rollupRows = new Map<
    string,
    {
      tenant_id: string;
      day: string;
      provider: string;
      model_id: string;
      total_requests: number;
      total_tokens: number;
      total_cost_microdollars: number;
    }
  >();

  public shouldFail = false;

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    if (this.shouldFail) {
      throw new Error("Simulated D1 batch failure");
    }
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

describe("CostLedgerRepository & Financials (storage-repo-ledger)", () => {
  let mockDb: MockD1Database;
  let repo: CostLedgerRepository;

  const TENANT_A = "tenant_alpha";
  const TENANT_B = "tenant_bravo";

  beforeEach(() => {
    mockDb = new MockD1Database();
    repo = new CostLedgerRepository(mockDb);
  });

  describe("Constructor & Invariants", () => {
    it("instantiates repository successfully with valid D1Database", () => {
      expect(repo).toBeInstanceOf(CostLedgerRepository);
    });

    it("throws CostLedgerError if D1Database is missing", () => {
      expect(
        () => new CostLedgerRepository(null as unknown as D1Database)
      ).toThrow(CostLedgerError);
    });
  });

  describe("Validation & Financial Helpers", () => {
    describe("validateMicrodollars", () => {
      it("accepts valid BigInt microdollars", () => {
        expect(validateMicrodollars(0n)).toBe(0n);
        expect(validateMicrodollars(1_000_000n)).toBe(1_000_000n);
        expect(validateMicrodollars(450n)).toBe(450n);
      });

      it("accepts valid integer numbers and converts them to BigInt", () => {
        expect(validateMicrodollars(0)).toBe(0n);
        expect(validateMicrodollars(450)).toBe(450n);
        expect(validateMicrodollars(1000000)).toBe(1000000n);
      });

      it("rejects negative BigInt or number", () => {
        expect(() => validateMicrodollars(-1n)).toThrow(InvalidCostLedgerEventError);
        expect(() => validateMicrodollars(-500)).toThrow(InvalidCostLedgerEventError);
      });

      it("strictly forbids floating point numbers to prevent precision loss", () => {
        expect(() => validateMicrodollars(450.5)).toThrow(InvalidCostLedgerEventError);
        expect(() => validateMicrodollars(0.0001)).toThrow(InvalidCostLedgerEventError);
        expect(() => validateMicrodollars(1.23)).toThrow(InvalidCostLedgerEventError);
      });

      it("rejects non-finite numbers (NaN, Infinity)", () => {
        expect(() => validateMicrodollars(Number.NaN)).toThrow(InvalidCostLedgerEventError);
        expect(() => validateMicrodollars(Number.POSITIVE_INFINITY)).toThrow(InvalidCostLedgerEventError);
      });

      it("rejects non-numeric inputs", () => {
        expect(() => validateMicrodollars("100" as unknown as number)).toThrow(
          InvalidCostLedgerEventError
        );
      });
    });

    describe("formatCalendarDay", () => {
      it("formats valid Date instances into YYYY-MM-DD", () => {
        const date = new Date("2026-09-09T18:30:00.000Z");
        expect(formatCalendarDay(date)).toBe("2026-09-09");
      });

      it("normalizes and trims YYYY-MM-DD strings", () => {
        expect(formatCalendarDay("2026-09-09")).toBe("2026-09-09");
        expect(formatCalendarDay("2026-09-09T22:15:00.000Z")).toBe("2026-09-09");
      });

      it("throws InvalidCostLedgerEventError on invalid dates", () => {
        expect(() => formatCalendarDay(new Date("invalid"))).toThrow(
          InvalidCostLedgerEventError
        );
        expect(() => formatCalendarDay("invalid-date-string")).toThrow(
          InvalidCostLedgerEventError
        );
      });
    });

    describe("calculateEventCostMicrodollars", () => {
      it("calculates cost using fixed-point integer math with zero floating point", () => {
        // Pricing: $0.15/1M input ($150,000 µ$), $0.60/1M output ($600,000 µ$), $0.075/1M cached ($75,000 µ$)
        const pricing = {
          inputCostPerMTokMicro: 150_000n,
          outputCostPerMTokMicro: 600_000n,
          cacheReadCostPerMTokMicro: 75_000n,
        };

        // 1000 input tokens, 500 output tokens, 200 reasoning tokens, 400 cached tokens
        const cost = calculateEventCostMicrodollars(
          {
            promptTokens: 1000,
            completionTokens: 500,
            reasoningTokens: 200,
            cachedTokens: 400,
          },
          pricing
        );

        // Expected:
        // input: (1000 * 150,000) / 1,000,000 = 150 µ$
        // output: ((500 + 200) * 600,000) / 1,000,000 = 420 µ$
        // cached: (400 * 75,000) / 1,000,000 = 30 µ$
        // total: 150 + 420 + 30 = 600 µ$ ($0.000600 USD)
        expect(cost).toBe(600n);
      });
    });

    describe("Type Guards", () => {
      it("validates isCostLedgerEvent", () => {
        const validEvent: CostLedgerEvent = {
          id: "evt_1",
          requestId: "req_1",
          tenantId: "tenant_1",
          keyId: "key_1",
          provider: "openai",
          modelId: "gpt-4o",
          promptTokens: 10,
          completionTokens: 20,
          cachedTokens: 0,
          reasoningTokens: 0,
          costMicrodollars: 500n,
          latencyMs: 120,
          statusCode: 200,
          createdAt: "2026-09-09T20:00:00.000Z",
        };

        expect(isCostLedgerEvent(validEvent)).toBe(true);
        expect(isCostLedgerEvent(null)).toBe(false);
        expect(isCostLedgerEvent({})).toBe(false);
        expect(isCostLedgerEvent({ ...validEvent, costMicrodollars: "invalid" })).toBe(false);
      });

      it("validates isDailySpendRollup", () => {
        const validRollup: DailySpendRollup = {
          tenantId: "tenant_1",
          day: "2026-09-09",
          provider: "openai",
          modelId: "gpt-4o",
          totalRequests: 5,
          totalTokens: 500,
          totalCostMicrodollars: 2500n,
        };

        expect(isDailySpendRollup(validRollup)).toBe(true);
        expect(isDailySpendRollup(null)).toBe(false);
        expect(isDailySpendRollup({})).toBe(false);
        expect(isDailySpendRollup({ ...validRollup, day: 123 })).toBe(false);
      });
    });
  });

  describe("recordEvent", () => {
    it("records a valid event with all metrics and explicit ID", async () => {
      const input: CostLedgerEventInput = {
        id: "evt_explicit_1",
        requestId: "req_abc_123",
        tenantId: TENANT_A,
        keyId: "key_gemini_prod",
        provider: "google",
        modelId: "gemini-2.0-flash",
        promptTokens: 1200,
        completionTokens: 350,
        cachedTokens: 200,
        reasoningTokens: 50,
        costMicrodollars: 450n,
        latencyMs: 180,
        statusCode: 200,
        createdAt: "2026-09-09T21:00:00.000Z",
      };

      const event = await repo.recordEvent(input);

      expect(event.id).toBe("evt_explicit_1");
      expect(event.tenantId).toBe(TENANT_A);
      expect(event.provider).toBe("google");
      expect(event.modelId).toBe("gemini-2.0-flash");
      expect(event.costMicrodollars).toBe(450n);
      expect(event.promptTokens).toBe(1200);
      expect(event.reasoningTokens).toBe(50);
      expect(event.statusCode).toBe(200);

      // Verify row in database
      const dbRow = mockDb.ledgerRows.get("evt_explicit_1");
      expect(dbRow).toBeDefined();
      expect(dbRow?.cost_microdollars).toBe(450);
    });

    it("auto-generates UUID and timestamps if omitted", async () => {
      const input: CostLedgerEventInput = {
        requestId: "req_auto_1",
        tenantId: TENANT_A,
        keyId: "key_openai_1",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollars: 1200n,
        statusCode: 200,
      };

      const event = await repo.recordEvent(input);

      expect(event.id).toBeDefined();
      expect(typeof event.id).toBe("string");
      expect(event.createdAt).toBeDefined();
      expect(event.promptTokens).toBe(0);
      expect(event.completionTokens).toBe(0);
      expect(event.cachedTokens).toBe(0);
      expect(event.reasoningTokens).toBe(0);
      expect(event.latencyMs).toBe(0);
    });

    it("converts integer number costMicrodollars to BigInt seamlessly", async () => {
      const input: CostLedgerEventInput = {
        requestId: "req_num_1",
        tenantId: TENANT_A,
        keyId: "key_openai_1",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollars: 500, // integer number
        statusCode: 200,
      };

      const event = await repo.recordEvent(input);
      expect(event.costMicrodollars).toBe(500n);
    });

    it("enforces tenant boundary invariants and rejects empty tenantId", async () => {
      const input: CostLedgerEventInput = {
        requestId: "req_1",
        tenantId: "   ",
        keyId: "key_1",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollars: 100n,
        statusCode: 200,
      };

      await expect(repo.recordEvent(input)).rejects.toThrow(TenantIsolationViolationError);
    });

    it("rejects missing or empty required string fields", async () => {
      const base: CostLedgerEventInput = {
        requestId: "req_1",
        tenantId: TENANT_A,
        keyId: "key_1",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollars: 100n,
        statusCode: 200,
      };

      await expect(repo.recordEvent({ ...base, requestId: "" })).rejects.toThrow(
        InvalidCostLedgerEventError
      );
      await expect(repo.recordEvent({ ...base, keyId: "" })).rejects.toThrow(
        InvalidCostLedgerEventError
      );
      await expect(repo.recordEvent({ ...base, provider: "" })).rejects.toThrow(
        InvalidCostLedgerEventError
      );
      await expect(repo.recordEvent({ ...base, modelId: "" })).rejects.toThrow(
        InvalidCostLedgerEventError
      );
    });

    it("rejects invalid status codes", async () => {
      const base: CostLedgerEventInput = {
        requestId: "req_1",
        tenantId: TENANT_A,
        keyId: "key_1",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollars: 100n,
        statusCode: 99,
      };

      await expect(repo.recordEvent(base)).rejects.toThrow(InvalidCostLedgerEventError);
      await expect(repo.recordEvent({ ...base, statusCode: 600 })).rejects.toThrow(
        InvalidCostLedgerEventError
      );
    });

    it("wraps underlying database failures in CostLedgerError", async () => {
      mockDb.shouldFail = true;

      const input: CostLedgerEventInput = {
        requestId: "req_fail",
        tenantId: TENANT_A,
        keyId: "key_1",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollars: 100n,
        statusCode: 200,
      };

      await expect(repo.recordEvent(input)).rejects.toThrow(CostLedgerError);
    });
  });

  describe("recordBatch", () => {
    it("returns empty array when input is empty", async () => {
      const result = await repo.recordBatch([]);
      expect(result).toEqual([]);
    });

    it("records multiple events atomically in a single batch", async () => {
      const inputs: CostLedgerEventInput[] = [
        {
          id: "batch_1",
          requestId: "req_b1",
          tenantId: TENANT_A,
          keyId: "key_1",
          provider: "openai",
          modelId: "gpt-4o",
          costMicrodollars: 100n,
          statusCode: 200,
        },
        {
          id: "batch_2",
          requestId: "req_b2",
          tenantId: TENANT_A,
          keyId: "key_1",
          provider: "openai",
          modelId: "gpt-4o",
          costMicrodollars: 200n,
          statusCode: 200,
        },
      ];

      const events = await repo.recordBatch(inputs);

      expect(events).toHaveLength(2);
      expect(events[0]?.id).toBe("batch_1");
      expect(events[1]?.id).toBe("batch_2");
      expect(mockDb.ledgerRows.size).toBe(2);
    });

    it("throws CostLedgerError if batch execution fails", async () => {
      mockDb.shouldFail = true;

      const inputs: CostLedgerEventInput[] = [
        {
          requestId: "req_b1",
          tenantId: TENANT_A,
          keyId: "key_1",
          provider: "openai",
          modelId: "gpt-4o",
          costMicrodollars: 100n,
          statusCode: 200,
        },
      ];

      await expect(repo.recordBatch(inputs)).rejects.toThrow(CostLedgerError);
    });
  });

  describe("recordEventWithRollup", () => {
    it("atomically records ledger event and increments daily rollup in one transaction", async () => {
      const input: CostLedgerEventInput = {
        id: "evt_atomic_1",
        requestId: "req_atomic_1",
        tenantId: TENANT_A,
        keyId: "key_1",
        provider: "openai",
        modelId: "gpt-4o-mini",
        promptTokens: 400,
        completionTokens: 100,
        reasoningTokens: 50,
        costMicrodollars: 250n,
        statusCode: 200,
        createdAt: "2026-09-09T10:00:00.000Z",
      };

      const event = await repo.recordEventWithRollup(input);
      expect(event.id).toBe("evt_atomic_1");

      // Verify ledger table
      expect(mockDb.ledgerRows.has("evt_atomic_1")).toBe(true);

      // Verify rollup table
      const rollups = await repo.getDailyRollups(TENANT_A, { startDate: "2026-09-09" });
      expect(rollups).toHaveLength(1);
      expect(rollups[0]?.day).toBe("2026-09-09");
      expect(rollups[0]?.totalRequests).toBe(1);
      expect(rollups[0]?.totalTokens).toBe(550); // 400 + 100 + 50
      expect(rollups[0]?.totalCostMicrodollars).toBe(250n);
    });

    it("accumulates rollups across multiple calls for same tenant and model", async () => {
      const input1: CostLedgerEventInput = {
        requestId: "req_1",
        tenantId: TENANT_A,
        keyId: "key_1",
        provider: "openai",
        modelId: "gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        costMicrodollars: 300n,
        statusCode: 200,
        createdAt: "2026-09-09T10:00:00.000Z",
      };

      const input2: CostLedgerEventInput = {
        requestId: "req_2",
        tenantId: TENANT_A,
        keyId: "key_1",
        provider: "openai",
        modelId: "gpt-4o",
        promptTokens: 200,
        completionTokens: 100,
        costMicrodollars: 600n,
        statusCode: 200,
        createdAt: "2026-09-09T14:00:00.000Z",
      };

      await repo.recordEventWithRollup(input1);
      await repo.recordEventWithRollup(input2);

      const rollups = await repo.getDailyRollups(TENANT_A, { startDate: "2026-09-09" });
      expect(rollups).toHaveLength(1);
      expect(rollups[0]?.totalRequests).toBe(2);
      expect(rollups[0]?.totalTokens).toBe(450); // 150 + 300
      expect(rollups[0]?.totalCostMicrodollars).toBe(900n); // 300 + 600
    });
  });

  describe("getEventById & Strict Tenant Isolation", () => {
    beforeEach(async () => {
      await repo.recordEvent({
        id: "evt_alpha",
        requestId: "req_alpha",
        tenantId: TENANT_A,
        keyId: "key_1",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollars: 100n,
        statusCode: 200,
      });

      await repo.recordEvent({
        id: "evt_bravo",
        requestId: "req_bravo",
        tenantId: TENANT_B,
        keyId: "key_2",
        provider: "anthropic",
        modelId: "claude-3-5-sonnet",
        costMicrodollars: 200n,
        statusCode: 200,
      });
    });

    it("returns event when tenant owns it", async () => {
      const event = await repo.getEventById(TENANT_A, "evt_alpha");
      expect(event).not.toBeNull();
      expect(event?.id).toBe("evt_alpha");
      expect(event?.tenantId).toBe(TENANT_A);
    });

    it("returns null if event does not exist", async () => {
      const event = await repo.getEventById(TENANT_A, "non_existent");
      expect(event).toBeNull();
    });

    it("STRICT TENANT ISOLATION: prevents Tenant A from reading Tenant B's event by ID", async () => {
      const event = await repo.getEventById(TENANT_A, "evt_bravo");
      expect(event).toBeNull();
    });
  });

  describe("getEventsByRequestId", () => {
    it("returns all events associated with a request ID for tenant", async () => {
      await repo.recordEvent({
        id: "evt_r1_1",
        requestId: "req_retry",
        tenantId: TENANT_A,
        keyId: "key_1",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollars: 100n,
        statusCode: 429,
        createdAt: "2026-09-09T10:00:00.000Z",
      });

      await repo.recordEvent({
        id: "evt_r1_2",
        requestId: "req_retry",
        tenantId: TENANT_A,
        keyId: "key_2",
        provider: "google",
        modelId: "gemini-2.0-flash",
        costMicrodollars: 120n,
        statusCode: 200,
        createdAt: "2026-09-09T10:00:01.000Z",
      });

      const events = await repo.getEventsByRequestId(TENANT_A, "req_retry");
      expect(events).toHaveLength(2);
      expect(events[0]?.id).toBe("evt_r1_1");
      expect(events[1]?.id).toBe("evt_r1_2");
    });
  });

  describe("listEvents", () => {
    beforeEach(async () => {
      await repo.recordEvent({
        id: "evt_1",
        requestId: "req_1",
        tenantId: TENANT_A,
        keyId: "key_1",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollars: 100n,
        statusCode: 200,
        createdAt: "2026-09-01T12:00:00.000Z",
      });

      await repo.recordEvent({
        id: "evt_2",
        requestId: "req_2",
        tenantId: TENANT_A,
        keyId: "key_2",
        provider: "google",
        modelId: "gemini-2.0-flash",
        costMicrodollars: 200n,
        statusCode: 200,
        createdAt: "2026-09-05T12:00:00.000Z",
      });

      await repo.recordEvent({
        id: "evt_3",
        requestId: "req_3",
        tenantId: TENANT_A,
        keyId: "key_1",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollars: 300n,
        statusCode: 200,
        createdAt: "2026-09-09T12:00:00.000Z",
      });

      // Tenant B event
      await repo.recordEvent({
        id: "evt_b_1",
        requestId: "req_b",
        tenantId: TENANT_B,
        keyId: "key_3",
        provider: "anthropic",
        modelId: "claude-3-5-sonnet",
        costMicrodollars: 500n,
        statusCode: 200,
        createdAt: "2026-09-09T12:00:00.000Z",
      });
    });

    it("lists events scoped to tenant in DESC order by default", async () => {
      const events = await repo.listEvents(TENANT_A);
      expect(events).toHaveLength(3);
      expect(events[0]?.id).toBe("evt_3");
      expect(events[2]?.id).toBe("evt_1");
    });

    it("filters events by date range (since and until)", async () => {
      const events = await repo.listEvents(TENANT_A, {
        since: "2026-09-04T00:00:00.000Z",
        until: "2026-09-06T00:00:00.000Z",
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.id).toBe("evt_2");
    });

    it("filters events by provider and modelId", async () => {
      const events = await repo.listEvents(TENANT_A, {
        provider: "google",
        modelId: "gemini-2.0-flash",
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.id).toBe("evt_2");
    });

    it("filters events by keyId via getEventsByKey helper", async () => {
      const events = await repo.getEventsByKey(TENANT_A, "key_1");
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.keyId === "key_1")).toBe(true);
    });

    it("paginates events via limit and offset", async () => {
      const page1 = await repo.listEvents(TENANT_A, { limit: 2, offset: 0 });
      const page2 = await repo.listEvents(TENANT_A, { limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
      expect(page1[0]?.id).toBe("evt_3");
      expect(page2[0]?.id).toBe("evt_1");
    });
  });

  describe("Daily Spend Rollups", () => {
    it("upserts daily rollup with explicit deltas", async () => {
      const input: DailySpendRollupInput = {
        tenantId: TENANT_A,
        day: "2026-09-09",
        provider: "openai",
        modelId: "gpt-4o",
        requestsDelta: 5,
        tokensDelta: 1000,
        costMicrodollarsDelta: 15000n,
      };

      await repo.upsertDailyRollup(input);

      const rollups = await repo.getDailyRollups(TENANT_A);
      expect(rollups).toHaveLength(1);
      expect(rollups[0]?.totalRequests).toBe(5);
      expect(rollups[0]?.totalTokens).toBe(1000);
      expect(rollups[0]?.totalCostMicrodollars).toBe(15000n);
    });

    it("filters rollups by startDate and endDate", async () => {
      await repo.upsertDailyRollup({
        tenantId: TENANT_A,
        day: "2026-09-01",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollarsDelta: 1000n,
      });

      await repo.upsertDailyRollup({
        tenantId: TENANT_A,
        day: "2026-09-09",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollarsDelta: 2000n,
      });

      const filtered = await repo.getDailyRollups(TENANT_A, {
        startDate: "2026-09-05",
        endDate: "2026-09-10",
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.day).toBe("2026-09-09");
    });

    it("calculates tenant spend summary over timeframe", async () => {
      await repo.upsertDailyRollup({
        tenantId: TENANT_A,
        day: "2026-09-01",
        provider: "openai",
        modelId: "gpt-4o",
        requestsDelta: 10,
        tokensDelta: 5000,
        costMicrodollarsDelta: 25_000n,
      });

      await repo.upsertDailyRollup({
        tenantId: TENANT_A,
        day: "2026-09-02",
        provider: "google",
        modelId: "gemini-2.0-flash",
        requestsDelta: 20,
        tokensDelta: 10000,
        costMicrodollarsDelta: 35_000n,
      });

      const summary = await repo.getTenantSpendSummary(TENANT_A);
      expect(summary.totalRequests).toBe(30);
      expect(summary.totalTokens).toBe(15000);
      expect(summary.totalCostMicrodollars).toBe(60_000n);

      const totalMicro = await repo.getTenantTotalSpendMicrodollars(TENANT_A);
      expect(totalMicro).toBe(60_000n);
    });
  });

  describe("Reconciliation & Auditability (reconcileDailyRollupFromLedger)", () => {
    it("rebuilds daily_spend_rollup from raw immutable cost_ledger records", async () => {
      // Create 3 ledger events on the same day for Tenant A
      await repo.recordEvent({
        requestId: "req_rec_1",
        tenantId: TENANT_A,
        keyId: "k1",
        provider: "openai",
        modelId: "gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        costMicrodollars: 300n,
        statusCode: 200,
        createdAt: "2026-09-09T08:00:00.000Z",
      });

      await repo.recordEvent({
        requestId: "req_rec_2",
        tenantId: TENANT_A,
        keyId: "k1",
        provider: "openai",
        modelId: "gpt-4o",
        promptTokens: 200,
        completionTokens: 100,
        costMicrodollars: 600n,
        statusCode: 200,
        createdAt: "2026-09-09T12:00:00.000Z",
      });

      await repo.recordEvent({
        requestId: "req_rec_3",
        tenantId: TENANT_A,
        keyId: "k2",
        provider: "google",
        modelId: "gemini-2.0-flash",
        promptTokens: 500,
        completionTokens: 250,
        costMicrodollars: 400n,
        statusCode: 200,
        createdAt: "2026-09-09T16:00:00.000Z",
      });

      // Rollup table starts empty or outdated
      expect(mockDb.rollupRows.size).toBe(0);

      // Reconcile from ledger for 2026-09-09
      const reconciled = await repo.reconcileDailyRollupFromLedger(
        TENANT_A,
        "2026-09-09"
      );

      expect(reconciled).toHaveLength(2);

      const openaiRollup = reconciled.find((r) => r.provider === "openai");
      expect(openaiRollup?.totalRequests).toBe(2);
      expect(openaiRollup?.totalTokens).toBe(450);
      expect(openaiRollup?.totalCostMicrodollars).toBe(900n);

      const googleRollup = reconciled.find((r) => r.provider === "google");
      expect(googleRollup?.totalRequests).toBe(1);
      expect(googleRollup?.totalTokens).toBe(750);
      expect(googleRollup?.totalCostMicrodollars).toBe(400n);
    });
  });

  describe("countEvents", () => {
    it("returns correct count of events for tenant", async () => {
      expect(await repo.countEvents(TENANT_A)).toBe(0);

      await repo.recordEvent({
        requestId: "req_c1",
        tenantId: TENANT_A,
        keyId: "k1",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollars: 100n,
        statusCode: 200,
      });

      await repo.recordEvent({
        requestId: "req_c2",
        tenantId: TENANT_A,
        keyId: "k1",
        provider: "openai",
        modelId: "gpt-4o",
        costMicrodollars: 100n,
        statusCode: 200,
      });

      expect(await repo.countEvents(TENANT_A)).toBe(2);
      expect(await repo.countEvents(TENANT_B)).toBe(0);
    });
  });
});
