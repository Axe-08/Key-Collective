/**
 * @file sorter.ts
 * Cost and context optimal candidate sorting. Cost is the CU weight
 * (cuBase + cuInPer1k + cuOutPer1k); Credit Units are the only price unit.
 */

import { ModelDef } from "../../types/models";
import { compareByCuWeight } from "../registry/helpers";
import { ModelSortStrategy } from "./types";

/**
 * Sorts candidate models by the chosen strategy.
 */
export function sortCandidates(
  candidates: ModelDef[],
  strategy: ModelSortStrategy
): ModelDef[] {
  const result = [...candidates];
  switch (strategy) {
    case "cost-asc":
      return result.sort((a, b) => {
        const byCu = compareByCuWeight(a, b);
        if (byCu !== 0) return byCu;
        if (a.contextWindow !== b.contextWindow) {
          return b.contextWindow - a.contextWindow; // Larger context preferred as tie-breaker
        }
        return a.id.localeCompare(b.id);
      });
    case "cost-desc":
      return result.sort((a, b) => {
        const byCu = compareByCuWeight(b, a);
        if (byCu !== 0) return byCu;
        return b.id.localeCompare(a.id);
      });
    case "context-desc":
      return result.sort((a, b) => {
        if (a.contextWindow !== b.contextWindow) {
          return b.contextWindow - a.contextWindow;
        }
        const byCu = compareByCuWeight(a, b);
        if (byCu !== 0) return byCu;
        return a.id.localeCompare(b.id);
      });
    case "none":
    default:
      return result;
  }
}
