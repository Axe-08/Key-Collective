import type { ModelDef, ModelProvider } from "../../../types/models";
import { ModelNotFoundError } from "../../../errors/routing_errors";
import type {
  ModelRegistryRow,
  ModelFilterOptions,
  ModelCapabilitiesFilter,
  IModelRegistryRepository,
} from "./types";
import { toDbCost, rowToModelDef } from "./mapper";
import { INSERT_MODEL_SQL, UPSERT_MODEL_SQL } from "./sql";

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
