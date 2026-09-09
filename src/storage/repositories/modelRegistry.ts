/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Model Registry D1 Repository Layer
 *
 * Invariants:
 * - TypeScript (strict mode, no `any`).
 * - Fixed-Point Microdollars: All costs in int64 microdollars (1 USD = 1,000,000 µ$). Zero floating-point math.
 * - Adheres strictly to D1 schema defined in `src/storage/migrations/0001_initial_schema.sql`.
 * - Multi-tenant isolation: model registry is the canonical catalog for upstream providers and models.
 */

import { ModelDef, ModelProvider, ModelAlias } from "../../types/models";
import { ModelNotFoundError } from "../../errors/routing_errors";

/**
 * Raw row shape returned by Cloudflare D1 from the `model_registry` table.
 */
export interface ModelRegistryRow {
  id: string;
  provider: string;
  logical_aliases: string;
  context_window: number;
  max_output_tokens: number;
  input_cost_per_mtok_micro: number | bigint;
  output_cost_per_mtok_micro: number | bigint;
  cache_read_cost_per_mtok_micro: number | bigint;
  supports_tools: number;
  supports_vision: number;
  supports_json_schema: number;
  deprecated_at: string | null;
  sunset_at: string | null;
  is_active: number;
  last_synced_at: string;
}

/**
 * Filter options for listing models from the registry.
 */
export interface ModelFilterOptions {
  /** Filter by upstream provider */
  provider?: ModelProvider;
  /** Filter by active status */
  isActive?: boolean;
  /** Require tool / function calling capability */
  supportsTools?: boolean;
  /** Require multimodal vision capability */
  supportsVision?: boolean;
  /** Require JSON schema structured output capability */
  supportsJsonSchema?: boolean;
  /** Minimum context window in tokens */
  minContextWindow?: number;
  /** Maximum allowable input token cost in microdollars */
  maxCostPerMTokMicro?: bigint | number;
  /** Column to order by */
  orderBy?: "id" | "inputCost" | "contextWindow";
  /** Sort direction */
  orderDirection?: "ASC" | "DESC";
  /** Maximum number of records to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Capabilities and context filter for matching models during routing.
 */
export interface ModelCapabilitiesFilter {
  /** If true, model must support function / tool calling */
  tools?: boolean;
  /** If true, model must support multimodal vision */
  vision?: boolean;
  /** If true, model must support JSON schema structured output */
  jsonSchema?: boolean;
  /** Minimum context window in tokens */
  minContextWindow?: number;
  /** Estimated prompt tokens that must fit within context window */
  estimatedPromptTokens?: number;
  /** Specific upstream provider filter */
  provider?: ModelProvider;
  /** Maximum allowable input token cost in microdollars */
  maxCostPerMTokMicro?: bigint | number;
  /** Only return active models (defaults to true) */
  onlyActive?: boolean;
}

/**
 * Contract interface for the Model Registry repository.
 */
export interface IModelRegistryRepository {
  findById(id: string): Promise<ModelDef<bigint> | null>;
  getById(id: string): Promise<ModelDef<bigint>>;
  findByAlias(alias: string, onlyActive?: boolean): Promise<ModelDef<bigint> | null>;
  findAllByAlias(alias: string, onlyActive?: boolean): Promise<ModelDef<bigint>[]>;
  resolveModel(idOrAlias: string, onlyActive?: boolean): Promise<ModelDef<bigint> | null>;
  getResolvedModel(idOrAlias: string, onlyActive?: boolean): Promise<ModelDef<bigint>>;
  listAll(options?: ModelFilterOptions): Promise<ModelDef<bigint>[]>;
  listActive(provider?: ModelProvider): Promise<ModelDef<bigint>[]>;
  findCompatible(filter: ModelCapabilitiesFilter): Promise<ModelDef<bigint>[]>;
  create(model: ModelDef<bigint> | ModelDef<number>): Promise<ModelDef<bigint>>;
  upsert(model: ModelDef<bigint> | ModelDef<number>): Promise<ModelDef<bigint>>;
  update(
    id: string,
    updates: Partial<ModelDef<bigint> | ModelDef<number>>
  ): Promise<ModelDef<bigint> | null>;
  delete(id: string): Promise<boolean>;
  setActiveStatus(id: string, isActive: boolean, sunsetAt?: string | null): Promise<boolean>;
  deprecate(id: string, deprecatedAt?: string, sunsetAt?: string): Promise<boolean>;
  bulkUpsert(models: (ModelDef<bigint> | ModelDef<number>)[]): Promise<number>;
  count(options?: { provider?: ModelProvider; isActive?: boolean }): Promise<number>;
  getAliasMap(onlyActive?: boolean): Promise<Map<string, string>>;
}

/**
 * Helper to safely convert microdollar bigint/number to integer representation for D1 parameter binding.
 * Enforces zero floating-point math by truncating/checking safe integer bounds.
 */
function toDbCost(cost: bigint | number | undefined, defaultValue = 0): number {
  if (cost === undefined) {
    return defaultValue;
  }
  if (typeof cost === "number") {
    if (!Number.isFinite(cost)) {
      throw new TypeError(`Cost must be a finite number: ${cost}`);
    }
    return Math.trunc(cost);
  }
  if (
    cost > BigInt(Number.MAX_SAFE_INTEGER) ||
    cost < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RangeError(
      `Microdollar value ${cost.toString()} exceeds 53-bit safe integer range`
    );
  }
  return Number(cost);
}

/**
 * Parses raw logical aliases JSON string into typed array of ModelAlias.
 */
function parseAliases(raw: unknown): ModelAlias[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Converts a raw D1 database row into the strongly typed domain ModelDef<bigint>.
 */
export function rowToModelDef(row: ModelRegistryRow): ModelDef<bigint> {
  return {
    id: row.id,
    provider: row.provider as ModelProvider,
    logicalAliases: parseAliases(row.logical_aliases),
    contextWindow: Number(row.context_window),
    maxOutputTokens: Number(row.max_output_tokens),
    inputCostPerMTokMicro: BigInt(row.input_cost_per_mtok_micro),
    outputCostPerMTokMicro: BigInt(row.output_cost_per_mtok_micro),
    cacheReadCostPerMTokMicro: BigInt(row.cache_read_cost_per_mtok_micro ?? 0),
    supportsTools: row.supports_tools === 1,
    supportsVision: row.supports_vision === 1,
    supportsJsonSchema: row.supports_json_schema === 1,
    deprecatedAt: row.deprecated_at ?? null,
    sunsetAt: row.sunset_at ?? null,
    isActive: row.is_active === 1,
    lastSyncedAt: row.last_synced_at,
  };
}

/**
 * Type guard for ModelRegistryRow.
 */
export function isModelRegistryRow(value: unknown): value is ModelRegistryRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.provider === "string" &&
    typeof c.context_window === "number" &&
    typeof c.max_output_tokens === "number" &&
    (typeof c.input_cost_per_mtok_micro === "number" ||
      typeof c.input_cost_per_mtok_micro === "bigint") &&
    (typeof c.output_cost_per_mtok_micro === "number" ||
      typeof c.output_cost_per_mtok_micro === "bigint") &&
    typeof c.supports_tools === "number" &&
    typeof c.supports_vision === "number" &&
    typeof c.supports_json_schema === "number" &&
    typeof c.is_active === "number"
  );
}

const UPSERT_MODEL_SQL = `
INSERT INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens,
  input_cost_per_mtok_micro, output_cost_per_mtok_micro, cache_read_cost_per_mtok_micro,
  supports_tools, supports_vision, supports_json_schema,
  deprecated_at, sunset_at, is_active, last_synced_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  provider = excluded.provider,
  logical_aliases = excluded.logical_aliases,
  context_window = excluded.context_window,
  max_output_tokens = excluded.max_output_tokens,
  input_cost_per_mtok_micro = excluded.input_cost_per_mtok_micro,
  output_cost_per_mtok_micro = excluded.output_cost_per_mtok_micro,
  cache_read_cost_per_mtok_micro = excluded.cache_read_cost_per_mtok_micro,
  supports_tools = excluded.supports_tools,
  supports_vision = excluded.supports_vision,
  supports_json_schema = excluded.supports_json_schema,
  deprecated_at = excluded.deprecated_at,
  sunset_at = excluded.sunset_at,
  is_active = excluded.is_active,
  last_synced_at = excluded.last_synced_at;
`;

const INSERT_MODEL_SQL = `
INSERT INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens,
  input_cost_per_mtok_micro, output_cost_per_mtok_micro, cache_read_cost_per_mtok_micro,
  supports_tools, supports_vision, supports_json_schema,
  deprecated_at, sunset_at, is_active, last_synced_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

/**
 * Repository layer for managing AI model definitions, pricing, and capabilities in Cloudflare D1.
 */
export class ModelRegistryRepository implements IModelRegistryRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Helper to serialize model properties into positional SQL bind parameters.
   */
  private buildParamValues(
    model: ModelDef<bigint> | ModelDef<number>
  ): unknown[] {
    return [
      model.id,
      model.provider,
      JSON.stringify(model.logicalAliases ?? []),
      Math.trunc(model.contextWindow),
      Math.trunc(model.maxOutputTokens),
      toDbCost(model.inputCostPerMTokMicro),
      toDbCost(model.outputCostPerMTokMicro),
      toDbCost(model.cacheReadCostPerMTokMicro, 0),
      model.supportsTools ? 1 : 0,
      model.supportsVision ? 1 : 0,
      model.supportsJsonSchema ? 1 : 0,
      model.deprecatedAt ?? null,
      model.sunsetAt ?? null,
      model.isActive !== false ? 1 : 0,
      model.lastSyncedAt ?? new Date().toISOString(),
    ];
  }

  /**
   * Find a model definition by its canonical ID.
   */
  async findById(id: string): Promise<ModelDef<bigint> | null> {
    const row = await this.db
      .prepare("SELECT * FROM model_registry WHERE id = ? LIMIT 1")
      .bind(id)
      .first<ModelRegistryRow>();

    return row ? rowToModelDef(row) : null;
  }

  /**
   * Get a model definition by its canonical ID, throwing ModelNotFoundError if missing.
   */
  async getById(id: string): Promise<ModelDef<bigint>> {
    const model = await this.findById(id);
    if (!model) {
      throw new ModelNotFoundError(id);
    }
    return model;
  }

  /**
   * Find the first active model mapped to the given logical alias.
   */
  async findByAlias(
    alias: string,
    onlyActive = true
  ): Promise<ModelDef<bigint> | null> {
    const matches = await this.findAllByAlias(alias, onlyActive);
    return matches[0] ?? null;
  }

  /**
   * Find all models mapped to the given logical alias, ordered by lowest input cost.
   */
  async findAllByAlias(
    alias: string,
    onlyActive = true
  ): Promise<ModelDef<bigint>[]> {
    const cleanAlias = alias.trim();
    if (!cleanAlias) {
      return [];
    }

    // Escape special SQL LIKE characters (% and _)
    const escaped = cleanAlias.replace(/[%_\\]/g, "\\$&");
    const likePattern = `%"${escaped}"%`;

    let sql = "SELECT * FROM model_registry WHERE logical_aliases LIKE ? ESCAPE '\\';";
    const params: unknown[] = [likePattern];

    if (onlyActive) {
      sql += " AND is_active = 1";
    }

    sql += " ORDER BY input_cost_per_mtok_micro ASC";

    const stmt = this.db.prepare(sql).bind(...params);
    const result = await stmt.all<ModelRegistryRow>();
    const models = (result.results ?? []).map(rowToModelDef);

    // Exact verification on parsed array to prevent false positive substring collisions
    return models.filter((m) => m.logicalAliases.includes(cleanAlias));
  }

  /**
   * Resolve an identifier that may be either a canonical model ID or a logical alias.
   */
  async resolveModel(
    idOrAlias: string,
    onlyActive = true
  ): Promise<ModelDef<bigint> | null> {
    const clean = idOrAlias.trim();
    if (!clean) {
      return null;
    }

    // 1. Check if it directly matches a canonical model ID
    const model = await this.findById(clean);
    if (model) {
      if (!onlyActive || model.isActive) {
        return model;
      }
      return null;
    }

    // 2. Fall back to logical alias lookup
    return this.findByAlias(clean, onlyActive);
  }

  /**
   * Resolve a canonical model ID or alias, throwing ModelNotFoundError if unresolved.
   */
  async getResolvedModel(
    idOrAlias: string,
    onlyActive = true
  ): Promise<ModelDef<bigint>> {
    const model = await this.resolveModel(idOrAlias, onlyActive);
    if (!model) {
      throw new ModelNotFoundError(idOrAlias);
    }
    return model;
  }

  /**
   * List all models matching arbitrary filter criteria.
   */
  async listAll(options: ModelFilterOptions = {}): Promise<ModelDef<bigint>[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.provider) {
      conditions.push("provider = ?");
      params.push(options.provider);
    }
    if (options.isActive !== undefined) {
      conditions.push("is_active = ?");
      params.push(options.isActive ? 1 : 0);
    }
    if (options.supportsTools !== undefined) {
      conditions.push("supports_tools = ?");
      params.push(options.supportsTools ? 1 : 0);
    }
    if (options.supportsVision !== undefined) {
      conditions.push("supports_vision = ?");
      params.push(options.supportsVision ? 1 : 0);
    }
    if (options.supportsJsonSchema !== undefined) {
      conditions.push("supports_json_schema = ?");
      params.push(options.supportsJsonSchema ? 1 : 0);
    }
    if (options.minContextWindow !== undefined) {
      conditions.push("context_window >= ?");
      params.push(Math.trunc(options.minContextWindow));
    }
    if (options.maxCostPerMTokMicro !== undefined) {
      conditions.push("input_cost_per_mtok_micro <= ?");
      params.push(toDbCost(options.maxCostPerMTokMicro));
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    let orderCol = "id";
    if (options.orderBy === "inputCost") {
      orderCol = "input_cost_per_mtok_micro";
    } else if (options.orderBy === "contextWindow") {
      orderCol = "context_window";
    }

    const direction = options.orderDirection === "DESC" ? "DESC" : "ASC";
    let pagination = "";

    if (options.limit !== undefined) {
      pagination += " LIMIT ?";
      params.push(Math.trunc(options.limit));
      if (options.offset !== undefined) {
        pagination += " OFFSET ?";
        params.push(Math.trunc(options.offset));
      }
    }

    const sql = `SELECT * FROM model_registry ${whereClause} ORDER BY ${orderCol} ${direction}${pagination}`;
    const stmt = this.db.prepare(sql).bind(...params);
    const result = await stmt.all<ModelRegistryRow>();
    return (result.results ?? []).map(rowToModelDef);
  }

  /**
   * List all active models, optionally filtered by provider.
   */
  async listActive(provider?: ModelProvider): Promise<ModelDef<bigint>[]> {
    return this.listAll({ isActive: true, provider });
  }

  /**
   * Find candidate models satisfying capability and context requirements.
   * Results are returned sorted by input cost ascending (cost-optimal).
   */
  async findCompatible(
    filter: ModelCapabilitiesFilter
  ): Promise<ModelDef<bigint>[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const onlyActive = filter.onlyActive ?? true;
    if (onlyActive) {
      conditions.push("is_active = 1");
    }
    if (filter.tools) {
      conditions.push("supports_tools = 1");
    }
    if (filter.vision) {
      conditions.push("supports_vision = 1");
    }
    if (filter.jsonSchema) {
      conditions.push("supports_json_schema = 1");
    }
    if (filter.minContextWindow !== undefined) {
      conditions.push("context_window >= ?");
      params.push(Math.trunc(filter.minContextWindow));
    }
    if (filter.estimatedPromptTokens !== undefined) {
      conditions.push("context_window >= ?");
      params.push(Math.trunc(filter.estimatedPromptTokens));
    }
    if (filter.maxCostPerMTokMicro !== undefined) {
      conditions.push("input_cost_per_mtok_micro <= ?");
      params.push(toDbCost(filter.maxCostPerMTokMicro));
    }
    if (filter.provider) {
      conditions.push("provider = ?");
      params.push(filter.provider);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM model_registry ${whereClause} ORDER BY input_cost_per_mtok_micro ASC`;

    const stmt = this.db.prepare(sql).bind(...params);
    const result = await stmt.all<ModelRegistryRow>();
    return (result.results ?? []).map(rowToModelDef);
  }

  /**
   * Create a new model definition. Throws if the model ID already exists.
   */
  async create(
    model: ModelDef<bigint> | ModelDef<number>
  ): Promise<ModelDef<bigint>> {
    const params = this.buildParamValues(model);
    await this.db.prepare(INSERT_MODEL_SQL).bind(...params).run();
    return this.getById(model.id);
  }

  /**
   * Upsert a model definition (insert or replace on conflict).
   */
  async upsert(
    model: ModelDef<bigint> | ModelDef<number>
  ): Promise<ModelDef<bigint>> {
    const params = this.buildParamValues(model);
    await this.db.prepare(UPSERT_MODEL_SQL).bind(...params).run();
    return this.getById(model.id);
  }

  /**
   * Update selective fields of an existing model definition.
   */
  async update(
    id: string,
    updates: Partial<ModelDef<bigint> | ModelDef<number>>
  ): Promise<ModelDef<bigint> | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.provider !== undefined) {
      setClauses.push("provider = ?");
      params.push(updates.provider);
    }
    if (updates.logicalAliases !== undefined) {
      setClauses.push("logical_aliases = ?");
      params.push(JSON.stringify(updates.logicalAliases));
    }
    if (updates.contextWindow !== undefined) {
      setClauses.push("context_window = ?");
      params.push(Math.trunc(updates.contextWindow));
    }
    if (updates.maxOutputTokens !== undefined) {
      setClauses.push("max_output_tokens = ?");
      params.push(Math.trunc(updates.maxOutputTokens));
    }
    if (updates.inputCostPerMTokMicro !== undefined) {
      setClauses.push("input_cost_per_mtok_micro = ?");
      params.push(toDbCost(updates.inputCostPerMTokMicro));
    }
    if (updates.outputCostPerMTokMicro !== undefined) {
      setClauses.push("output_cost_per_mtok_micro = ?");
      params.push(toDbCost(updates.outputCostPerMTokMicro));
    }
    if (updates.cacheReadCostPerMTokMicro !== undefined) {
      setClauses.push("cache_read_cost_per_mtok_micro = ?");
      params.push(toDbCost(updates.cacheReadCostPerMTokMicro));
    }
    if (updates.supportsTools !== undefined) {
      setClauses.push("supports_tools = ?");
      params.push(updates.supportsTools ? 1 : 0);
    }
    if (updates.supportsVision !== undefined) {
      setClauses.push("supports_vision = ?");
      params.push(updates.supportsVision ? 1 : 0);
    }
    if (updates.supportsJsonSchema !== undefined) {
      setClauses.push("supports_json_schema = ?");
      params.push(updates.supportsJsonSchema ? 1 : 0);
    }
    if (updates.deprecatedAt !== undefined) {
      setClauses.push("deprecated_at = ?");
      params.push(updates.deprecatedAt);
    }
    if (updates.sunsetAt !== undefined) {
      setClauses.push("sunset_at = ?");
      params.push(updates.sunsetAt);
    }
    if (updates.isActive !== undefined) {
      setClauses.push("is_active = ?");
      params.push(updates.isActive ? 1 : 0);
    }

    // Always refresh last_synced_at
    setClauses.push("last_synced_at = ?");
    params.push(updates.lastSyncedAt ?? new Date().toISOString());

    if (setClauses.length === 0) {
      return existing;
    }

    params.push(id);
    const sql = `UPDATE model_registry SET ${setClauses.join(", ")} WHERE id = ?`;
    await this.db.prepare(sql).bind(...params).run();

    return this.getById(id);
  }

  /**
   * Delete a model from the registry by ID.
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM model_registry WHERE id = ?")
      .bind(id)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  /**
   * Update the active status and optional sunset timestamp of a model.
   */
  async setActiveStatus(
    id: string,
    isActive: boolean,
    sunsetAt?: string | null
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.db
      .prepare(
        `UPDATE model_registry 
         SET is_active = ?, 
             sunset_at = CASE WHEN ? IS NOT NULL THEN ? ELSE sunset_at END, 
             last_synced_at = ? 
         WHERE id = ?`
      )
      .bind(isActive ? 1 : 0, sunsetAt ?? null, sunsetAt ?? null, now, id)
      .run();

    return (result.meta.changes ?? 0) > 0;
  }

  /**
   * Mark a model as deprecated with an optional sunset date.
   */
  async deprecate(
    id: string,
    deprecatedAt = new Date().toISOString(),
    sunsetAt?: string
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.db
      .prepare(
        `UPDATE model_registry 
         SET deprecated_at = ?, 
             sunset_at = CASE WHEN ? IS NOT NULL THEN ? ELSE sunset_at END, 
             last_synced_at = ? 
         WHERE id = ?`
      )
      .bind(deprecatedAt, sunsetAt ?? null, sunsetAt ?? null, now, id)
      .run();

    return (result.meta.changes ?? 0) > 0;
  }

  /**
   * Bulk upsert multiple models in an atomic transaction batch.
   */
  async bulkUpsert(
    models: (ModelDef<bigint> | ModelDef<number>)[]
  ): Promise<number> {
    if (models.length === 0) {
      return 0;
    }

    const statements: D1PreparedStatement[] = models.map((model) => {
      const params = this.buildParamValues(model);
      return this.db.prepare(UPSERT_MODEL_SQL).bind(...params);
    });

    await this.db.batch(statements);
    return models.length;
  }

  /**
   * Count the number of models matching the given filters.
   */
  async count(
    options: { provider?: ModelProvider; isActive?: boolean } = {}
  ): Promise<number> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.provider) {
      conditions.push("provider = ?");
      params.push(options.provider);
    }
    if (options.isActive !== undefined) {
      conditions.push("is_active = ?");
      params.push(options.isActive ? 1 : 0);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT COUNT(*) as count FROM model_registry ${whereClause}`;

    const row = await this.db
      .prepare(sql)
      .bind(...params)
      .first<{ count: number }>();

    return row?.count ?? 0;
  }

  /**
   * Build a Map mapping every configured logical alias to its primary canonical model ID.
   */
  async getAliasMap(onlyActive = true): Promise<Map<string, string>> {
    const models = await this.listAll({
      isActive: onlyActive ? true : undefined,
      orderBy: "inputCost",
      orderDirection: "ASC",
    });
    const aliasMap = new Map<string, string>();

    for (const model of models) {
      for (const alias of model.logicalAliases) {
        if (!aliasMap.has(alias)) {
          aliasMap.set(alias, model.id);
        }
      }
    }

    return aliasMap;
  }
}
