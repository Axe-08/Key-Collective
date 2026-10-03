import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Database Migration 0023_credit_units_contract.sql (T-7.3.1)", () => {
  const migrationPath = path.resolve(process.cwd(), "migrations/0023_credit_units_contract.sql");
  let tmpDir: string;
  let dbPath: string;

  const runSql = (sql: string): string => {
    return execSync(`sqlite3 "${dbPath}"`, {
      input: sql,
      encoding: "utf-8",
    });
  };

  const queryJson = <T>(sql: string): T => {
    const raw = execSync(`sqlite3 -json "${dbPath}"`, {
      input: sql,
      encoding: "utf-8",
    });
    return raw.trim() ? JSON.parse(raw) : ([] as unknown as T);
  };

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kc-migration-0023-"));
    dbPath = path.join(tmpDir, "test.db");

    const migrationsDir = path.resolve(process.cwd(), "migrations");
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql") && f < "0023_")
      .sort();

    for (const file of files) {
      const p = path.join(migrationsDir, file);
      runSql(fs.readFileSync(p, "utf-8"));
    }

    // Seed a cost_ledger row with NULL cu before applying 0023
    runSql(`
      INSERT INTO cost_ledger (id, request_id, tenant_id, key_id, provider, model_id, prompt_tokens, completion_tokens, reasoning_tokens, cu, latency_ms, status_code)
      VALUES ('row_null_cu', 'req_1', 't1', 'k1', 'google', 'gemini-3.5-flash', 1000, 250, 0, NULL, 120, 200);
    `);
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("applies 0023_credit_units_contract.sql cleanly and backfills NULL cu", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, "utf-8");
    expect(() => runSql(sql)).not.toThrow();

    const rows = queryJson<Array<{ id: string; cu: number | null }>>(
      "SELECT id, cu FROM cost_ledger WHERE id = 'row_null_cu';"
    );
    expect(rows.length).toBe(1);
    // 10 + ceil(1000/1000) + ceil(250*4/1000) = 10 + 1 + 1 = 12
    expect(rows[0].cu).toBe(12);
  });

  it("drops microdollar columns from cost_ledger, auth_tokens, contributor_standing and drops daily_spend_rollup", () => {
    interface ColInfo {
      name: string;
    }
    const ledgerCols = queryJson<ColInfo[]>("PRAGMA table_info(cost_ledger);").map((c) => c.name);
    expect(ledgerCols).not.toContain("cost_microdollars");
    expect(ledgerCols).toContain("cu");

    const tokenCols = queryJson<ColInfo[]>("PRAGMA table_info(auth_tokens);").map((c) => c.name);
    expect(tokenCols).not.toContain("budget_microdollars");
    expect(tokenCols).not.toContain("spent_microdollars");
    expect(tokenCols).toContain("budget_cu");
    expect(tokenCols).toContain("spent_cu");

    const standingCols = queryJson<ColInfo[]>("PRAGMA table_info(contributor_standing);").map((c) => c.name);
    expect(standingCols).not.toContain("community_debt_micro_cu");
    expect(standingCols).toContain("community_debt_cu");

    const tables = queryJson<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name IN ('daily_spend_rollup', 'cost_ledger_events', 'daily_spend_rollups', 'model_defs');"
    );
    expect(tables.length).toBe(0);
  });
});
