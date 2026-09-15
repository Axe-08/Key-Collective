import { ModelDef, ModelProvider } from "../../../types/models";

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
