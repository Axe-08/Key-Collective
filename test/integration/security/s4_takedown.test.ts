/**
 * Key Collective v4 — S4 Abuse Takedown Route Security Tests
 *
 * Invariants Tested (docs/REMEDIATION_PLAN.md WP-0.4):
 * 1. Exact-hash-only matching: garbage / partial-prefix reports revoke nothing.
 * 2. `keyId` field is inert: the route only accepts `leaked_key` plaintext.
 * 3. Exact plaintext match revokes only the matching key and tombstones its
 *    provider_project_hash for 14 days; other keys are untouched.
 * 4. Constant-time response shield (AC-09): hit vs miss mean latency differs by < 10ms,
 *    and response bodies are byte-identical regardless of match outcome.
 * 5. Rate limiting: a 6th report from the same IP within an hour is rejected with 429.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { handleReportKeyAbuse } from "../../../src/worker/router/dashboard/abuse_routes";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import type {
  DurableObjectNamespaceLike,
  DurableObjectStubLike,
} from "../../../src/worker/router/types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    TURNSTILE_SECRET?: string;
  }
}

const ALWAYS_PASS_TOKEN = "1x0000000000000000000000000000000AA";

/**
 * Real DO instances (RateLimiterDO / KeyPoolDO) are backed by SQLite storage in the
 * Miniflare test runtime and are exercised end-to-end elsewhere (test/do/*). Exercising
 * them here via real bindings trips the vitest-pool-workers isolated-storage tracker
 * across rapid idFromName() churn, so — consistent with test/integration/worker/index.test.ts
 * — this suite drives the route against lightweight in-memory DO doubles that faithfully
 * reproduce the sliding-window and key-removal RPC contracts.
 */
class MockRateLimiterStub implements DurableObjectStubLike {
  private timestamps: number[] = [];

  public async fetch(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const body = init?.body ? (JSON.parse(String(init.body)) as { limit: number; windowMs: number }) : { limit: 5, windowMs: 3_600_000 };
    const now = Date.now();
    const cutoff = now - body.windowMs;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);

    if (this.timestamps.length >= body.limit) {
      return Response.json({ allowed: false, remaining: 0 }, { status: 429 });
    }

    this.timestamps.push(now);
    return Response.json(
      { allowed: true, remaining: body.limit - this.timestamps.length },
      { status: 200 }
    );
  }
}

class MockKeyPoolStub implements DurableObjectStubLike {
  public deletedKeyIds: string[] = [];

  public async fetch(input: RequestInfo | URL): Promise<Response> {
    const url = typeof input === "string" ? input : input.toString();
    const keyId = decodeURIComponent(url.split("/keys/")[1] || "");
    if (keyId) this.deletedKeyIds.push(keyId);
    return Response.json({ success: true, removed: true, keyId });
  }
}

class MockDurableObjectNamespace<T extends DurableObjectStubLike> implements DurableObjectNamespaceLike {
  private stubs = new Map<string, T>();
  constructor(private readonly factory: () => T) {}

  public idFromName(name: string): DurableObjectId {
    return { toString: () => name, name } as unknown as DurableObjectId;
  }

  public get(id: DurableObjectId): DurableObjectStubLike {
    const key = (id as unknown as { name: string }).name;
    let stub = this.stubs.get(key);
    if (!stub) {
      stub = this.factory();
      this.stubs.set(key, stub);
    }
    return stub;
  }
}

function makeTestEnv(): WorkerEnv {
  return {
    DB: env.DB,
    TURNSTILE_SECRET: env.TURNSTILE_SECRET,
    RATE_LIMITER: new MockDurableObjectNamespace(() => new MockRateLimiterStub()) as unknown as DurableObjectNamespace,
    KEY_POOL: new MockDurableObjectNamespace(() => new MockKeyPoolStub()) as unknown as DurableObjectNamespace,
  };
}

interface SeededKey {
  id: string;
  plaintext: string;
  tenantId: string;
  projectHash: string;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function seedGeminiKey(suffix: string): Promise<SeededKey> {
  const plaintext = `AIzaSyAB${suffix}${crypto.randomUUID().replace(/-/g, "")}`;
  const keyHash = await sha256Hex(plaintext);
  const id = "key_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const tenantId = "tenant_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const projectHash = "proj_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  await env.DB.prepare(
    `INSERT INTO api_keys (id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_prefix, key_suffix, status, community_routing_status, key_hash, provider_project_hash)
     VALUES (?, ?, ?, 'google', 'ciphertext', 'nonce', ?, ?, 'Healthy', 'ACTIVE', ?, ?)`
  )
    .bind(id, tenantId, `label-${suffix}`, plaintext.slice(0, 8), plaintext.slice(-4), keyHash, projectHash)
    .run();

  await env.DB.prepare(
    `INSERT INTO project_hash_registry (project_hash, tenant_id, provider, state) VALUES (?, ?, 'google', 'ACTIVE')`
  )
    .bind(projectHash, tenantId)
    .run();

  return { id, plaintext, tenantId, projectHash };
}

interface ApiKeyRow {
  status: string;
  community_routing_status: string;
}

interface ProjectHashRow {
  state: string;
  tombstone_until: number | null;
}

function makeReportRequest(
  bodyJson: Record<string, unknown>,
  ip: string
): Request {
  return new Request("http://localhost/api/abuse/report-key", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-turnstile-token": ALWAYS_PASS_TOKEN,
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify(bodyJson),
  });
}

function uniqueIp(): string {
  const n = Math.floor(Math.random() * 1_000_000);
  return `10.${(n >> 16) & 0xff}.${(n >> 8) & 0xff}.${n & 0xff}`;
}

describe("S4 Security: Abuse Takedown Route (exact hashing + rate limiting)", () => {
  it("reports of a partial prefix + garbage revoke neither seeded Gemini key", async () => {
    const key1 = await seedGeminiKey("1");
    const key2 = await seedGeminiKey("2");

    const req = makeReportRequest(
      { leaked_key: "AIzaSyAB" + "garbage-not-a-real-key" },
      uniqueIp()
    );
    const res = await handleReportKeyAbuse(req, makeTestEnv());
    expect(res.status).toBe(200);

    const row1 = await env.DB.prepare(
      "SELECT status, community_routing_status FROM api_keys WHERE id = ?"
    )
      .bind(key1.id)
      .first<ApiKeyRow>();
    const row2 = await env.DB.prepare(
      "SELECT status, community_routing_status FROM api_keys WHERE id = ?"
    )
      .bind(key2.id)
      .first<ApiKeyRow>();

    expect(row1?.status).toBe("Healthy");
    expect(row1?.community_routing_status).toBe("ACTIVE");
    expect(row2?.status).toBe("Healthy");
    expect(row2?.community_routing_status).toBe("ACTIVE");
  });

  it("reporting by the keyId field has no effect on the target key", async () => {
    const key = await seedGeminiKey("kid");

    const req = makeReportRequest({ keyId: key.id, key_id: key.id }, uniqueIp());
    const res = await handleReportKeyAbuse(req, makeTestEnv());
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      "SELECT status, community_routing_status FROM api_keys WHERE id = ?"
    )
      .bind(key.id)
      .first<ApiKeyRow>();

    expect(row?.status).toBe("Healthy");
    expect(row?.community_routing_status).toBe("ACTIVE");
  });

  it("reporting the exact plaintext of key 1 revokes only key 1 and tombstones its project hash for 14 days", async () => {
    const key1 = await seedGeminiKey("exact1");
    const key2 = await seedGeminiKey("exact2");

    const before = Date.now();
    const req = makeReportRequest({ leaked_key: key1.plaintext }, uniqueIp());
    const res = await handleReportKeyAbuse(req, makeTestEnv());
    expect(res.status).toBe(200);

    const row1 = await env.DB.prepare(
      "SELECT status, community_routing_status FROM api_keys WHERE id = ?"
    )
      .bind(key1.id)
      .first<ApiKeyRow>();
    const row2 = await env.DB.prepare(
      "SELECT status, community_routing_status FROM api_keys WHERE id = ?"
    )
      .bind(key2.id)
      .first<ApiKeyRow>();

    expect(row1?.status).toBe("REVOKED");
    expect(row1?.community_routing_status).toBe("REVOKED");
    expect(row2?.status).toBe("Healthy");
    expect(row2?.community_routing_status).toBe("ACTIVE");

    const projRow = await env.DB.prepare(
      "SELECT state, tombstone_until FROM project_hash_registry WHERE project_hash = ?"
    )
      .bind(key1.projectHash)
      .first<ProjectHashRow>();

    expect(projRow?.state).toBe("TOMBSTONED");
    const expectedMin = before + 14 * 24 * 60 * 60 * 1000 - 5000;
    const expectedMax = Date.now() + 14 * 24 * 60 * 60 * 1000 + 5000;
    expect(projRow?.tombstone_until).toBeGreaterThanOrEqual(expectedMin);
    expect(projRow?.tombstone_until).toBeLessThanOrEqual(expectedMax);
  });

  it("hit and miss responses are constant-time (mean diff < 10ms, AC-09) with byte-identical bodies", async () => {
    const hitKey = await seedGeminiKey("timinghit");
    const ITERATIONS = 20;

    const hitDurations: number[] = [];
    const missDurations: number[] = [];
    let hitBody = "";
    let missBody = "";

    for (let i = 0; i < ITERATIONS; i++) {
      const start = Date.now();
      const req = makeReportRequest({ leaked_key: hitKey.plaintext }, uniqueIp());
      const res = await handleReportKeyAbuse(req, makeTestEnv());
      hitDurations.push(Date.now() - start);
      hitBody = await res.text();
    }

    for (let i = 0; i < ITERATIONS; i++) {
      const start = Date.now();
      const req = makeReportRequest(
        { leaked_key: "AIzaSyNoSuchKey" + crypto.randomUUID().replace(/-/g, "") },
        uniqueIp()
      );
      const res = await handleReportKeyAbuse(req, makeTestEnv());
      missDurations.push(Date.now() - start);
      missBody = await res.text();
    }

    expect(hitBody).toBe(missBody);

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const meanHit = mean(hitDurations);
    const meanMiss = mean(missDurations);

    expect(Math.abs(meanHit - meanMiss)).toBeLessThan(10);
  }, 30000);

  it("rejects the 6th report from a single IP within an hour with 429", async () => {
    const ip = uniqueIp();
    const testEnv = makeTestEnv();

    for (let i = 0; i < 5; i++) {
      const req = makeReportRequest(
        { leaked_key: "AIzaSyRateLimitProbe" + crypto.randomUUID().replace(/-/g, "") },
        ip
      );
      const res = await handleReportKeyAbuse(req, testEnv);
      expect(res.status).toBe(200);
    }

    const sixthReq = makeReportRequest(
      { leaked_key: "AIzaSyRateLimitProbe" + crypto.randomUUID().replace(/-/g, "") },
      ip
    );
    const sixthRes = await handleReportKeyAbuse(sixthReq, testEnv);
    expect(sixthRes.status).toBe(429);
  }, 30000);
});
