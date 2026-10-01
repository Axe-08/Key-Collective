/**
 * Key Collective v2 — Provider Configuration
 *
 * Single source of truth for supported model providers, their base URLs,
 * and their daily quota reset timezones.
 * Conforms to LLD 3.4 (Providers and model catalog) and WP-5.8.
 */

/**
 * Supported upstream provider identifiers.
 */
export type ProviderId = "google" | "groq";

/**
 * Configuration for a single upstream provider.
 */
export interface ProviderConfig {
  /** Canonical provider identifier. */
  id: ProviderId;
  /** Base URL for the provider's OpenAI-compatible API surface. */
  baseUrl: string;
  /** IANA timezone identifier in which the provider's daily RPD quota resets at 00:00:00. */
  dailyResetTz: string;
}

/**
 * Provider daily quota reset timezones (WP-5.8 T-5.8.1).
 */
export const PROVIDER_RESET: Record<string, { dailyResetTz: string }> = {
  google: { dailyResetTz: "America/Los_Angeles" },
  gemini: { dailyResetTz: "America/Los_Angeles" },
  groq: { dailyResetTz: "UTC" },
};

/**
 * The single, authoritative list of supported providers and their base URLs.
 */
export const PROVIDERS: Readonly<Record<ProviderId, ProviderConfig>> = {
  google: {
    id: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    dailyResetTz: PROVIDER_RESET.google.dailyResetTz,
  },
  groq: {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    dailyResetTz: PROVIDER_RESET.groq.dailyResetTz,
  },
} as const;

/**
 * Default base URLs for supported model providers, derived from PROVIDERS.
 */
export const PROVIDER_BASE_URLS: Readonly<Record<ProviderId, string>> = {
  google: PROVIDERS.google.baseUrl,
  groq: PROVIDERS.groq.baseUrl,
} as const;

function getTzParts(
  epochMs: number,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(epochMs));
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = parseInt(part.value, 10);
    }
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute,
    second: map.second,
  };
}

function localMidnightToUtcMs(
  year: number,
  month: number,
  day: number,
  timeZone: string
): number {
  const targetLocalAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const p1 = getTzParts(targetLocalAsUtc, timeZone);
  const offset1 =
    Date.UTC(p1.year, p1.month - 1, p1.day, p1.hour, p1.minute, p1.second, 0) -
    targetLocalAsUtc;
  const guess1 = targetLocalAsUtc - offset1;

  const p2 = getTzParts(guess1, timeZone);
  const offset2 =
    Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute, p2.second, 0) -
    guess1;
  return targetLocalAsUtc - offset2;
}

/**
 * Computes the next daily quota reset timestamp (epoch milliseconds) strictly after `now`
 * in the provider's configured reset timezone (`PROVIDER_RESET`).
 */
export function nextProviderReset(provider: string, now: number): number {
  const norm = provider.trim().toLowerCase();
  const tz = PROVIDER_RESET[norm]?.dailyResetTz ?? "UTC";
  if (tz === "UTC") {
    const dayMs = 86_400_000;
    return (Math.floor(now / dayMs) + 1) * dayMs;
  }

  const currentLocal = getTzParts(now, tz);
  const nextDateUtc = new Date(
    Date.UTC(currentLocal.year, currentLocal.month - 1, currentLocal.day + 1)
  );
  return localMidnightToUtcMs(
    nextDateUtc.getUTCFullYear(),
    nextDateUtc.getUTCMonth() + 1,
    nextDateUtc.getUTCDate(),
    tz
  );
}
