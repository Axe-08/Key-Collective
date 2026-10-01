/**
 * Key Collective — POST /api/keys provider validation
 *
 * Invariant tested: an unsupported provider (anything not in `PROVIDERS` from
 * src/providers/config.ts) is rejected with 400 before any D1 write or encryption
 * happens. A supported provider (e.g. "groq") is accepted.
 */

import { describe, expect, it } from "vitest";
import { fetchMock } from "cloudflare:test";
import { mockTurnstile } from "../../helpers/upstream";
import { handlePostKeys } from "../../../src/worker/router/dashboard/keys/post_key";
import { formatRouterError } from "../../../src/worker/router/errors";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { ConsentAttestationSchema } from "../../../src/contracts/v4_types";

const MASTER_KEY = "test-master-key-for-provider-validation-suite";

class MockD1PreparedStatement implements D1PreparedStatement {
  private boundParams: unknown[] = [];

  constructor(
    private readonly query: string,
    private readonly onExecute?: (query: string, params: unknown[]) => void
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundParams = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.onExecute?.(this.query, this.boundParams);
    const res = await this.all<T>();
    return (res.results[0] ?? null) as T | null;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.onExecute?.(this.query, this.boundParams);
    return this.executeQuery<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.onExecute?.(this.query, this.boundParams);
    return this.executeQuery<T>();
  }

  raw<T = unknown[]>(): Promise<T[]> {
    throw new Error("raw not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    // Pool-rights lookups (WP-3.3): an ACTIVE user with a google identity.
    if (this.query.includes("SELECT registration_status, is_quarantined, community_eligible FROM users")) {
      return { results: [{ registration_status: "ACTIVE", is_quarantined: 0, community_eligible: 0 }] as unknown as T[], success: true, meta: { duration: 1 } as D1Response["meta"] };
    }
    if (this.query.includes("SELECT provider FROM user_identities")) {
      return { results: [{ provider: "google" }] as unknown as T[], success: true, meta: { duration: 1 } as D1Response["meta"] };
    }
    return { results: [] as unknown as T[], success: true, meta: { duration: 1 } as D1Response["meta"] };
  }
}

interface ExecutedStatement {
  query: string;
  params: unknown[];
}

class MockD1Database implements D1Database {
  public executedStatements: ExecutedStatement[] = [];

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(query, (q, p) => {
      this.executedStatements.push({ query: q, params: p });
    });
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const stmt of statements) {
      results.push(await stmt.run<T>());
    }
    return results;
  }

  async exec(): Promise<D1ExecResult> {
    return { count: 1, duration: 1 };
  }

  withSession(): D1DatabaseSession {
    throw new Error("withSession not implemented in mock");
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}

function buildRequest(provider: string, key: string, headers?: Record<string, string>): Request {
  return new Request("https://api.keycollective.ai/api/keys", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-turnstile-token": "turnstile-token-verified-by-mocked-siteverify",
      "cf-connecting-ip": "198.51.100.42",
      "user-agent": "KeyCollectiveTest/1.0",
      ...(headers ?? {}),
    },
    body: JSON.stringify({
      provider,
      label: "test-key",
      key,
      k1: true,
      k2: true,
    }),
  });
}

describe("POST /api/keys provider validation", () => {
  it("rejects an unsupported provider (cerebras) with 400", async () => {
    const db = new MockD1Database();
    const env: WorkerEnv = { DB: db, KC_MASTER_KEY: MASTER_KEY, TURNSTILE_SECRET: "test-secret" };
    fetchMock.disableNetConnect();
    mockTurnstile(true);

    const request = buildRequest("cerebras", "csk-some-cerebras-key-0001");
    let res: Response;
    try {
      res = await handlePostKeys(request, env, "tenant-a", MASTER_KEY);
    } catch (err) {
      res = formatRouterError(err);
    }

    expect(res.status).toBe(400);
  });

  it("accepts a supported provider (groq)", async () => {
    const db = new MockD1Database();
    const env: WorkerEnv = { DB: db, KC_MASTER_KEY: MASTER_KEY, TURNSTILE_SECRET: "test-secret" };
    fetchMock.disableNetConnect();
    mockTurnstile(true);

    const request = buildRequest("groq", "gsk_some_groq_key_0001");
    const res = await handlePostKeys(request, env, "tenant-a", MASTER_KEY);

    expect(res.status).not.toBe(400);
  });

  it("inserts conforming consent attestations and project hash registry rows on key submission", async () => {
    const db = new MockD1Database();
    const env: WorkerEnv = { DB: db, KC_MASTER_KEY: MASTER_KEY, TURNSTILE_SECRET: "test-secret" };
    fetchMock.disableNetConnect();
    mockTurnstile(true);

    // Mock GCP error probe response for gemini provider
    const gcpClient = fetchMock.get("https://generativelanguage.googleapis.com");
    gcpClient
      .intercept({
        path: (path: string) => path.includes("invalid-model"),
        method: "GET",
      })
      .reply(400, {
        error: {
          code: 400,
          message: "API key not valid",
          status: "INVALID_ARGUMENT",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "API_KEY_INVALID",
              domain: "googleapis.com",
              metadata: {
                consumer: "projects/987654321098",
                service: "generativelanguage.googleapis.com",
              },
            },
          ],
        },
      });

    const request = buildRequest("gemini", "AIzaSyTestGeminiKey1234567890abcdef");
    const res = await handlePostKeys(request, env, "tenant-a", MASTER_KEY);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; provider: string };
    expect(body.id).toMatch(/^key_gemini_/);

    // 1. Verify consent_attestations inserts
    const consentStatements = db.executedStatements.filter((s) =>
      s.query.includes("INSERT INTO consent_attestations")
    );
    expect(consentStatements.length).toBe(2);

    for (const stmt of consentStatements) {
      expect(stmt.query).toContain(
        "INSERT INTO consent_attestations (id, tenant_id, event_type, checkbox_id, consent_version, key_id, attested_at, ip_address, user_agent)"
      );
      const [id, tenantId, eventType, checkboxId, consentVersion, keyId, attestedAt, ipAddress, userAgent] =
        stmt.params as [string, string, string, string, string, string | null, number, string | null, string | null];

      const parsed = ConsentAttestationSchema.safeParse({
        id,
        tenant_id: tenantId,
        event_type: eventType,
        checkbox_id: checkboxId,
        consent_version: consentVersion,
        key_id: keyId,
        attested_at: attestedAt,
        ip_address: ipAddress,
        user_agent: userAgent,
      });
      expect(parsed.success).toBe(true);
      expect(tenantId).toBe("tenant-a");
      expect(eventType).toBe("KEY_SUBMISSION");
      expect(keyId).toBe(body.id);
      expect(consentVersion).toBe("v1.0");
      expect(typeof attestedAt).toBe("number");
      expect(attestedAt).toBeGreaterThan(0);
      expect(ipAddress).toBe("198.51.100.42");
      expect(userAgent).toBe("KeyCollectiveTest/1.0");
    }

    const checkboxIds = consentStatements.map((s) => s.params[3]);
    expect(checkboxIds).toEqual(["K1", "K2"]);

    // 2. Verify project_hash_registry insert contains provider
    const projectHashStatements = db.executedStatements.filter((s) =>
      s.query.includes("INSERT INTO project_hash_registry")
    );
    expect(projectHashStatements.length).toBe(1);
    const hashStmt = projectHashStatements[0];
    expect(hashStmt.query).toContain(
      "INSERT INTO project_hash_registry (project_hash, provider, state, tenant_id, created_at)"
    );
    expect(hashStmt.query).toContain("'ACTIVE'");
    const [projectHash, resolvedProvider, tenantId, createdAt] = hashStmt.params as [
      string,
      string,
      string,
      number
    ];
    expect(projectHash).toHaveLength(64);
    expect(resolvedProvider).toBe("google");
    expect(tenantId).toBe("tenant-a");
    expect(typeof createdAt).toBe("number");
    expect(createdAt).toBeGreaterThan(0);

    // 3. Verify api_keys insert contains canonical status 'HEALTHY' and integer created_at
    const apiKeyStatements = db.executedStatements.filter((s) =>
      s.query.includes("INSERT INTO api_keys")
    );
    expect(apiKeyStatements.length).toBe(1);
    const apiKeyStmt = apiKeyStatements[0];
    expect(apiKeyStmt.query).toContain("'HEALTHY'");
    expect(apiKeyStmt.query).toContain("created_at");
    const lastParam = apiKeyStmt.params[apiKeyStmt.params.length - 1];
    expect(typeof lastParam).toBe("number");
    expect(lastParam).toBeGreaterThan(0);
  });
});
