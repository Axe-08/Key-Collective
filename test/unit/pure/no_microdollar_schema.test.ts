import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Schema Conformance — Contracted CU Schema (T-7.3.3)", () => {
  it("contracted D1 schema after all migrations up to 0023 has zero microdollar columns, tables, or views", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kc-schema-conformance-"));
    const dbPath = path.join(tmpDir, "test.db");

    try {
      const migrationsDir = path.resolve(process.cwd(), "migrations");
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql") && f <= "0023_z")
        .sort();

      for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
        execSync(`sqlite3 "${dbPath}"`, { input: sql, encoding: "utf-8" });
      }

      const schemaDump = execSync(`sqlite3 "${dbPath}" ".schema"`, {
        encoding: "utf-8",
      });

      // Only comments in 0001_initial_schema.sql may mention microdollars; strip SQL comments first
      const ddlWithoutComments = schemaDump
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");

      expect(ddlWithoutComments).not.toMatch(/microdollar|Microdollar/);
      expect(ddlWithoutComments).not.toMatch(/cost_microdollars/);
      expect(ddlWithoutComments).not.toMatch(/budget_microdollars/);
      expect(ddlWithoutComments).not.toMatch(/spent_microdollars/);
      expect(ddlWithoutComments).not.toMatch(/community_debt_micro_cu/);
      expect(ddlWithoutComments).not.toMatch(/daily_spend_rollup/);
      expect(ddlWithoutComments).not.toMatch(/cost_ledger_events|daily_spend_rollups|model_defs/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("no SQL query in src/storage/repositories/ or src/worker/ references dropped microdollar columns or tables", () => {
    const checkDirs = [
      path.resolve(process.cwd(), "src/storage/repositories"),
      path.resolve(process.cwd(), "src/worker"),
    ];

    const collectTsFiles = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          results.push(...collectTsFiles(full));
        } else if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".spec.ts")) {
          results.push(full);
        }
      }
      return results;
    };

    for (const dir of checkDirs) {
      for (const file of collectTsFiles(dir)) {
        const raw = fs.readFileSync(file, "utf-8");
        // Strip block and line comments
        const codeOnly = raw
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        expect(codeOnly).not.toMatch(/FROM\s+daily_spend_rollup/i);
        expect(codeOnly).not.toMatch(/INTO\s+daily_spend_rollup/i);
        expect(codeOnly).not.toMatch(/community_debt_micro_cu/);
      }
    }
  });
});
