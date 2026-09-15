/**
 * Key Collective v2 — Model Registry Normalization & Calculation Helpers
 *
 * Invariants (GEMINI.md Constitution):
 * - Fixed-Point Microdollars: All costs in `int64` / `bigint` microdollars.
 *   Zero floating-point math for financials.
 */

import type { ModelDef } from "../../types/models";

/**
 * Normalizes input cost to bigint microdollars.
 */
export function toBigIntMicro(value: bigint | number | undefined, defaultValue = 0n): bigint {
  if (value === undefined) return defaultValue;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Invalid cost number: ${value}`);
    }
    return BigInt(Math.trunc(value));
  }
  return defaultValue;
}

/**
 * Normalizes any ModelDef input to ModelDef<bigint>.
 */
export function normalizeModelDef(
  model: ModelDef<bigint> | ModelDef<number>
): ModelDef<bigint> {
  return {
    ...model,
    inputCostPerMTokMicro: toBigIntMicro(model.inputCostPerMTokMicro),
    outputCostPerMTokMicro: toBigIntMicro(model.outputCostPerMTokMicro),
    cacheReadCostPerMTokMicro: toBigIntMicro(model.cacheReadCostPerMTokMicro, 0n),
    contextWindow: Math.trunc(model.contextWindow),
    maxOutputTokens: Math.trunc(model.maxOutputTokens),
    logicalAliases: (model.logicalAliases ?? []).map((a) => String(a).trim()).filter(Boolean),
    isActive: model.isActive ?? true,
  };
}
