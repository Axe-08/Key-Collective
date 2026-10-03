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

    // Seed baseline rows into cost_ledger and daily_spend_rollup before applying rest
    await env.DB.prepare(`
      INSERT INTO cost_ledger (
        id, request_id, tenant_id, key_id, provider, model_id,
        prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens,
        cost_microdollars, latency_ms, status_code, created_at
      ) VALUES (
        'evt_fixture_1', 'req_fixture_1', 'default', 'key_default_healthy', 'gemini', 'gemini-2.0-flash',
        1000, 500, 0, 0, 450, 120, 200, '2024-03-01T12:00:00.000Z'
      )
    `).run();

    await env.DB.prepare(`
      INSERT INTO daily_spend_rollup (
        tenant_id, day, provider, model_id,
        total_requests, total_tokens, total_cost_microdollars
      ) VALUES (
        'default', '2024-03-01', 'gemini', 'gemini-2.0-flash',
        1, 1500, 450
      )
    `).run();

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

    // Migration 0013: backfills cu for all existing cost_ledger rows (no cu IS NULL remaining)
    const nullCuCount = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM cost_ledger WHERE cu IS NULL",
    ).first<{ count: number }>();
    expect(nullCuCount?.count).toBe(0);

    const fixtureRow = await env.DB.prepare(
      "SELECT cu, usage_estimated, borrowed, lender_tenant_id FROM cost_ledger WHERE id = 'evt_fixture_1'",
    ).first<{ cu: number; usage_estimated: number; borrowed: number; lender_tenant_id: string | null }>();
    expect(fixtureRow).toBeDefined();
    // 10 + Math.floor((1000 + 999)/1000) + Math.floor(((500 + 0)*4 + 999)/1000) = 10 + 1 + 2 = 13
    expect(fixtureRow?.cu).toBe(13);
    expect(fixtureRow?.usage_estimated).toBe(0);
    expect(fixtureRow?.borrowed).toBe(0);
    expect(fixtureRow?.lender_tenant_id).toBeNull();

    // Migration 0013: creates daily_cu_rollup with seeded rows from daily_spend_rollup
    const cuRollupRows = await env.DB.prepare(
      "SELECT * FROM daily_cu_rollup WHERE tenant_id = 'default'",
    ).all<{ tenant_id: string; day: string; provider: string; model_id: string; total_requests: number; total_tokens: number; total_cu: number }>();
    expect(cuRollupRows.results).toBeDefined();
    expect(cuRollupRows.results.length).toBeGreaterThan(0);
    expect(cuRollupRows.results[0].total_cu).toBe(0);
    expect(cuRollupRows.results[0].total_requests).toBe(1);
    expect(cuRollupRows.results[0].total_tokens).toBe(1500);

    // Migration 0013: adds budget_cu and spent_cu to auth_tokens
    const authTokensRows = await env.DB.prepare(
      "SELECT id, budget_cu, spent_cu FROM auth_tokens WHERE tenant_id = 'default'",
    ).first<{ id: string; budget_cu: number | null; spent_cu: number }>();
    expect(authTokensRows).toBeDefined();
    expect(authTokensRows?.budget_cu).toBeNull();
    expect(authTokensRows?.spent_cu).toBe(0);

    // Migration 0013: adds community_debt_cu to contributor_standing
    const standingCols = await env.DB.prepare(
      "PRAGMA table_info(contributor_standing)",
    ).all<{ name: string }>();
    const colNames = (standingCols.results ?? []).map((c) => c.name);
    expect(colNames).toContain("community_debt_cu");

    // Migration 0015: creates user_identities and sessions, and adds columns to users
    const identityCols = await env.DB.prepare(
      "PRAGMA table_info(user_identities)",
    ).all<{ name: string }>();
    const identityColNames = (identityCols.results ?? []).map((c) => c.name);
    expect(identityColNames).toEqual(
      expect.arrayContaining([
        "user_id",
        "provider",
        "subject",
        "username",
        "email",
        "profile_json",
        "linked_at",
      ]),
    );

    const sessionCols = await env.DB.prepare(
      "PRAGMA table_info(sessions)",
    ).all<{ name: string }>();
    const sessionColNames = (sessionCols.results ?? []).map((c) => c.name);
    expect(sessionColNames).toEqual(
      expect.arrayContaining([
        "id_hash",
        "user_id",
        "kind",
        "created_at",
        "expires_at",
        "ip_address",
        "user_agent",
        "revoked_at",
      ]),
    );

    const userCols = await env.DB.prepare(
      "PRAGMA table_info(users)",
    ).all<{ name: string }>();
    const userColNames = (userCols.results ?? []).map((c) => c.name);
    expect(userColNames).toContain("community_eligible");
    expect(userColNames).toContain("sybil_assessed_at");
    expect(userColNames).toContain("registration_status");
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

  it("0015 backfills google identities and leaves auth_tokens and GitHub-only users untouched", async () => {
    expect(names).toContain("0015_identity.sql");

    await resetToEmptyDatabase(env.DB);
    const before0015 = migrations.filter((m) => m.name < "0015_identity.sql");
    const m0015 = migrations.filter((m) => m.name === "0015_identity.sql");
    expect(m0015.length).toBe(1);

    await applyMigrations(env.DB, before0015);

    // Seed test users: Google user, GitHub-only users
    await env.DB.prepare(
      "INSERT INTO users (id, email) VALUES (?, ?)",
    ).bind("usr_goog_sub123456", "alice@example.com").run();

    await env.DB.prepare(
      "INSERT INTO users (id, email) VALUES (?, ?)",
    ).bind("gh_987654", "bob_gh@example.com").run();

    await env.DB.prepare(
      "INSERT INTO users (id, email) VALUES (?, ?)",
    ).bind("usr_gh_54321", "carol_gh@example.com").run();

    // Seed an auth_token for the google user
    await env.DB.prepare(`
      INSERT INTO auth_tokens (
        id, hash_sha256, tenant_id, encrypted_token_b64, nonce_b64,
        budget_microdollars, spent_microdollars, allowed_providers, rpm_limit,
        expires_at, created_at
      ) VALUES (
        'tok_active_test', 'hash_tok_active_test_00000000000000000000000', 'usr_goog_sub123456',
        'ZW5jcnlwdGVk', 'bm9uY2U=', 1000000, 0, '["gemini"]', 60, NULL, '2024-05-01T00:00:00.000Z'
      )
    `).run();

    // Apply migration 0015
    await applyMigrations(env.DB, m0015);

    // Verify user_identities backfill
    const identities = await env.DB.prepare(
      "SELECT user_id, provider, subject, email, profile_json FROM user_identities",
    ).all<{ user_id: string; provider: string; subject: string; email: string; profile_json: string }>();

    expect(identities.results.length).toBe(1);
    expect(identities.results[0].user_id).toBe("usr_goog_sub123456");
    expect(identities.results[0].provider).toBe("google");
    expect(identities.results[0].subject).toBe("sub123456");
    expect(identities.results[0].email).toBe("alice@example.com");
    expect(identities.results[0].profile_json).toBe("{}");

    // Verify registration_status for usr_goog_*
    const googUser = await env.DB.prepare(
      "SELECT id, registration_status, community_eligible, sybil_assessed_at FROM users WHERE id = ?",
    ).bind("usr_goog_sub123456").first<{ id: string; registration_status: string; community_eligible: number; sybil_assessed_at: string | null }>();
    expect(googUser?.registration_status).toBe("PENDING_CONSENT");
    expect(googUser?.community_eligible).toBe(0);
    expect(googUser?.sybil_assessed_at).toBeNull();

    // Verify GitHub-only accounts are left untouched (not suspended)
    const ghUser1 = await env.DB.prepare(
      "SELECT id, registration_status FROM users WHERE id = ?",
    ).bind("gh_987654").first<{ id: string; registration_status: string }>();
    expect(ghUser1?.registration_status).toBe("PENDING_CONSENT"); // default, not SUSPENDED

    const ghUser2 = await env.DB.prepare(
      "SELECT id, registration_status FROM users WHERE id = ?",
    ).bind("usr_gh_54321").first<{ id: string; registration_status: string }>();
    expect(ghUser2?.registration_status).toBe("PENDING_CONSENT"); // default, not SUSPENDED

    // Verify auth_tokens left untouched (not expired, revoked or deleted)
    const token = await env.DB.prepare(
      "SELECT id, expires_at FROM auth_tokens WHERE id = 'tok_active_test'",
    ).first<{ id: string; expires_at: string | null }>();
    expect(token).toBeDefined();
    expect(token?.expires_at).toBeNull();

    // Verify schema constraints
    // 1. user_identities CHECK (provider IN ('google','github'))
    await expect(
      env.DB.prepare(
        "INSERT INTO user_identities (user_id, provider, subject) VALUES (?, ?, ?)",
      ).bind("usr_goog_sub123456", "facebook", "sub_fb").run(),
    ).rejects.toThrow();

    // 2. user_identities UNIQUE INDEX on (user_id, provider)
    await expect(
      env.DB.prepare(
        "INSERT INTO user_identities (user_id, provider, subject) VALUES (?, ?, ?)",
      ).bind("usr_goog_sub123456", "google", "sub_different").run(),
    ).rejects.toThrow();

    // 3. sessions CHECK (kind IN ('console','admin'))
    await expect(
      env.DB.prepare(
        "INSERT INTO sessions (id_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)",
      ).bind("hash1", "usr_goog_sub123456", "invalid_kind", "2026-10-01T00:00:00Z").run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare(
        "INSERT INTO sessions (id_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)",
      ).bind("hash1", "usr_goog_sub123456", "console", "2026-10-01T00:00:00Z").run(),
    ).resolves.not.toThrow();

    // 4. users CHECK (registration_status IN ('PENDING_CONSENT','ACTIVE','SUSPENDED'))
    await expect(
      env.DB.prepare(
        "UPDATE users SET registration_status = 'BANNED' WHERE id = ?",
      ).bind("usr_goog_sub123456").run(),
    ).rejects.toThrow();
  });

  it("0016 adds project scoping columns and converts project timestamps to ms, keeping the keys stub for the running release", async () => {
    expect(names).toContain("0016_projects.sql");

    await resetToEmptyDatabase(env.DB);
    await applyMigrations(env.DB, migrations.filter((m) => m.name < "0016_projects.sql"));
    await env.DB.prepare("INSERT INTO projects (id, name, tenant_id, created_at, updated_at) VALUES ('prj_s', 'secs', 't1', 1700000000, 1700000100)").run();
    await env.DB.prepare("INSERT INTO projects (id, name, tenant_id, created_at, updated_at) VALUES ('prj_ms', 'ms', 't1', 1700000000000, 1700000100000)").run();

    await applyMigrations(env.DB, migrations.filter((m) => m.name === "0016_projects.sql"));

    const rows = await env.DB.prepare("SELECT id, created_at, updated_at, rpm_sub_cap, is_archived FROM projects ORDER BY id").all();
    expect(rows.results).toEqual([
      { id: "prj_ms", created_at: 1700000000000, updated_at: 1700000100000, rpm_sub_cap: null, is_archived: 0 },
      { id: "prj_s", created_at: 1700000000000, updated_at: 1700000100000, rpm_sub_cap: null, is_archived: 0 },
    ]);
    const tokenCols = await env.DB.prepare("SELECT name FROM pragma_table_info('auth_tokens')").all<{ name: string }>();
    expect(tokenCols.results.map((c) => c.name)).toContain("project_id");
    // The running release still writes to the keys stub; it is dropped in a later contract migration (D-26).
    const keysTable = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'keys'").first();
    expect(keysTable).not.toBeNull();
  });

  it("0018 adds anti_cycling_until column to api_keys", async () => {
    expect(names).toContain("0018_anti_cycling.sql");

    await resetToEmptyDatabase(env.DB);
    await applyMigrations(env.DB, migrations.filter((m) => m.name < "0018_anti_cycling.sql"));

    const colsBefore = await env.DB.prepare("SELECT name FROM pragma_table_info('api_keys')").all<{ name: string }>();
    expect(colsBefore.results.map((c) => c.name)).not.toContain("anti_cycling_until");

    await applyMigrations(env.DB, migrations.filter((m) => m.name === "0018_anti_cycling.sql"));

    const colsAfter = await env.DB.prepare("SELECT name FROM pragma_table_info('api_keys')").all<{ name: string }>();
    expect(colsAfter.results.map((c) => c.name)).toContain("anti_cycling_until");
  });

  it("0019 adds contributed_cu_24h, multiplier_pct, jail_status, and last_reset_day to contributor_standing", async () => {
    expect(names).toContain("0019_standing.sql");

    await resetToEmptyDatabase(env.DB);
    await applyMigrations(env.DB, migrations.filter((m) => m.name < "0019_standing.sql"));

    await env.DB.prepare("INSERT INTO contributor_standing (tenant_id) VALUES ('t_standing_test')").run();

    await applyMigrations(env.DB, migrations.filter((m) => m.name === "0019_standing.sql"));

    const row = await env.DB.prepare(
      "SELECT contributed_cu_24h, multiplier_pct, jail_status, last_reset_day FROM contributor_standing WHERE tenant_id = 't_standing_test'",
    ).first<{
      contributed_cu_24h: number;
      multiplier_pct: number;
      jail_status: string;
      last_reset_day: string | null;
    }>();
    expect(row).toEqual({
      contributed_cu_24h: 0,
      multiplier_pct: 100,
      jail_status: "PRISTINE",
      last_reset_day: null,
    });
  });

  it("0020 creates standing_history table with composite primary key (tenant_id, day)", async () => {
    expect(names).toContain("0020_standing_history.sql");

    await resetToEmptyDatabase(env.DB);
    await applyMigrations(env.DB, migrations.filter((m) => m.name <= "0020_standing_history.sql"));

    await env.DB.prepare(
      "INSERT INTO standing_history (tenant_id, day, multiplier_pct, debt_cu, contributed_cu_24h, jail_status) VALUES ('t_hist_1', '2026-10-01', 450, 0, 1200, 'PRISTINE')",
    ).run();

    const row = await env.DB.prepare(
      "SELECT tenant_id, day, multiplier_pct, debt_cu, contributed_cu_24h, jail_status FROM standing_history WHERE tenant_id = 't_hist_1' AND day = '2026-10-01'",
    ).first<{
      tenant_id: string;
      day: string;
      multiplier_pct: number;
      debt_cu: number;
      contributed_cu_24h: number;
      jail_status: string;
    }>();

    expect(row).toEqual({
      tenant_id: "t_hist_1",
      day: "2026-10-01",
      multiplier_pct: 450,
      debt_cu: 0,
      contributed_cu_24h: 1200,
      jail_status: "PRISTINE",
    });
  });

  it("0021 creates key_daily_stats table and adds drain_state column to api_keys", async () => {
    expect(names).toContain("0021_key_daily_stats.sql");

    await resetToEmptyDatabase(env.DB);
    await applyMigrations(env.DB, migrations.filter((m) => m.name <= "0021_key_daily_stats.sql"));

    const cols = await env.DB.prepare("SELECT name FROM pragma_table_info('api_keys')").all<{ name: string }>();
    expect(cols.results.map((c) => c.name)).toContain("drain_state");

    await env.DB.prepare(
      "INSERT INTO key_daily_stats (key_id, day, model, dispatched, communal, cu_served, classification) VALUES ('k_daily_1', '2026-10-01', 'gemini-2.0-flash', 100, 85, 1700, 'HERO')",
    ).run();

    const row = await env.DB.prepare(
      "SELECT key_id, day, model, dispatched, communal, cu_served, classification FROM key_daily_stats WHERE key_id = 'k_daily_1' AND day = '2026-10-01' AND model = 'gemini-2.0-flash'",
    ).first<{
      key_id: string;
      day: string;
      model: string;
      dispatched: number;
      communal: number;
      cu_served: number;
      classification: string | null;
    }>();

    expect(row).toEqual({
      key_id: "k_daily_1",
      day: "2026-10-01",
      model: "gemini-2.0-flash",
      dispatched: 100,
      communal: 85,
      cu_served: 1700,
      classification: "HERO",
    });
  });

  it("0022 adds vesting_started_at column to project_hash_registry", async () => {
    expect(names).toContain("0022_project_hash_vesting.sql");

    await resetToEmptyDatabase(env.DB);
    await applyMigrations(env.DB, migrations.filter((m) => m.name <= "0022_project_hash_vesting.sql"));

    const cols = await env.DB.prepare("SELECT name FROM pragma_table_info('project_hash_registry')").all<{ name: string }>();
    expect(cols.results.map((c) => c.name)).toContain("vesting_started_at");
  });
  it("0025 creates would_deny_hourly with composite primary key (hour_utc, rule, tenant_hash)", async () => {
    expect(names).toContain("0025_would_deny_hourly.sql");

    await resetToEmptyDatabase(env.DB);
    await applyMigrations(env.DB, migrations.filter((m) => m.name <= "0025_would_deny_hourly.sql"));

    const cols = await env.DB.prepare(
      "SELECT name, pk, \"notnull\" AS nn, dflt_value FROM pragma_table_info('would_deny_hourly') ORDER BY cid",
    ).all<{ name: string; pk: number; nn: number; dflt_value: string | null }>();
    expect(cols.results.map((c) => c.name)).toEqual(["hour_utc", "rule", "tenant_hash", "count"]);
    expect(cols.results.filter((c) => c.pk > 0).map((c) => c.name)).toEqual(["hour_utc", "rule", "tenant_hash"]);
    const countCol = cols.results.find((c) => c.name === "count");
    expect(countCol?.nn).toBe(1);
    expect(countCol?.dflt_value).toBe("0");

    await env.DB.prepare(
      "INSERT INTO would_deny_hourly (hour_utc, rule, tenant_hash) VALUES (490000, 'brake', 'h1')",
    ).run();
    const row = await env.DB.prepare(
      "SELECT count FROM would_deny_hourly WHERE hour_utc = 490000 AND rule = 'brake' AND tenant_hash = 'h1'",
    ).first<{ count: number }>();
    expect(row?.count).toBe(0);

    await expect(
      env.DB.prepare(
        "INSERT INTO would_deny_hourly (hour_utc, rule, tenant_hash, count) VALUES (490000, 'brake', 'h1', 3)",
      ).run(),
    ).rejects.toThrow();
  });
});


