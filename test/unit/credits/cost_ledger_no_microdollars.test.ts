import { describe, expect, it } from "vitest";
import {
  CostLedgerRepository,
  CostLedgerEventInput,
} from "../../../src/storage/repositories/cost_ledger/index";

/**
 * In-memory statement capturer mock to verify WP-6.5 requirements:
 * 1. INSERT into cost_ledger omits cost_microdollars (or sets NULL / lets D1 default handle it)
 *    and never names cost_microdollars in SQL.
 * 2. Does not reference or write to daily_spend_rollup.
 */
class CapturingD1PreparedStatement implements D1PreparedStatement {
  private boundParams: unknown[] = [];

  constructor(
    public readonly query: string,
    private readonly captured: { query: string; params: unknown[] }[]
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundParams = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.captured.push({ query: this.query, params: this.boundParams });
    return null;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.captured.push({ query: this.query, params: this.boundParams });
    return {
      success: true,
      meta: {
        changes: 1,
        duration: 1,
        size_after: 0,
        rows_read: 0,
        rows_written: 1,
        last_row_id: 0,
        changed_db: true,
      } as unknown as D1Meta,
      results: [],
    };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.captured.push({ query: this.query, params: this.boundParams });
    return {
      success: true,
      meta: {
        changes: 0,
        duration: 1,
        size_after: 0,
        rows_read: 0,
        rows_written: 0,
        last_row_id: 0,
        changed_db: false,
      } as unknown as D1Meta,
      results: [],
    };
  }

  raw<T = unknown[]>(): Promise<T[]> {
    throw new Error("raw not implemented");
  }
}

class CapturingD1Database implements D1Database {
  public capturedQueries: { query: string; params: unknown[] }[] = [];

  prepare(query: string): D1PreparedStatement {
    return new CapturingD1PreparedStatement(query, this.capturedQueries);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const stmt of statements) {
      results.push(await stmt.run<T>());
    }
    return results;
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error("dump not implemented");
  }

  async exec(_query: string): Promise<D1ExecResult> {
    throw new Error("exec not implemented");
  }
}

describe("WP-6.5 / T-6.5.1: CostLedgerRepository without microdollars or daily_spend_rollup", () => {
  it("recordEvent writes cost_ledger row without naming cost_microdollars in SQL", async () => {
    const db = new CapturingD1Database();
    const repo = new CostLedgerRepository(db);

    const input: CostLedgerEventInput = {
      requestId: "req_test_no_micro",
      tenantId: "tenant_alpha",
      keyId: "key_live_123",
      provider: "google",
      modelId: "gemini-1.5-flash",
      promptTokens: 100,
      completionTokens: 50,
      statusCode: 200,
      cu: 25n,
    };

    await repo.recordEvent(input);

    expect(db.capturedQueries.length).toBeGreaterThan(0);
    const ledgerInsert = db.capturedQueries.find((q) =>
      q.query.toUpperCase().includes("INSERT INTO COST_LEDGER")
    );
    expect(ledgerInsert).toBeDefined();

    // SQL statement MUST NOT name cost_microdollars
    expect(ledgerInsert!.query.toLowerCase()).not.toContain("cost_microdollars");
    // SQL statement MUST set cu
    expect(ledgerInsert!.query.toLowerCase()).toContain("cu");
  });

  it("recordEventWithRollup updates daily_cu_rollup and NEVER references daily_spend_rollup", async () => {
    const db = new CapturingD1Database();
    const repo = new CostLedgerRepository(db);

    const input: CostLedgerEventInput = {
      requestId: "req_test_rollup_no_spend",
      tenantId: "tenant_alpha",
      keyId: "key_live_123",
      provider: "groq",
      modelId: "llama-3.1-70b",
      promptTokens: 200,
      completionTokens: 80,
      statusCode: 200,
      cu: 50n,
    };

    await repo.recordEventWithRollup(input);

    const allQueries = db.capturedQueries.map((q) => q.query.toLowerCase()).join("\n");
    expect(allQueries).toContain("daily_cu_rollup");
    expect(allQueries).not.toContain("daily_spend_rollup");
    expect(allQueries).not.toContain("cost_microdollars");
  });
});
