// Every later WP that adds a migration adds its assertions to this file.
import { describe, it, expect } from "vitest";
import { env, type D1Migration } from "cloudflare:test";
// Imported as a raw string at build time (not via node:fs, which is not
// available inside the Workers runtime) so the fixture ships as part of the
// compiled test bundle.
// eslint-disable-next-line import/no-unresolved
import fixtureSql from "../fixtures/prod_shape.sql?raw";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
  }
}

function migrationNames(migrations: D1Migration[]): string[] {
  return migrations.map((m) => m.name);
}

async function applyMigrations(db: D1Database, migrations: D1Migration[]): Promise<void> {
  for (const migration of migrations) {
    for (const query of migration.queries) {
      const statement = query.trim();
      if (statement.length === 0) continue;
      await db.prepare(statement).run();
    }
  }
}

// The setup file (test/setup/apply-migrations.ts) already applies every
// migration to env.DB before any test runs. To exercise "apply to an empty
// database" / "apply on top of a fixture" scenarios we reset env.DB back to
// a blank slate (including the migrations bookkeeping table) before each
// scenario below.
async function resetToEmptyDatabase(db: D1Database): Promise<void> {
  const tables = await db
    .prepare(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    )
    .all<{ name: string; type: string }>();
  for (const row of tables.results ?? []) {
    const kind = row.type === "view" ? "VIEW" : "TABLE";
    await db.prepare(`DROP ${kind} IF EXISTS ${row.name}`).run();
  }
}

describe("migrations integration", () => {
  const migrations = env.TEST_MIGRATIONS;
  const names = migrationNames(migrations);

  it("contains no purge migration in migrations/", () => {
    expect(names).not.toContain("0010_purge_all_keys.sql");
  });

  it("applies cleanly to an empty database", async () => {
    await resetToEmptyDatabase(env.DB);
    await expect(applyMigrations(env.DB, migrations)).resolves.not.toThrow();
  });

  it("applies cleanly on top of the production-shaped fixture", async () => {
    // A fresh binding is not available per-test, so we build an isolated
    // database state: drop everything the earlier test created, apply the
    // baseline migrations, seed the production-shaped fixture (representing
    // data already present under the 0001/0002 schema), then apply the
    // remaining migrations on top, matching a real production upgrade.
    const fixtureStatements = fixtureSql
      // Strip full-line comments first: a leading comment block would
      // otherwise merge with the next statement into a single chunk (no
      // ";" between them) that starts with "--" and gets dropped whole.
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const baseline = migrations.filter(
      (m) => m.name <= "0002_v3_multi_project.sql",
    );
    const rest = migrations.filter((m) => m.name > "0002_v3_multi_project.sql");

    await resetToEmptyDatabase(env.DB);

    await applyMigrations(env.DB, baseline);

    for (const statement of fixtureStatements) {
      await env.DB.prepare(statement).run();
    }

    await expect(applyMigrations(env.DB, rest)).resolves.not.toThrow();

    const statuses = await env.DB.prepare(
      "SELECT DISTINCT status FROM api_keys",
    ).all();
    const statusValues = (statuses.results as Array<{ status: string }>).map(
      (r) => r.status,
    );
    expect(statusValues.sort()).toEqual(["HEALTHY", "QUARANTINED"]);

    const nullPoolTypes = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM api_keys WHERE pool_type IS NULL",
    ).first<{ count: number }>();
    expect(nullPoolTypes?.count).toBe(0);

    const keyRows = await env.DB.prepare(
      "SELECT created_at, last_used_at, circuit_open_until FROM api_keys",
    ).all<{ created_at: unknown; last_used_at: unknown; circuit_open_until: unknown }>();
    expect(keyRows.results?.length).toBeGreaterThan(0);
    for (const row of keyRows.results ?? []) {
      expect(typeof row.created_at).toBe("number");
      expect(Number.isInteger(row.created_at)).toBe(true);
      expect(row.created_at as number).toBeGreaterThan(1_000_000_000_000);

      if (row.last_used_at !== null) {
        expect(typeof row.last_used_at).toBe("number");
        expect(Number.isInteger(row.last_used_at)).toBe(true);
        expect(row.last_used_at as number).toBeGreaterThan(1_000_000_000_000);
      }
      if (row.circuit_open_until !== null) {
        expect(typeof row.circuit_open_until).toBe("number");
        expect(Number.isInteger(row.circuit_open_until)).toBe(true);
        expect(row.circuit_open_until as number).toBeGreaterThan(1_000_000_000_000);
      }
    }

    const defaultTenantRows = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM auth_tokens WHERE tenant_id = 'default'",
    ).first<{ count: number }>();
    expect(defaultTenantRows?.count).toBe(1);
  });

  it("enforces append-only consent_attestations (insert succeeds, update/delete aborts)", async () => {
    await resetToEmptyDatabase(env.DB);
    await applyMigrations(env.DB, migrations);

    await env.DB.prepare(
      "INSERT INTO consent_attestations (id, tenant_id, event_type, checkbox_id, consent_version) VALUES (?, ?, ?, ?, ?)",
    )
      .bind("consent_test_1", "tenant_test", "REGISTRATION", "C1", "v1")
      .run();

    const row = await env.DB.prepare(
      "SELECT * FROM consent_attestations WHERE id = ?",
    )
      .bind("consent_test_1")
      .first<{ id: string; attested_at: number }>();
    expect(row?.id).toBe("consent_test_1");
    expect(typeof row?.attested_at).toBe("number");
    expect(row?.attested_at).toBeGreaterThan(1_000_000_000_000);

    await expect(
      env.DB.prepare("UPDATE consent_attestations SET ip_address = '1.2.3.4' WHERE id = ?")
        .bind("consent_test_1")
        .run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare("DELETE FROM consent_attestations WHERE id = ?")
        .bind("consent_test_1")
        .run(),
    ).rejects.toThrow();
  });

  it("enforces provider NOT NULL on project_hash_registry", async () => {
    await resetToEmptyDatabase(env.DB);
    await applyMigrations(env.DB, migrations);

    await expect(
      env.DB.prepare(
        "INSERT INTO project_hash_registry (project_hash, tenant_id, state) VALUES (?, ?, ?)",
      )
        .bind("ph_no_provider", "tenant_test", "ACTIVE")
        .run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare(
        "INSERT INTO project_hash_registry (project_hash, tenant_id, provider, state) VALUES (?, ?, ?, ?)",
      )
        .bind("ph_with_provider", "tenant_test", "google", "ACTIVE")
        .run(),
    ).resolves.not.toThrow();
  });
});
