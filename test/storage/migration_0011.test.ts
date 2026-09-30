import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Database Migration 0011_security_hotfix.sql", () => {
  const migrationPath = path.resolve(process.cwd(), "migrations/0011_security_hotfix.sql");
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kc-migration-0011-"));
    dbPath = path.join(tmpDir, "test.db");

    // Apply baseline migrations 0001 through 0010
    const migrationsDir = path.resolve(process.cwd(), "migrations");
    const baselineFiles = [
      "0001_initial_schema.sql",
      "0002_v3_multi_project.sql",
      "0003_v3_5_governance.sql",
      "0004_v3_5_quarantine.sql",
      "0005_commons_pooling.sql",
      "0006_project_hash_registry.sql",
      "0007_contributor_standing.sql",
      "0008_abuse_ratelimit_cleanup.sql",
      "0009_hkdf_flag.sql",
      "0010_purge_all_keys.sql",
    ];

    for (const file of baselineFiles) {
      const p = path.join(migrationsDir, file);
      if (fs.existsSync(p)) {
        const sql = fs.readFileSync(p, "utf-8");
        runSql(sql);
      }
    }
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should have migration 0011 file present and non-empty", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, "utf-8");
    expect(sql.length).toBeGreaterThan(0);
    expect(sql).toContain("ALTER TABLE api_keys ADD COLUMN key_hash TEXT;");
    expect(sql).toContain("idx_api_keys_key_hash");
    expect(sql).toContain("ALTER TABLE api_keys ADD COLUMN revoked_at INTEGER;");
    expect(sql).toContain("admin_audit_logs");
  });

  it("should apply migration 0011 cleanly on top of baseline schema", () => {
    const migrationSql = fs.readFileSync(migrationPath, "utf-8");
    expect(() => runSql(migrationSql)).not.toThrow();
  });

  it("should verify key_hash and revoked_at columns exist on api_keys", () => {
    interface ColumnInfo {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }
    const cols = queryJson<ColumnInfo[]>("PRAGMA table_info(api_keys);");
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain("key_hash");
    expect(colNames).toContain("revoked_at");

    const keyHashCol = cols.find((c) => c.name === "key_hash");
    expect(keyHashCol?.type.toUpperCase()).toBe("TEXT");

    const revokedAtCol = cols.find((c) => c.name === "revoked_at");
    expect(revokedAtCol?.type.toUpperCase()).toBe("INTEGER");
  });

  it("should enforce uniqueness constraint on key_hash when not null", () => {
    // Inserting first key with key_hash should succeed
    runSql(`
      INSERT INTO api_keys (id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_prefix, key_suffix, key_hash)
      VALUES ('key_uniq_1', 'tenant_1', 'Label 1', 'openai', 'enc1', 'nonce1', 'sk-test', '1111', 'sha256_hash_value_1');
    `);

    // Multiple rows with NULL key_hash should be allowed (partial index: WHERE key_hash IS NOT NULL)
    expect(() => {
      runSql(`
        INSERT INTO api_keys (id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_prefix, key_suffix, key_hash)
        VALUES ('key_null_1', 'tenant_1', 'Null Hash 1', 'openai', 'enc2', 'nonce2', 'sk-test', '2222', NULL);
        INSERT INTO api_keys (id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_prefix, key_suffix, key_hash)
        VALUES ('key_null_2', 'tenant_1', 'Null Hash 2', 'openai', 'enc3', 'nonce3', 'sk-test', '3333', NULL);
      `);
    }).not.toThrow();

    // Inserting duplicate key_hash should fail with UNIQUE constraint violation
    expect(() => {
      runSql(`
        INSERT INTO api_keys (id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_prefix, key_suffix, key_hash)
        VALUES ('key_uniq_2', 'tenant_1', 'Label 2', 'openai', 'enc4', 'nonce4', 'sk-test', '4444', 'sha256_hash_value_1');
      `);
    }).toThrow(/UNIQUE constraint failed: api_keys\.key_hash/);
  });

  it("should verify admin_audit_logs table structure, defaults, and idx_admin_audit_created index", () => {
    interface ColumnInfo {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }
    const cols = queryJson<ColumnInfo[]>("PRAGMA table_info(admin_audit_logs);");
    const colMap = new Map(cols.map((c) => [c.name, c]));

    expect(colMap.has("id")).toBe(true);
    expect(colMap.get("id")?.pk).toBe(1);

    expect(colMap.has("admin_user_id")).toBe(true);
    expect(colMap.has("admin_email")).toBe(true);

    expect(colMap.has("action")).toBe(true);
    expect(colMap.get("action")?.notnull).toBe(1);

    expect(colMap.has("target")).toBe(true);

    expect(colMap.has("details_json")).toBe(true);
    expect(colMap.get("details_json")?.notnull).toBe(1);

    expect(colMap.has("ip_address")).toBe(true);

    expect(colMap.has("created_at")).toBe(true);
    expect(colMap.get("created_at")?.notnull).toBe(1);

    // Verify index idx_admin_audit_created exists
    interface IndexInfo {
      name: string;
      tbl_name: string;
    }
    const indices = queryJson<IndexInfo[]>(
      "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name='idx_admin_audit_created';"
    );
    expect(indices.length).toBe(1);
    expect(indices[0].tbl_name).toBe("admin_audit_logs");

    // Test insertion and defaults
    const nowMs = Date.now();
    runSql(`
      INSERT INTO admin_audit_logs (id, admin_user_id, admin_email, action, target, ip_address)
      VALUES ('audit_test_1', 'usr_admin', 'sec@example.com', 'EMERGENCY_REVOKE', 'key_uniq_1', '10.0.0.1');
    `);

    interface AuditRow {
      id: string;
      admin_user_id: string;
      admin_email: string;
      action: string;
      target: string;
      details_json: string;
      ip_address: string;
      created_at: number;
    }
    const rows = queryJson<AuditRow[]>("SELECT * FROM admin_audit_logs WHERE id = 'audit_test_1';");
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.action).toBe("EMERGENCY_REVOKE");
    expect(row.details_json).toBe("{}");
    expect(typeof row.created_at).toBe("number");
    // created_at is unixepoch() * 1000 in ms, within +/- 60 seconds of nowMs
    expect(Math.abs(row.created_at - nowMs)).toBeLessThan(60_000);
  });
});
