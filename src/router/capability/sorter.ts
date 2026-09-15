/**
 * @file sorter.ts
 * Cost and context optimal candidate sorting.
 */

import { ModelDef } from "../../types/models";
import { ModelSortStrategy } from "./types";

/**
 * Sorts candidate models by the chosen strategy.
 */
export function sortCandidates(
  candidates: ModelDef<bigint>[],
  strategy: ModelSortStrategy
): ModelDef<bigint>[] {
  const result = [...candidates];
  switch (strategy) {
    case "cost-asc":
      return result.sort((a, b) => {
        if (a.inputCostPerMTokMicro !== b.inputCostPerMTokMicro) {
          return a.inputCostPerMTokMicro < b.inputCostPerMTokMicro ? -1 : 1;
        }
        if (a.outputCostPerMTokMicro !== b.outputCostPerMTokMicro) {
          return a.outputCostPerMTokMicro < b.outputCostPerMTokMicro ? -1 : 1;
        }
        if (a.contextWindow !== b.contextWindow) {
          return b.contextWindow - a.contextWindow; // Larger context preferred as tie-breaker
        }
        return a.id.localeCompare(b.id);
      });
    case "cost-desc":
      return result.sort((a, b) => {
        if (a.inputCostPerMTokMicro !== b.inputCostPerMTokMicro) {
          return a.inputCostPerMTokMicro > b.inputCostPerMTokMicro ? -1 : 1;
        }
        return b.id.localeCompare(a.id);
      });
    case "context-desc":
      return result.sort((a, b) => {
        if (a.contextWindow !== b.contextWindow) {
          return b.contextWindow - a.contextWindow;
        }
        if (a.inputCostPerMTokMicro !== b.inputCostPerMTokMicro) {
          return a.inputCostPerMTokMicro < b.inputCostPerMTokMicro ? -1 : 1;
        }
        return a.id.localeCompare(b.id);
      });
    case "none":
    default:
      return result;
  }
}
