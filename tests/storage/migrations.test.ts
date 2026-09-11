import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Database Migration 0003_v3_5_governance.sql", () => {
  const migrationPath = path.resolve(process.cwd(), "migrations/0003_v3_5_governance.sql");

  it("should have migration file existing and readable", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, "utf-8");
    expect(sql.length).toBeGreaterThan(0);
  });

  it("should execute migration cleanly on SQLite D1 schema", () => {
    const migrationSql = fs.readFileSync(migrationPath, "utf-8");
    const commands = [
      "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, tier TEXT DEFAULT 'probationary', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
      migrationSql,
      "PRAGMA table_info(users);",
      "PRAGMA table_info(audit_logs);",
      "INSERT INTO users (id, email, sybil_score, auth_phase, role) VALUES ('usr_001', 'dev@keycol.internal', 85, 2, 'builder');",
      "INSERT INTO audit_logs (user_id, action, ip_address) VALUES ('usr_001', 'PHASE_2_ELEVATION', '192.168.1.1');",
      "SELECT id, email, sybil_score, auth_phase, role FROM users WHERE id = 'usr_001';",
      "SELECT user_id, action, ip_address FROM audit_logs WHERE user_id = 'usr_001';"
    ];

    const input = commands.join("\n");
    const output = execSync("sqlite3 :memory:", {
      input,
      encoding: "utf-8",
    });

    // Check users table columns from PRAGMA table_info
    expect(output).toContain("sybil_score");
    expect(output).toContain("auth_phase");
    expect(output).toContain("role");

    // Check audit_logs table columns from PRAGMA table_info
    expect(output).toContain("user_id");
    expect(output).toContain("action");
    expect(output).toContain("ip_address");
    expect(output).toContain("timestamp");

    // Check inserted records output
    expect(output).toContain("usr_001|dev@keycol.internal|85|2|builder");
    expect(output).toContain("usr_001|PHASE_2_ELEVATION|192.168.1.1");
  });
});
