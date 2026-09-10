import { beforeEach, describe, expect, it } from "vitest";
import { D1StorageAdapter } from "./d1";
import { EncryptedKey } from "../contracts/key_pool";
import { TelemetryEvent } from "../contracts/telemetry";

/**
 * In-memory Mock D1 database implementation for unit testing D1StorageAdapter.
 */
class MockD1Database implements D1Database {
  public apiKeys = new Map<string, any>();
  public dailyRollups = new Map<string, any>();
  public costLedger = new Map<string, any>();

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const stmt of statements) {
      results.push(await stmt.run<T>());
    }
    return results;
  }

  async exec(_query: string): Promise<D1ExecResult> {
    return { count: 1, duration: 1 };
  }

  withSession(): D1DatabaseSession {
    throw new Error("withSession not implemented in mock");
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private params: unknown[] = [];

  constructor(
    private readonly query: string,
    private readonly db: MockD1Database
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const res = await this.all<T>();
    return res.results[0] ?? null;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.all<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const q = this.query.trim().toLowerCase();

    // 1. SELECT from api_keys with tenant_id and id
    if (q.includes("select") && q.includes("from api_keys") && q.includes("and id = ?")) {
      const [tenantId, id] = this.params as [string, string];
      const key = this.db.apiKeys.get(id);
      if (key && key.tenant_id === tenantId) {
        return this.createResult([key] as T[]);
      }
      return this.createResult([]);
    }

    // 2. SELECT from api_keys by tenant_id
    if (q.includes("select") && q.includes("from api_keys") && q.includes("where tenant_id = ?")) {
      const [tenantId] = this.params as [string];
      const matched = Array.from(this.db.apiKeys.values())
        .filter((k: any) => k.tenant_id === tenantId)
        .sort((a: any, b: any) => (b.priority ?? 0) - (a.priority ?? 0));
      return this.createResult(matched as T[]);
    }

    // 3. INSERT INTO api_keys
    if (q.includes("insert into api_keys")) {
      const [
        id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
        key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
        circuit_open_until, last_used_at
      ] = this.params as any[];

      this.db.apiKeys.set(id, {
        id,
        tenant_id,
        label,
        provider,
        encrypted_key_b64,
        nonce_b64,
        key_prefix,
        key_suffix,
        rpm_limit,
        rpd_limit,
        priority,
        status,
        circuit_open_until,
        last_used_at,
        created_at: new Date().toISOString(),
      });
      return this.createResult([]);
    }

    // 4. DELETE FROM api_keys
    if (q.includes("delete from api_keys")) {
      const [tenantId, id] = this.params as [string, string];
      const key = this.db.apiKeys.get(id);
      if (key && key.tenant_id === tenantId) {
        this.db.apiKeys.delete(id);
      }
      return this.createResult([]);
    }

    // 5. INSERT INTO daily_spend_rollup
    if (q.includes("insert into daily_spend_rollup")) {
      const [
        tenant_id, day, provider, model_id,
        total_requests, total_tokens, total_cost_microdollars
      ] = this.params as [string, string, string, string, number, number, number];

      const compositeKey = `${tenant_id}:${day}:${provider}:${model_id}`;
      const existing = this.db.dailyRollups.get(compositeKey);

      if (existing) {
        existing.total_requests += total_requests;
        existing.total_tokens += total_tokens;
        existing.total_cost_microdollars = Number(existing.total_cost_microdollars) + total_cost_microdollars;
      } else {
        this.db.dailyRollups.set(compositeKey, {
          tenant_id,
          day,
          provider,
          model_id,
          total_requests,
          total_tokens,
          total_cost_microdollars,
        });
      }
      return this.createResult([]);
    }

    // 6. SELECT SUM aggregation from daily_spend_rollup
    if (q.includes("select") && q.includes("coalesce(sum(total_cost_microdollars)") && q.includes("from daily_spend_rollup")) {
      const tenantId = this.params[0] as string;
      const startDate = q.includes("day >=") ? (this.params[1] as string) : undefined;
      const endDate = q.includes("day <=") ? (this.params[q.includes("day >=") ? 2 : 1] as string) : undefined;

      let totalCost = 0n;
      let totalRequests = 0;
      let totalTokens = 0;

      for (const row of this.db.dailyRollups.values()) {
        if (row.tenant_id !== tenantId) continue;
        if (startDate && row.day < startDate) continue;
        if (endDate && row.day > endDate) continue;

        totalCost += BigInt(row.total_cost_microdollars);
        totalRequests += row.total_requests;
        totalTokens += row.total_tokens;
      }

      return this.createResult([{
        total_cost: totalCost.toString(),
        total_requests: totalRequests,
        total_tokens: totalTokens,
      }] as T[]);
    }

    // 7. SELECT list from daily_spend_rollup
    if (q.includes("select") && q.includes("from daily_spend_rollup") && q.includes("where tenant_id = ?")) {
      const tenantId = this.params[0] as string;
      const startDate = q.includes("day >=") ? (this.params[1] as string) : undefined;
      const endDate = q.includes("day <=") ? (this.params[q.includes("day >=") ? 2 : 1] as string) : undefined;

      const filtered = Array.from(this.db.dailyRollups.values())
        .filter((r: any) => {
          if (r.tenant_id !== tenantId) return false;
          if (startDate && r.day < startDate) return false;
          if (endDate && r.day > endDate) return false;
          return true;
        })
        .sort((a: any, b: any) => b.day.localeCompare(a.day));

      return this.createResult(filtered as T[]);
    }

    // 8. INSERT INTO cost_ledger
    if (q.includes("insert into cost_ledger")) {
      const [
        id, request_id, tenant_id, key_id, provider, model_id,
        prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens,
        cost_microdollars, latency_ms, status_code, created_at
      ] = this.params as any[];

      this.db.costLedger.set(id, {
        id,
        request_id,
        tenant_id,
        key_id,
        provider,
        model_id,
        prompt_tokens,
        completion_tokens,
        cached_tokens,
        reasoning_tokens,
        cost_microdollars,
        latency_ms,
        status_code,
        created_at,
      });
      return this.createResult([]);
    }

    return this.createResult([]);
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(_options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]> {
    throw new Error("raw not implemented in mock");
  }

  private createResult<T>(results: T[]): D1Result<T> {
    return {
      results,
      success: true,
      meta: {
        duration: 1,
        size_after: 0,
        rows_read: results.length,
        rows_written: 0,
        last_row_id: 0,
        changed_db: false,
        changes: 0,
      },
    };
  }
}

describe("D1StorageAdapter", () => {
  let mockDb: MockD1Database;
  let adapter: D1StorageAdapter;

  beforeEach(() => {
    mockDb = new MockD1Database();
    adapter = new D1StorageAdapter(mockDb as unknown as D1Database);
  });

  describe("Constructor & Initialization", () => {
    it("should instantiate with a valid D1Database", () => {
      expect(adapter).toBeInstanceOf(D1StorageAdapter);
    });

    it("should throw if database instance is not provided", () => {
      expect(() => new D1StorageAdapter(null as any)).toThrow("D1Database instance is required");
    });
  });

  describe("Encrypted Keys Persistence", () => {
    const sampleKey: EncryptedKey = {
      id: "key_openai_prod_1",
      tenantId: "tenant_corp_alpha",
      provider: "openai",
      ciphertext: "U2FsdGVkX1+vupppZksvRf5pq5g5XjFR",
      nonce: "123456789012", // 12 bytes
    };

    it("should persist an encrypted key successfully", async () => {
      await adapter.saveEncryptedKey(sampleKey);

      const retrieved = await adapter.getKeysForTenant("tenant_corp_alpha");
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].id).toBe("key_openai_prod_1");
      expect(retrieved[0].tenantId).toBe("tenant_corp_alpha");
      expect(retrieved[0].provider).toBe("openai");
      expect(retrieved[0].ciphertext).toBe(sampleKey.ciphertext);
      expect(retrieved[0].nonce).toBe(sampleKey.nonce);

    });

    it("should reject saving key with missing or empty tenantId", async () => {
      const invalidKey = { ...sampleKey, tenantId: "" };
      await expect(adapter.saveEncryptedKey(invalidKey)).rejects.toThrow("Tenant ID must be a non-empty string");
    });

    it("should reject saving key with missing ciphertext or nonce", async () => {
      await expect(adapter.saveEncryptedKey({ ...sampleKey, ciphertext: "" })).rejects.toThrow("Ciphertext cannot be empty");
      await expect(adapter.saveEncryptedKey({ ...sampleKey, nonce: "" })).rejects.toThrow("Nonce cannot be empty");
    });

    it("should enforce per-tenant isolation when querying keys", async () => {
      await adapter.saveEncryptedKey(sampleKey);
      await adapter.saveEncryptedKey({
        id: "key_tenant_beta_1",
        tenantId: "tenant_corp_beta",
        provider: "gemini",
        ciphertext: "cipherBeta",
        nonce: "nonceBeta1234",
      });

      const alphaKeys = await adapter.getKeysForTenant("tenant_corp_alpha");
      expect(alphaKeys).toHaveLength(1);
      expect(alphaKeys[0].id).toBe("key_openai_prod_1");

      const betaKeys = await adapter.getKeysForTenant("tenant_corp_beta");
      expect(betaKeys).toHaveLength(1);
      expect(betaKeys[0].id).toBe("key_tenant_beta_1");

      const gammaKeys = await adapter.getKeysForTenant("tenant_corp_gamma");
      expect(gammaKeys).toHaveLength(0);
    });

    it("should retrieve key by ID scoped to tenant", async () => {
      await adapter.saveEncryptedKey(sampleKey);

      const found = await adapter.getKeyById("tenant_corp_alpha", "key_openai_prod_1");
      expect(found).not.toBeNull();
      expect(found?.id).toBe("key_openai_prod_1");

      // Cross-tenant access must return null
      const crossTenant = await adapter.getKeyById("tenant_corp_beta", "key_openai_prod_1");
      expect(crossTenant).toBeNull();
    });

    it("should delete a key within tenant boundary", async () => {
      await adapter.saveEncryptedKey(sampleKey);
      await adapter.deleteKey("tenant_corp_alpha", "key_openai_prod_1");

      const keys = await adapter.getKeysForTenant("tenant_corp_alpha");
      expect(keys).toHaveLength(0);
    });
  });

  describe("Daily Spend Rollups & Metrics Aggregation (Fixed-Point Microdollars)", () => {
    it("should save and accumulate daily rollups with exact microdollar precision", async () => {
      const tenantId = "tenant_fin_1";
      const day = "2026-09-10";

      // 1 USD = 1,000,000 µ$
      // Event 1: 500,000 µ$ ($0.50), 1 request, 150 tokens
      await adapter.saveRollup({
        tenantId,
        day,
        provider: "openai",
        modelId: "gpt-4o",
        requestsDelta: 1,
        tokensDelta: 150,
        costMicrodollarsDelta: 500_000n,
      });

      // Event 2: 750,000 µ$ ($0.75), 1 request, 200 tokens
      await adapter.saveRollup({
        tenantId,
        day,
        provider: "openai",
        modelId: "gpt-4o",
        requestsDelta: 1,
        tokensDelta: 200,
        costMicrodollarsDelta: 750_000n,
      });

      // Aggregate total should be 1,250,000 µ$ ($1.25)
      const metrics = await adapter.getTenantMetrics(tenantId);
      expect(metrics.tenantId).toBe(tenantId);
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.totalTokens).toBe(350);
      expect(metrics.totalCostMicrodollars).toBe(1_250_000n);
    });

    it("should filter metrics aggregation by date range", async () => {
      const tenantId = "tenant_dates";

      await adapter.saveRollup({
        tenantId,
        day: "2026-09-01",
        provider: "gemini",
        modelId: "gemini-1.5-pro",
        costMicrodollarsDelta: 1_000_000n,
        requestsDelta: 5,
        tokensDelta: 1000,
      });

      await adapter.saveRollup({
        tenantId,
        day: "2026-09-05",
        provider: "gemini",
        modelId: "gemini-1.5-pro",
        costMicrodollarsDelta: 2_000_000n,
        requestsDelta: 10,
        tokensDelta: 2000,
      });

      await adapter.saveRollup({
        tenantId,
        day: "2026-09-10",
        provider: "gemini",
        modelId: "gemini-1.5-pro",
        costMicrodollarsDelta: 3_000_000n,
        requestsDelta: 15,
        tokensDelta: 3000,
      });

      // Query only 2026-09-04 to 2026-09-08
      const filtered = await adapter.getTenantMetrics(tenantId, "2026-09-04", "2026-09-08");
      expect(filtered.totalRequests).toBe(10);
      expect(filtered.totalTokens).toBe(2000);
      expect(filtered.totalCostMicrodollars).toBe(2_000_000n);
    });

    it("should return zeros for non-existent tenant metrics", async () => {
      const metrics = await adapter.getTenantMetrics("non_existent_tenant");
      expect(metrics.totalCostMicrodollars).toBe(0n);
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.totalTokens).toBe(0);
    });

    it("should retrieve daily rollups sorted by day DESC", async () => {
      const tenantId = "tenant_daily";

      await adapter.saveRollup({
        tenantId,
        day: "2026-09-01",
        provider: "anthropic",
        modelId: "claude-3-5-sonnet",
        costMicrodollarsDelta: 100_000n,
      });

      await adapter.saveRollup({
        tenantId,
        day: "2026-09-02",
        provider: "anthropic",
        modelId: "claude-3-5-sonnet",
        costMicrodollarsDelta: 200_000n,
      });

      const rollups = await adapter.getDailyRollups(tenantId);
      expect(rollups).toHaveLength(2);
      expect(rollups[0].day).toBe("2026-09-02");
      expect(rollups[1].day).toBe("2026-09-01");
      expect(rollups[0].totalCostMicrodollars).toBe(200_000n);
    });

    it("should reject negative cost microdollars delta", async () => {
      await expect(
        adapter.saveRollup({
          tenantId: "tenant_neg",
          day: "2026-09-10",
          provider: "openai",
          modelId: "gpt-4o",
          costMicrodollarsDelta: -100n,
        })
      ).rejects.toThrow("Cost microdollars cannot be negative");
    });
  });

  describe("Telemetry Contract Integration", () => {
    it("should record a telemetry event to the persistent cost ledger", async () => {
      const event: TelemetryEvent = {
        traceId: "trace_req_12345",
        tenantId: "tenant_telemetry",
        timestamp: Date.now(),
        eventType: "llm_completion",
        latencyMs: 342,
        costMicrodollars: 45_000n, // $0.045
        metadata: {
          keyId: "key_abc",
          provider: "openai",
          modelId: "gpt-4o",
          statusCode: "200",
        },
      };

      await adapter.recordTelemetry(event);

      // Verify stored in mock cost ledger
      const recorded = Array.from(mockDb.costLedger.values());
      expect(recorded).toHaveLength(1);
      expect(recorded[0].request_id).toBe("trace_req_12345");
      expect(recorded[0].tenant_id).toBe("tenant_telemetry");
      expect(recorded[0].cost_microdollars).toBe(45000);
      expect(recorded[0].latency_ms).toBe(342);
      expect(recorded[0].status_code).toBe(200);
    });
  });
});
