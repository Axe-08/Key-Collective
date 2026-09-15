import { ModelDef, ModelProvider, ModelAlias } from "../../../types/models";
import type { ModelRegistryRow } from "./types";

/**
 * Helper to safely convert microdollar bigint/number to integer representation for D1 parameter binding.
 * Enforces zero floating-point math by truncating/checking safe integer bounds.
 */
export function toDbCost(cost: bigint | number | undefined, defaultValue = 0): number {
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
export function parseAliases(raw: unknown): ModelAlias[] {
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
