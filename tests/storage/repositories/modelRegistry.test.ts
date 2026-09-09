/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: Model Registry D1 Repository (storage-repo-models)
 *
 * Invariants & Standards:
 * - Fixed-Point Microdollars: All token pricing stored and computed in int64 microdollars (bigint). Zero float math.
 * - Multi-tenant catalog: verifies lookup, alias resolution, capability filtering, and batch upsert.
 * - Strict TypeScript: No `any`, strict null checks.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ModelRegistryRepository,
  rowToModelDef,
  isModelRegistryRow,
  ModelRegistryRow,
} from "../../../src/storage/repositories/modelRegistry";
import { ModelDef, createModelDef } from "../../../src/types/models";
import { ModelNotFoundError } from "../../../src/errors/routing_errors";

function createMeta(changes = 0): D1Meta & Record<string, unknown> {
  return {
    changes,
    duration: 1,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: 0,
    changed_db: changes > 0,
  };
}

class MockModelRegistryD1 implements D1Database {
  public rows = new Map<string, ModelRegistryRow>();

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[]
  ): Promise<D1Result<T>[]> {
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

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private boundParams: unknown[] = [];

  constructor(
    private readonly query: string,
    private readonly db: MockModelRegistryD1
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundParams = values;
    return this;
  }

  async first<T = Record<string, unknown>>(
    _colName?: string
  ): Promise<T | null> {
    const res = await this.all<T>();
    return res.results[0] ?? null;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(
    _options?: { columnNames?: boolean }
  ): Promise<any> {
    throw new Error("raw not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    const trimmed = this.query.trim();
    const upper = trimmed.toUpperCase().replace(/\s+/g, " ");

    // Handle INSERT / UPSERT
    if (upper.startsWith("INSERT INTO MODEL_REGISTRY")) {
      const [
        id,
        provider,
        logical_aliases,
        context_window,
        max_output_tokens,
        input_cost_per_mtok_micro,
        output_cost_per_mtok_micro,
        cache_read_cost_per_mtok_micro,
        supports_tools,
        supports_vision,
        supports_json_schema,
        deprecated_at,
        sunset_at,
        is_active,
        last_synced_at,
      ] = this.boundParams;

      const modelId = String(id);
      const isUpsert = upper.includes("ON CONFLICT(ID) DO UPDATE SET");

      if (this.db.rows.has(modelId) && !isUpsert) {
        throw new Error(`UNIQUE constraint failed: model_registry.id (${modelId})`);
      }

      const row: ModelRegistryRow = {
        id: modelId,
        provider: String(provider),
        logical_aliases: String(logical_aliases),
        context_window: Number(context_window),
        max_output_tokens: Number(max_output_tokens),
        input_cost_per_mtok_micro: Number(input_cost_per_mtok_micro),
        output_cost_per_mtok_micro: Number(output_cost_per_mtok_micro),
        cache_read_cost_per_mtok_micro: Number(cache_read_cost_per_mtok_micro),
        supports_tools: Number(supports_tools),
        supports_vision: Number(supports_vision),
        supports_json_schema: Number(supports_json_schema),
        deprecated_at: (deprecated_at as string | null) ?? null,
        sunset_at: (sunset_at as string | null) ?? null,
        is_active: Number(is_active),
        last_synced_at: String(last_synced_at),
      };

      this.db.rows.set(modelId, row);
      return {
        success: true,
        meta: createMeta(1),
        results: [] as T[],
      };
    }

    // Handle SELECT COUNT(*)
    if (upper.startsWith("SELECT COUNT(*)")) {
      let count = 0;
      let paramIdx = 0;
      for (const row of this.db.rows.values()) {
        let match = true;
        let pIdx = 0;
        if (upper.includes("PROVIDER = ?")) {
          if (row.provider !== this.boundParams[pIdx++]) match = false;
        }
        if (upper.includes("IS_ACTIVE = ?")) {
          if (row.is_active !== this.boundParams[pIdx++]) match = false;
        }
        if (match) {
          count++;
        }
        paramIdx = pIdx;
      }
      return {
        success: true,
        meta: createMeta(0),
        results: [{ count }] as unknown as T[],
      };
    }

    // Handle SELECT * FROM model_registry WHERE id = ? LIMIT 1
    if (upper.startsWith("SELECT * FROM MODEL_REGISTRY WHERE ID = ?")) {
      const id = String(this.boundParams[0]);
      const row = this.db.rows.get(id);
      return {
        success: true,
        meta: createMeta(0),
        results: row ? ([row] as unknown as T[]) : [],
      };
    }

    // Handle SELECT * FROM model_registry WHERE logical_aliases LIKE ?
    if (upper.includes("LOGICAL_ALIASES LIKE ?")) {
      const likePattern = String(this.boundParams[0]); // e.g. %"smart-fast"%
      const cleanAlias = likePattern.replace(/^%"?/, "").replace(/"?%$/, "").replace(/\\/g, "");
      let results = Array.from(this.db.rows.values()).filter((row) => {
        let aliases: string[] = [];
        try {
          aliases = JSON.parse(row.logical_aliases);
        } catch {
          aliases = [];
        }
        return aliases.includes(cleanAlias);
      });

      if (upper.includes("AND IS_ACTIVE = 1")) {
        results = results.filter((r) => r.is_active === 1);
      }

      // Order by input_cost_per_mtok_micro ASC
      results.sort(
        (a, b) =>
          Number(a.input_cost_per_mtok_micro) - Number(b.input_cost_per_mtok_micro)
      );

      return {
        success: true,
        meta: createMeta(0),
        results: results as unknown as T[],
      };
    }

    // Handle generic SELECT * FROM model_registry ...
    if (upper.startsWith("SELECT * FROM MODEL_REGISTRY")) {
      let rows = Array.from(this.db.rows.values());
      let paramIdx = 0;

      if (upper.includes("PROVIDER = ?")) {
        const prov = this.boundParams[paramIdx++] as string;
        rows = rows.filter((r) => r.provider === prov);
      }
      if (upper.includes("IS_ACTIVE = 1")) {
        rows = rows.filter((r) => r.is_active === 1);
      } else if (upper.includes("IS_ACTIVE = ?")) {
        const active = this.boundParams[paramIdx++] as number;
        rows = rows.filter((r) => r.is_active === active);
      }
      if (upper.includes("SUPPORTS_TOOLS = 1")) {
        rows = rows.filter((r) => r.supports_tools === 1);
      } else if (upper.includes("SUPPORTS_TOOLS = ?")) {
        const val = this.boundParams[paramIdx++] as number;
        rows = rows.filter((r) => r.supports_tools === val);
      }
      if (upper.includes("SUPPORTS_VISION = 1")) {
        rows = rows.filter((r) => r.supports_vision === 1);
      } else if (upper.includes("SUPPORTS_VISION = ?")) {
        const val = this.boundParams[paramIdx++] as number;
        rows = rows.filter((r) => r.supports_vision === val);
      }
      if (upper.includes("SUPPORTS_JSON_SCHEMA = 1")) {
        rows = rows.filter((r) => r.supports_json_schema === 1);
      } else if (upper.includes("SUPPORTS_JSON_SCHEMA = ?")) {
        const val = this.boundParams[paramIdx++] as number;
        rows = rows.filter((r) => r.supports_json_schema === val);
      }
      if (upper.includes("CONTEXT_WINDOW >= ?")) {
        const minContext = this.boundParams[paramIdx++] as number;
        rows = rows.filter((r) => r.context_window >= minContext);
      }
      if (upper.includes("INPUT_COST_PER_MTOK_MICRO <= ?")) {
        const maxCost = this.boundParams[paramIdx++] as number;
        rows = rows.filter((r) => Number(r.input_cost_per_mtok_micro) <= maxCost);
      }

      // Handle Sorting
      const isDesc = upper.includes(" DESC");
      if (upper.includes("ORDER BY INPUT_COST_PER_MTOK_MICRO")) {
        rows.sort((a, b) =>
          isDesc
            ? Number(b.input_cost_per_mtok_micro) - Number(a.input_cost_per_mtok_micro)
            : Number(a.input_cost_per_mtok_micro) - Number(b.input_cost_per_mtok_micro)
        );
      } else if (upper.includes("ORDER BY CONTEXT_WINDOW")) {
        rows.sort((a, b) =>
          isDesc
            ? Number(b.context_window) - Number(a.context_window)
            : Number(a.context_window) - Number(b.context_window)
        );
      } else {
        rows.sort((a, b) => (isDesc ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id)));
      }

      // Handle Pagination
      if (upper.includes("LIMIT ?")) {
        const limit = this.boundParams[paramIdx++] as number;
        let offset = 0;
        if (upper.includes("OFFSET ?")) {
          offset = this.boundParams[paramIdx++] as number;
        }
        rows = rows.slice(offset, offset + limit);
      }

      return {
        success: true,
        meta: createMeta(0),
        results: rows as unknown as T[],
      };
    }

    // Handle UPDATE
    if (upper.startsWith("UPDATE MODEL_REGISTRY")) {
      const id = String(this.boundParams[this.boundParams.length - 1]);
      const row = this.db.rows.get(id);
      if (!row) {
        return {
          success: true,
          meta: createMeta(0),
          results: [] as T[],
        };
      }

      if (upper.includes("IS_ACTIVE = ?") && upper.includes("SUNSET_AT = CASE")) {
        const isActive = Number(this.boundParams[0]);
        const sunsetAt = this.boundParams[1] as string | null;
        const lastSyncedAt = String(this.boundParams[3]);
        row.is_active = isActive;
        if (sunsetAt !== null) {
          row.sunset_at = sunsetAt;
        }
        row.last_synced_at = lastSyncedAt;
        this.db.rows.set(id, row);
        return { success: true, meta: createMeta(1), results: [] as T[] };
      }

      if (upper.includes("DEPRECATED_AT = ?") && upper.includes("SUNSET_AT = CASE")) {
        const depAt = String(this.boundParams[0]);
        const sunsetAt = this.boundParams[1] as string | null;
        const lastSyncedAt = String(this.boundParams[3]);
        row.deprecated_at = depAt;
        if (sunsetAt !== null) {
          row.sunset_at = sunsetAt;
        }
        row.last_synced_at = lastSyncedAt;
        this.db.rows.set(id, row);
        return { success: true, meta: createMeta(1), results: [] as T[] };
      }

      // General dynamic update
      let pIdx = 0;
      if (upper.includes("PROVIDER = ?")) row.provider = String(this.boundParams[pIdx++]);
      if (upper.includes("LOGICAL_ALIASES = ?")) row.logical_aliases = String(this.boundParams[pIdx++]);
      if (upper.includes("CONTEXT_WINDOW = ?")) row.context_window = Number(this.boundParams[pIdx++]);
      if (upper.includes("MAX_OUTPUT_TOKENS = ?")) row.max_output_tokens = Number(this.boundParams[pIdx++]);
      if (upper.includes("INPUT_COST_PER_MTOK_MICRO = ?")) row.input_cost_per_mtok_micro = Number(this.boundParams[pIdx++]);
      if (upper.includes("OUTPUT_COST_PER_MTOK_MICRO = ?")) row.output_cost_per_mtok_micro = Number(this.boundParams[pIdx++]);
      if (upper.includes("CACHE_READ_COST_PER_MTOK_MICRO = ?")) row.cache_read_cost_per_mtok_micro = Number(this.boundParams[pIdx++]);
      if (upper.includes("SUPPORTS_TOOLS = ?")) row.supports_tools = Number(this.boundParams[pIdx++]);
      if (upper.includes("SUPPORTS_VISION = ?")) row.supports_vision = Number(this.boundParams[pIdx++]);
      if (upper.includes("SUPPORTS_JSON_SCHEMA = ?")) row.supports_json_schema = Number(this.boundParams[pIdx++]);
      if (upper.includes("DEPRECATED_AT = ?")) row.deprecated_at = (this.boundParams[pIdx++] as string | null) ?? null;
      if (upper.includes("SUNSET_AT = ?")) row.sunset_at = (this.boundParams[pIdx++] as string | null) ?? null;
      if (upper.includes("IS_ACTIVE = ?")) row.is_active = Number(this.boundParams[pIdx++]);
      if (upper.includes("LAST_SYNCED_AT = ?")) row.last_synced_at = String(this.boundParams[pIdx++]);

      this.db.rows.set(id, row);
      return {
        success: true,
        meta: createMeta(1),
        results: [] as T[],
      };
    }

    // Handle DELETE
    if (upper.startsWith("DELETE FROM MODEL_REGISTRY WHERE ID = ?")) {
      const id = String(this.boundParams[0]);
      const existed = this.db.rows.delete(id);
      return {
        success: true,
        meta: createMeta(existed ? 1 : 0),
        results: [] as T[],
      };
    }

    return {
      success: true,
      meta: createMeta(0),
      results: [] as T[],
    };
  }
}

describe("ModelRegistryRepository", () => {
  let db: MockModelRegistryD1;
  let repo: ModelRegistryRepository;

  const sampleModel1: ModelDef<bigint> = {
    id: "gemini-2.0-flash",
    provider: "google",
    logicalAliases: ["smart-fast", "fast-model"],
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 100000n, // $0.10 / 1M
    outputCostPerMTokMicro: 400000n, // $0.40 / 1M
    cacheReadCostPerMTokMicro: 25000n, // $0.025 / 1M
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  };

  const sampleModel2: ModelDef<bigint> = {
    id: "gpt-4o",
    provider: "openai",
    logicalAliases: ["smart-model", "reasoning"],
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputCostPerMTokMicro: 2500000n, // $2.50 / 1M
    outputCostPerMTokMicro: 10000000n, // $10.00 / 1M
    cacheReadCostPerMTokMicro: 1250000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  };

  const sampleModel3: ModelDef<bigint> = {
    id: "claude-3-5-haiku",
    provider: "anthropic",
    logicalAliases: ["fast-model", "economy"],
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 800000n, // $0.80 / 1M
    outputCostPerMTokMicro: 4000000n, // $4.00 / 1M
    cacheReadCostPerMTokMicro: 80000n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  };

  beforeEach(() => {
    db = new MockModelRegistryD1();
    repo = new ModelRegistryRepository(db);
  });

  describe("create and getById / findById", () => {
    it("creates a new model definition and retrieves it by ID", async () => {
      const created = await repo.create(sampleModel1);
      expect(created.id).toBe("gemini-2.0-flash");
      expect(created.provider).toBe("google");
      expect(created.logicalAliases).toEqual(["smart-fast", "fast-model"]);
      expect(created.contextWindow).toBe(1048576);
      expect(created.maxOutputTokens).toBe(8192);
      expect(created.inputCostPerMTokMicro).toBe(100000n);
      expect(created.outputCostPerMTokMicro).toBe(400000n);
      expect(created.cacheReadCostPerMTokMicro).toBe(25000n);
      expect(created.supportsTools).toBe(true);
      expect(created.supportsVision).toBe(true);
      expect(created.supportsJsonSchema).toBe(true);
      expect(created.isActive).toBe(true);

      const retrieved = await repo.getById("gemini-2.0-flash");
      expect(retrieved).toEqual(created);

      const found = await repo.findById("gemini-2.0-flash");
      expect(found).toEqual(created);
    });

    it("throws when creating a duplicate model with the same ID", async () => {
      await repo.create(sampleModel1);
      await expect(repo.create(sampleModel1)).rejects.toThrow();
    });

    it("returns null on findById if model does not exist", async () => {
      const result = await repo.findById("non-existent-model");
      expect(result).toBeNull();
    });

    it("throws ModelNotFoundError on getById if model does not exist", async () => {
      await expect(repo.getById("non-existent-model")).rejects.toThrow(
        ModelNotFoundError
      );
    });

    it("supports models defined with number costs via createModelDef", async () => {
      const numModel = createModelDef({
        id: "mock-num-cost",
        provider: "groq",
        logicalAliases: ["fast"],
        contextWindow: 32000,
        maxOutputTokens: 2048,
        inputCostPerMTokMicro: 50000n,
        outputCostPerMTokMicro: 100000n,
        supportsTools: true,
        supportsVision: false,
        supportsJsonSchema: false,
      });

      const created = await repo.create(numModel);
      expect(created.id).toBe("mock-num-cost");
      expect(typeof created.inputCostPerMTokMicro).toBe("bigint");
      expect(created.inputCostPerMTokMicro).toBe(50000n);
    });
  });

  describe("upsert", () => {
    it("inserts a model if it does not exist", async () => {
      const result = await repo.upsert(sampleModel1);
      expect(result.id).toBe(sampleModel1.id);
      expect(result.inputCostPerMTokMicro).toBe(100000n);

      const count = await repo.count();
      expect(count).toBe(1);
    });

    it("updates all fields of existing model on conflict", async () => {
      await repo.create(sampleModel1);

      const updatedModel: ModelDef<bigint> = {
        ...sampleModel1,
        inputCostPerMTokMicro: 90000n,
        outputCostPerMTokMicro: 350000n,
        logicalAliases: ["smart-fast", "fast-model", "flash-tier"],
        supportsVision: false,
        lastSyncedAt: "2026-09-09T12:00:00.000Z",
      };

      const result = await repo.upsert(updatedModel);
      expect(result.inputCostPerMTokMicro).toBe(90000n);
      expect(result.outputCostPerMTokMicro).toBe(350000n);
      expect(result.logicalAliases).toContain("flash-tier");
      expect(result.supportsVision).toBe(false);

      const count = await repo.count();
      expect(count).toBe(1);
    });
  });

  describe("update", () => {
    beforeEach(async () => {
      await repo.create(sampleModel1);
    });

    it("updates selective fields of an existing model", async () => {
      const updated = await repo.update("gemini-2.0-flash", {
        contextWindow: 2000000,
        inputCostPerMTokMicro: 85000n,
        supportsTools: false,
      });

      expect(updated).not.toBeNull();
      expect(updated?.contextWindow).toBe(2000000);
      expect(updated?.inputCostPerMTokMicro).toBe(85000n);
      expect(updated?.supportsTools).toBe(false);
      // Untouched fields must remain unchanged
      expect(updated?.provider).toBe("google");
      expect(updated?.supportsVision).toBe(true);
      expect(updated?.outputCostPerMTokMicro).toBe(400000n);
    });

    it("returns null if updating a non-existent model", async () => {
      const result = await repo.update("non-existent-model", {
        contextWindow: 1000,
      });
      expect(result).toBeNull();
    });

    it("updates logical aliases properly as JSON", async () => {
      await repo.update("gemini-2.0-flash", {
        logicalAliases: ["ultra-fast", "cheap"],
      });

      const updated = await repo.getById("gemini-2.0-flash");
      expect(updated.logicalAliases).toEqual(["ultra-fast", "cheap"]);
    });
  });

  describe("delete", () => {
    it("deletes an existing model and returns true", async () => {
      await repo.create(sampleModel1);
      const deleted = await repo.delete("gemini-2.0-flash");
      expect(deleted).toBe(true);

      const found = await repo.findById("gemini-2.0-flash");
      expect(found).toBeNull();
    });

    it("returns false if deleting non-existent model", async () => {
      const deleted = await repo.delete("non-existent-model");
      expect(deleted).toBe(false);
    });
  });

  describe("findByAlias and findAllByAlias", () => {
    beforeEach(async () => {
      await repo.create(sampleModel1); // aliases: ["smart-fast", "fast-model"], cost: 100000n
      await repo.create(sampleModel2); // aliases: ["smart-model", "reasoning"], cost: 2500000n
      await repo.create(sampleModel3); // aliases: ["fast-model", "economy"], cost: 800000n
    });

    it("finds a single model by alias (cost-optimal first)", async () => {
      const found = await repo.findByAlias("smart-fast");
      expect(found).not.toBeNull();
      expect(found?.id).toBe("gemini-2.0-flash");
    });

    it("returns cheapest matching model first when multiple models share an alias", async () => {
      // Both gemini-2.0-flash (100k) and claude-3-5-haiku (800k) have "fast-model"
      const found = await repo.findByAlias("fast-model");
      expect(found).not.toBeNull();
      expect(found?.id).toBe("gemini-2.0-flash");

      const all = await repo.findAllByAlias("fast-model");
      expect(all).toHaveLength(2);
      expect(all[0]?.id).toBe("gemini-2.0-flash");
      expect(all[1]?.id).toBe("claude-3-5-haiku");
    });

    it("does not match partial substring aliases (e.g. 'fast' vs 'fast-model')", async () => {
      const found = await repo.findByAlias("fast");
      expect(found).toBeNull();
    });

    it("returns null if alias does not match any model", async () => {
      const found = await repo.findByAlias("non-existent-alias");
      expect(found).toBeNull();
    });

    it("filters out inactive models by default in alias queries", async () => {
      await repo.setActiveStatus("gemini-2.0-flash", false);

      const activeFound = await repo.findByAlias("smart-fast", true);
      expect(activeFound).toBeNull();

      const inactiveFound = await repo.findByAlias("smart-fast", false);
      expect(inactiveFound).not.toBeNull();
      expect(inactiveFound?.id).toBe("gemini-2.0-flash");
    });

    it("returns empty array when alias is empty string or whitespace", async () => {
      const res1 = await repo.findAllByAlias("");
      const res2 = await repo.findAllByAlias("   ");
      expect(res1).toEqual([]);
      expect(res2).toEqual([]);
    });
  });

  describe("resolveModel and getResolvedModel", () => {
    beforeEach(async () => {
      await repo.create(sampleModel1);
      await repo.create(sampleModel2);
    });

    it("resolves canonical model ID directly", async () => {
      const resolved = await repo.resolveModel("gemini-2.0-flash");
      expect(resolved?.id).toBe("gemini-2.0-flash");
    });

    it("resolves logical alias to canonical model", async () => {
      const resolved = await repo.resolveModel("smart-fast");
      expect(resolved?.id).toBe("gemini-2.0-flash");
    });

    it("returns null if neither ID nor alias matches", async () => {
      const resolved = await repo.resolveModel("unknown-entity");
      expect(resolved).toBeNull();
    });

    it("getResolvedModel returns resolved model", async () => {
      const model = await repo.getResolvedModel("smart-model");
      expect(model.id).toBe("gpt-4o");
    });

    it("getResolvedModel throws ModelNotFoundError on unresolved input", async () => {
      await expect(repo.getResolvedModel("unknown-model")).rejects.toThrow(
        ModelNotFoundError
      );
    });

    it("resolves inactive model only when onlyActive=false", async () => {
      await repo.setActiveStatus("gpt-4o", false);

      const active = await repo.resolveModel("gpt-4o", true);
      expect(active).toBeNull();

      const inactive = await repo.resolveModel("gpt-4o", false);
      expect(inactive?.id).toBe("gpt-4o");
    });
  });

  describe("listAll and listActive", () => {
    beforeEach(async () => {
      await repo.create(sampleModel1);
      await repo.create(sampleModel2);
      await repo.create(sampleModel3);
    });

    it("lists all models without filters", async () => {
      const list = await repo.listAll();
      expect(list).toHaveLength(3);
    });

    it("filters models by provider", async () => {
      const googleModels = await repo.listAll({ provider: "google" });
      expect(googleModels).toHaveLength(1);
      expect(googleModels[0]?.id).toBe("gemini-2.0-flash");

      const openaiModels = await repo.listAll({ provider: "openai" });
      expect(openaiModels).toHaveLength(1);
      expect(openaiModels[0]?.id).toBe("gpt-4o");
    });

    it("filters models by capabilities", async () => {
      const visionModels = await repo.listAll({ supportsVision: true });
      expect(visionModels).toHaveLength(2); // gemini and gpt-4o

      const nonVisionModels = await repo.listAll({ supportsVision: false });
      expect(nonVisionModels).toHaveLength(1); // claude-3-5-haiku
      expect(nonVisionModels[0]?.id).toBe("claude-3-5-haiku");
    });

    it("filters models by context window threshold", async () => {
      const largeContext = await repo.listAll({ minContextWindow: 500000 });
      expect(largeContext).toHaveLength(1);
      expect(largeContext[0]?.id).toBe("gemini-2.0-flash");
    });

    it("filters models by max input token cost in microdollars", async () => {
      const cheapModels = await repo.listAll({
        maxCostPerMTokMicro: 500000n, // $0.50 / 1M
      });
      expect(cheapModels).toHaveLength(1);
      expect(cheapModels[0]?.id).toBe("gemini-2.0-flash");
    });

    it("sorts by input cost ascending and descending", async () => {
      const asc = await repo.listAll({
        orderBy: "inputCost",
        orderDirection: "ASC",
      });
      expect(asc[0]?.id).toBe("gemini-2.0-flash");
      expect(asc[2]?.id).toBe("gpt-4o");

      const desc = await repo.listAll({
        orderBy: "inputCost",
        orderDirection: "DESC",
      });
      expect(desc[0]?.id).toBe("gpt-4o");
      expect(desc[2]?.id).toBe("gemini-2.0-flash");
    });

    it("paginates using limit and offset", async () => {
      const page1 = await repo.listAll({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = await repo.listAll({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
    });

    it("listActive returns only active models", async () => {
      await repo.setActiveStatus("gpt-4o", false);
      const active = await repo.listActive();
      expect(active).toHaveLength(2);
      expect(active.some((m) => m.id === "gpt-4o")).toBe(false);
    });
  });

  describe("findCompatible (capability & cost-optimal routing)", () => {
    beforeEach(async () => {
      await repo.create(sampleModel1); // google, tools=T, vision=T, context=1M, cost=100k
      await repo.create(sampleModel2); // openai, tools=T, vision=T, context=128k, cost=2.5M
      await repo.create(sampleModel3); // anthropic, tools=T, vision=F, context=200k, cost=800k
    });

    it("filters by vision and returns candidates ordered by lowest cost", async () => {
      const compatible = await repo.findCompatible({ vision: true });
      expect(compatible).toHaveLength(2);
      expect(compatible[0]?.id).toBe("gemini-2.0-flash"); // cheapest first
      expect(compatible[1]?.id).toBe("gpt-4o");
    });

    it("filters by context window required for large prompts", async () => {
      const compatible = await repo.findCompatible({
        estimatedPromptTokens: 150000,
      });
      // sampleModel1 (1M) and sampleModel3 (200k) fit; sampleModel2 (128k) fails
      expect(compatible).toHaveLength(2);
      expect(compatible[0]?.id).toBe("gemini-2.0-flash");
      expect(compatible[1]?.id).toBe("claude-3-5-haiku");
    });

    it("filters by provider and capabilities simultaneously", async () => {
      const compatible = await repo.findCompatible({
        provider: "anthropic",
        tools: true,
      });
      expect(compatible).toHaveLength(1);
      expect(compatible[0]?.id).toBe("claude-3-5-haiku");
    });

    it("excludes inactive models by default", async () => {
      await repo.setActiveStatus("gemini-2.0-flash", false);
      const compatible = await repo.findCompatible({ vision: true });
      expect(compatible).toHaveLength(1);
      expect(compatible[0]?.id).toBe("gpt-4o");
    });
  });

  describe("status transitions and deprecation", () => {
    beforeEach(async () => {
      await repo.create(sampleModel1);
    });

    it("deactivates and reactivates a model", async () => {
      const sunset = "2026-12-31T23:59:59.000Z";
      const changed = await repo.setActiveStatus("gemini-2.0-flash", false, sunset);
      expect(changed).toBe(true);

      const deactivated = await repo.getById("gemini-2.0-flash");
      expect(deactivated.isActive).toBe(false);
      expect(deactivated.sunsetAt).toBe(sunset);

      await repo.setActiveStatus("gemini-2.0-flash", true);
      const reactivated = await repo.getById("gemini-2.0-flash");
      expect(reactivated.isActive).toBe(true);
    });

    it("marks a model as deprecated with sunset timestamp", async () => {
      const depDate = "2026-10-01T00:00:00.000Z";
      const sunsetDate = "2026-12-31T00:00:00.000Z";

      const ok = await repo.deprecate("gemini-2.0-flash", depDate, sunsetDate);
      expect(ok).toBe(true);

      const model = await repo.getById("gemini-2.0-flash");
      expect(model.deprecatedAt).toBe(depDate);
      expect(model.sunsetAt).toBe(sunsetDate);
    });
  });

  describe("bulkUpsert", () => {
    it("inserts multiple models in a single batch", async () => {
      const count = await repo.bulkUpsert([sampleModel1, sampleModel2, sampleModel3]);
      expect(count).toBe(3);

      const total = await repo.count();
      expect(total).toBe(3);
    });

    it("handles an empty array gracefully", async () => {
      const count = await repo.bulkUpsert([]);
      expect(count).toBe(0);
    });

    it("updates existing models and inserts new models in the same batch", async () => {
      await repo.create(sampleModel1);

      const updated1: ModelDef<bigint> = {
        ...sampleModel1,
        inputCostPerMTokMicro: 75000n,
      };

      await repo.bulkUpsert([updated1, sampleModel2]);

      const m1 = await repo.getById("gemini-2.0-flash");
      expect(m1.inputCostPerMTokMicro).toBe(75000n);

      const m2 = await repo.getById("gpt-4o");
      expect(m2.id).toBe("gpt-4o");
    });
  });

  describe("count and getAliasMap", () => {
    beforeEach(async () => {
      await repo.create(sampleModel1);
      await repo.create(sampleModel2);
      await repo.create(sampleModel3);
    });

    it("counts total models and filtered models", async () => {
      expect(await repo.count()).toBe(3);
      expect(await repo.count({ provider: "google" })).toBe(1);
      expect(await repo.count({ provider: "deepseek" })).toBe(0);

      await repo.setActiveStatus("gpt-4o", false);
      expect(await repo.count({ isActive: true })).toBe(2);
      expect(await repo.count({ isActive: false })).toBe(1);
    });

    it("builds a Map of alias to canonical model ID", async () => {
      const map = await repo.getAliasMap();
      expect(map.get("smart-fast")).toBe("gemini-2.0-flash");
      expect(map.get("smart-model")).toBe("gpt-4o");
      expect(map.get("reasoning")).toBe("gpt-4o");
      expect(map.get("economy")).toBe("claude-3-5-haiku");
      // "fast-model" was mapped to gemini-2.0-flash first
      expect(map.get("fast-model")).toBe("gemini-2.0-flash");
    });
  });

  describe("Type guards and mapping functions", () => {
    it("rowToModelDef converts raw D1 row correctly with BigInt pricing", () => {
      const row: ModelRegistryRow = {
        id: "test-model",
        provider: "openai",
        logical_aliases: '["alias-1", "alias-2"]',
        context_window: 64000,
        max_output_tokens: 4096,
        input_cost_per_mtok_micro: 500000,
        output_cost_per_mtok_micro: 1500000,
        cache_read_cost_per_mtok_micro: 250000,
        supports_tools: 1,
        supports_vision: 0,
        supports_json_schema: 1,
        deprecated_at: null,
        sunset_at: null,
        is_active: 1,
        last_synced_at: "2026-09-09T00:00:00.000Z",
      };

      const def = rowToModelDef(row);
      expect(def.id).toBe("test-model");
      expect(def.logicalAliases).toEqual(["alias-1", "alias-2"]);
      expect(typeof def.inputCostPerMTokMicro).toBe("bigint");
      expect(def.inputCostPerMTokMicro).toBe(500000n);
      expect(def.outputCostPerMTokMicro).toBe(1500000n);
      expect(def.cacheReadCostPerMTokMicro).toBe(250000n);
      expect(def.supportsTools).toBe(true);
      expect(def.supportsVision).toBe(false);
      expect(def.supportsJsonSchema).toBe(true);
      expect(def.isActive).toBe(true);
    });

    it("rowToModelDef handles malformed JSON in logical_aliases gracefully", () => {
      const row: ModelRegistryRow = {
        id: "broken-aliases",
        provider: "google",
        logical_aliases: "not-json{",
        context_window: 1000,
        max_output_tokens: 100,
        input_cost_per_mtok_micro: 10,
        output_cost_per_mtok_micro: 20,
        cache_read_cost_per_mtok_micro: 0,
        supports_tools: 0,
        supports_vision: 0,
        supports_json_schema: 0,
        deprecated_at: null,
        sunset_at: null,
        is_active: 1,
        last_synced_at: "2026-09-09T00:00:00.000Z",
      };

      const def = rowToModelDef(row);
      expect(def.logicalAliases).toEqual([]);
    });

    it("isModelRegistryRow validates shape properly", () => {
      const validRow: ModelRegistryRow = {
        id: "test",
        provider: "google",
        logical_aliases: "[]",
        context_window: 1000,
        max_output_tokens: 100,
        input_cost_per_mtok_micro: 10,
        output_cost_per_mtok_micro: 20,
        cache_read_cost_per_mtok_micro: 0,
        supports_tools: 1,
        supports_vision: 0,
        supports_json_schema: 1,
        deprecated_at: null,
        sunset_at: null,
        is_active: 1,
        last_synced_at: "2026-09-09T00:00:00.000Z",
      };

      expect(isModelRegistryRow(validRow)).toBe(true);
      expect(isModelRegistryRow(null)).toBe(false);
      expect(isModelRegistryRow("not-row")).toBe(false);
      expect(isModelRegistryRow({ id: "missing-fields" })).toBe(false);
    });
  });
});
