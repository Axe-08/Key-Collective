import { DEFAULT_RETRY_AFTER_SECONDS } from "../../constants/limits";
import type { RateLimiterData } from "./types";

/**
 * Prunes entries older than the day window (24 hours).
 * Returns true if any entries were removed.
 */
export function pruneExpiredEntries(
  data: RateLimiterData,
  now: number,
  dayWindowMs: number
): boolean {
  const cutoff = now - dayWindowMs;
  const originalLength = data.entries.length;
  data.entries = data.entries.filter((entry) => entry.timestamp > cutoff);
  return data.entries.length !== originalLength;
}

/**
 * Calculates current RPM from in-memory entries within sliding window.
 */
export function calculateRpm(
  data: RateLimiterData,
  now: number,
  windowSizeMs: number
): number {
  const cutoff = now - windowSizeMs;
  let count = 0;
  for (let i = data.entries.length - 1; i >= 0; i--) {
    const entry = data.entries[i];
    if (entry && entry.timestamp > cutoff) {
      count += entry.count;
    } else {
      break; // Entries are appended chronologically
    }
  }
  return count;
}

/**
 * Calculates current RPD from in-memory entries within daily window.
 */
export function calculateRpd(
  data: RateLimiterData,
  now: number,
  dayWindowMs: number
): number {
  const cutoff = now - dayWindowMs;
  let count = 0;
  for (let i = 0; i < data.entries.length; i++) {
    const entry = data.entries[i];
    if (entry && entry.timestamp > cutoff) {
      count += entry.count;
    }
  }
  return count;
}

/**
 * Calculates seconds until the oldest request in the current RPM window slides out.
 */
export function calculateRpmRetryAfter(
  data: RateLimiterData,
  now: number,
  windowSizeMs: number
): number {
  const cutoff = now - windowSizeMs;
  for (let i = 0; i < data.entries.length; i++) {
    const entry = data.entries[i];
    if (entry && entry.timestamp > cutoff) {
      const remainingMs = entry.timestamp + windowSizeMs - now;
      return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 1;
    }
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

/**
 * Calculates seconds until the oldest request in the daily window slides out.
 */
export function calculateRpdRetryAfter(
  data: RateLimiterData,
  now: number,
  dayWindowMs: number
): number {
  const cutoff = now - dayWindowMs;
  for (let i = 0; i < data.entries.length; i++) {
    const entry = data.entries[i];
    if (entry && entry.timestamp > cutoff) {
      const remainingMs = entry.timestamp + dayWindowMs - now;
      return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 1;
    }
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}
