/**
 * Key Collective v2 — Model Registry Normalization & Calculation Helpers
 *
 * Invariants (GEMINI.md Constitution):
 * - Credit Units (CU) are the only price unit (bigint, zero floating-point math).
 */

import type { ModelDef } from "../../types/models";

/**
 * Relative CU weight of a model, used to pick the cheapest candidate:
 * cuBase + cuInPer1k + cuOutPer1k (RA-09).
 */
export function cuWeight(model: Pick<ModelDef, "cuBase" | "cuInPer1k" | "cuOutPer1k">): bigint {
  return (model.cuBase ?? 0n) + (model.cuInPer1k ?? 0n) + (model.cuOutPer1k ?? 0n);
}

/**
 * Orders two models by CU weight ascending.
 */
export function compareByCuWeight(a: ModelDef, b: ModelDef): number {
  const wa = cuWeight(a);
  const wb = cuWeight(b);
  if (wa < wb) return -1;
  if (wa > wb) return 1;
  return 0;
}

/**
 * Normalizes a ModelDef (trimmed aliases, integer limits, default isActive).
 */
export function normalizeModelDef(model: ModelDef): ModelDef {
  return {
    ...model,
    contextWindow: Math.trunc(model.contextWindow),
    maxOutputTokens: Math.trunc(model.maxOutputTokens),
    logicalAliases: (model.logicalAliases ?? []).map((a) => String(a).trim()).filter(Boolean),
    isActive: model.isActive ?? true,
  };
}
