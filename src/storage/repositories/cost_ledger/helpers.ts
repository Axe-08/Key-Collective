/**
 * Key Collective v2 — Cost Ledger Validation & Math Helpers
 *
 * Invariants (GEMINI.md Constitution):
 * - Fixed-Point CreditUnits: All costs in `int64` / `bigint` credit units (1 USD = 1,000,000 CU).
 *   Zero floating-point math for financials to eliminate IEEE 754 precision errors.
 * - Strict type-guarding and canonical day formatting.
 */

import type { CostLedgerEvent, ModelPricing } from "../../../types/models";
import { InvalidCostLedgerEventError } from "./errors";
import type { DailySpendRollup } from "./types";

const CU_SCALE_MULTIPLIER = 1_000_000n;

/**
 * Validates that an input value is a valid int64 credit unit amount.
 * Strictly forbids floating-point numbers to prevent financial precision loss.
 */
export function validateCuAmount(
  value: bigint | number,
  fieldName = "costCu"
): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new InvalidCostLedgerEventError(
        `${fieldName} cannot be negative: ${value.toString()}`
      );
    }
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InvalidCostLedgerEventError(
        `${fieldName} must be a finite integer, got: ${value}`
      );
    }
    if (!Number.isInteger(value)) {
      throw new InvalidCostLedgerEventError(
        `${fieldName} must be an integer (floating point not allowed for financials): ${value}`
      );
    }
    if (value < 0) {
      throw new InvalidCostLedgerEventError(
        `${fieldName} cannot be negative: ${value}`
      );
    }
    return BigInt(value);
  }

  throw new InvalidCostLedgerEventError(
    `${fieldName} must be a bigint or integer number`
  );
}

/**
 * Formats a Date instance or date string into a canonical YYYY-MM-DD calendar day.
 */
export function formatCalendarDay(dateOrString: string | Date): string {
  if (dateOrString instanceof Date) {
    if (Number.isNaN(dateOrString.getTime())) {
      throw new InvalidCostLedgerEventError("Invalid Date instance provided");
    }
    return dateOrString.toISOString().slice(0, 10);
  }

  if (typeof dateOrString === "string") {
    const trimmed = dateOrString.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  throw new InvalidCostLedgerEventError(
    `Invalid date format for calendar day: '${String(dateOrString)}'`
  );
}

/**
 * Calculates exact transaction cost in int64 credit units from token counts and pricing.
 * Zero floating-point arithmetic: (tokens * price_micro) // 1_000_000n.
 */
export function calculateEventCostCu(
  tokens: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
    reasoningTokens?: number;
  },
  pricing: ModelPricing<bigint>
): bigint {
  const promptTokens = BigInt(Math.max(0, Math.trunc(tokens.promptTokens)));
  const completionTokens = BigInt(Math.max(0, Math.trunc(tokens.completionTokens)));
  const reasoningTokens = BigInt(Math.max(0, Math.trunc(tokens.reasoningTokens ?? 0)));
  const cachedTokens = BigInt(Math.max(0, Math.trunc(tokens.cachedTokens ?? 0)));

  const inputCost = (promptTokens * pricing.inputCostPerMTokMicro) / CU_SCALE_MULTIPLIER;
  const outputCost =
    ((completionTokens + reasoningTokens) * pricing.outputCostPerMTokMicro) /
    CU_SCALE_MULTIPLIER;
  const cacheCost =
    (cachedTokens * pricing.cacheReadCostPerMTokMicro) / CU_SCALE_MULTIPLIER;

  return inputCost + outputCost + cacheCost;
}

/**
 * Type guard for DailySpendRollup.
 */
export function isDailySpendRollup(value: unknown): value is DailySpendRollup {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const hasValidCost =
    candidate.totalCostCu === undefined ||
    typeof candidate.totalCostCu === "bigint" ||
    (typeof candidate.totalCostCu === "number" &&
      Number.isInteger(candidate.totalCostCu));
  return (
    typeof candidate.tenantId === "string" &&
    typeof candidate.day === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.modelId === "string" &&
    typeof candidate.totalRequests === "number" &&
    typeof candidate.totalTokens === "number" &&
    hasValidCost
  );
}

/**
 * Type guard for CostLedgerEvent.
 */
export function isCostLedgerEvent(value: unknown): value is CostLedgerEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const hasValidCost =
    candidate.costCu === undefined ||
    typeof candidate.costCu === "bigint" ||
    (typeof candidate.costCu === "number" &&
      Number.isInteger(candidate.costCu));
  return (
    typeof candidate.id === "string" &&
    typeof candidate.requestId === "string" &&
    typeof candidate.tenantId === "string" &&
    typeof candidate.keyId === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.modelId === "string" &&
    typeof candidate.promptTokens === "number" &&
    typeof candidate.completionTokens === "number" &&
    typeof candidate.statusCode === "number" &&
    hasValidCost
  );
}
