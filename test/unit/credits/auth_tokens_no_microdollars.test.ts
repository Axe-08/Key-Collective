import { describe, expect, it } from "vitest";
import { AuthTokensRepository } from "../../../src/storage/repositories/auth_tokens/repository";

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

describe("WP-6.5 / T-6.5.2: AuthTokenRepository without microdollars", () => {
  it("createToken writes auth_tokens row without naming budget_microdollars or spent_microdollars in SQL", async () => {
    const db = new CapturingD1Database();
    const repo = new AuthTokensRepository(db, "0123456789abcdef0123456789abcdef");

    await repo.createToken({
      tenantId: "tenant_alpha",
      token: "kc_tok_live_12345678901234567890",
      allowedProviders: ["google", "groq"],
      rpmLimit: 60,
      budgetCu: 1000n,
    });

    expect(db.capturedQueries.length).toBeGreaterThan(0);
    const tokenInsert = db.capturedQueries.find((q) =>
      q.query.toUpperCase().includes("INSERT INTO AUTH_TOKENS")
    );
    expect(tokenInsert).toBeDefined();

    // SQL statement MUST NOT name budget_microdollars or spent_microdollars
    expect(tokenInsert!.query.toLowerCase()).not.toContain("budget_microdollars");
    expect(tokenInsert!.query.toLowerCase()).not.toContain("spent_microdollars");
    // SQL statement MUST set budget_cu
    expect(tokenInsert!.query.toLowerCase()).toContain("budget_cu");
  });
});
