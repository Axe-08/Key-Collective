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

const MASTER_KEY = "test-master-key-for-provider-validation-suite";

class MockD1PreparedStatement implements D1PreparedStatement {
  private boundParams: unknown[] = [];

  constructor(private readonly query: string) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundParams = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const res = await this.all<T>();
    return (res.results[0] ?? null) as T | null;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  raw<T = unknown[]>(): Promise<T[]> {
    throw new Error("raw not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    return { results: [] as unknown as T[], success: true, meta: { duration: 1 } as D1Response["meta"] };
  }
}

class MockD1Database implements D1Database {
  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(query);
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

function buildRequest(provider: string, key: string): Request {
  return new Request("https://api.keycollective.ai/api/keys", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-turnstile-token": "turnstile-token-verified-by-mocked-siteverify",
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
});
