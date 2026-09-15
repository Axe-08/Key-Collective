import type { RateLimitEntry, RateLimiterData } from "./types";

/**
 * Factory for initial rate limiter data.
 */
export function createDefaultRateLimiterData(): RateLimiterData {
  return {
    entries: [],
    totalCostMicrodollars: "0",
    lastRequestTime: null,
  };
}

/**
 * Type guard for RateLimitEntry.
 */
export function isRateLimitEntry(value: unknown): value is RateLimitEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.timestamp === "number" &&
    typeof candidate.count === "number" &&
    typeof candidate.costMicrodollars === "string"
  );
}

/**
 * Type guard for RateLimiterData.
 */
export function isRateLimiterData(value: unknown): value is RateLimiterData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.entries) &&
    candidate.entries.every(isRateLimitEntry) &&
    typeof candidate.totalCostMicrodollars === "string" &&
    (candidate.lastRequestTime === null || typeof candidate.lastRequestTime === "number")
  );
}
