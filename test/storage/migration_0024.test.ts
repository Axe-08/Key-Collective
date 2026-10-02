import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Database Migration 0024_key_schema_contract.sql (T-7.4.2)", () => {
  const migrationPath = path.resolve(process.cwd(), "migrations/0024_key_schema_contract.sql");
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kc-migration-0024-"));
    dbPath = path.join(tmpDir, "test.db");

    const migrationsDir = path.resolve(process.cwd(), "migrations");
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql") && f < "0024_")
      .sort();

    for (const file of files) {
      const p = path.join(migrationsDir, file);
      runSql(fs.readFileSync(p, "utf-8"));
    }
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("applies 0024_key_schema_contract.sql cleanly and drops dispatched_today, dispatched_communal, vesting_tier from api_keys", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, "utf-8");
    expect(() => runSql(sql)).not.toThrow();

    const cols = queryJson<Array<{ name: string }>>("PRAGMA table_info(api_keys);").map((c) => c.name);
    expect(cols).not.toContain("dispatched_today");
    expect(cols).not.toContain("dispatched_communal");
    expect(cols).not.toContain("vesting_tier");
    expect(cols).toContain("id");
    expect(cols).toContain("status");
    expect(cols).toContain("pool_type");
  });
});
