/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Financial System Constants & Fixed-Point Microdollars Logic
 *
 * Invariants:
 * - Fixed-Point Microdollars: All costs in int64 / bigint microdollars (1 USD = 1,000,000 µ$).
 * - Zero floating-point math for financials to eliminate IEEE 754 precision loss.
 * - Adheres strictly to LLD 1.1: MICRODOLLAR_MULTIPLIER = 1_000_000n.
 */

/**
 * Multiplier to convert USD ($) to microdollars (µ$).
 * 1 USD = 1,000,000 µ$.
 * As specified in LLD 1.1: MICRODOLLAR_MULTIPLIER: 1_000_000n (BigInt).
 */
export const MICRODOLLAR_MULTIPLIER = 1_000_000n as const;

/**
 * Synonym alias for MICRODOLLAR_MULTIPLIER.
 */
export const MICRODOLLARS_PER_DOLLAR = MICRODOLLAR_MULTIPLIER;

/**
 * Fixed-point value of a single microdollar.
 */
export const ONE_MICRODOLLAR = 1n as const;

/**
 * Multiplier for one US cent in microdollars.
 * 1 cent = 0.01 USD = 10,000 µ$.
 */
export const ONE_CENT_MICRODOLLARS = 10_000n as const;

/**
 * Multiplier for one US Dollar in microdollars.
 */
export const ONE_DOLLAR_MICRODOLLARS = 1_000_000n as const;

/**
 * Default tenant spending budget cap in microdollars ($100.00 USD).
 */
export const DEFAULT_MAX_BUDGET_MICRODOLLARS = 100_000_000n as const;

/**
 * Default threshold percentage (0-100) at which warning alerts fire.
 */
export const DEFAULT_BUDGET_ALERT_THRESHOLD_PERCENT = 80 as const;

/**
 * Minimum financial unit representable in system.
 */
export const MIN_MICRODOLLARS = 0n as const;

/**
 * Converts a dollar amount (as a string or number) to exact microdollars (bigint)
 * using string splitting to avoid floating point math inaccuracies.
 * E.g. "0.000005" -> 5n
 * E.g. 1.25 -> 1_250_000n
 */
export function dollarsToMicrodollars(dollars: number | string): bigint {
  const str = typeof dollars === "number" ? dollars.toFixed(6) : dollars.trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new TypeError(`Invalid dollar amount string: '${dollars}'`);
  }

  const isNegative = str.startsWith("-");
  const cleaned = isNegative ? str.slice(1) : str;
  const parts = cleaned.split(".");
  const integerPart = parts[0] ?? "0";
  let fractionPart = parts[1] ?? "";

  // Pad fraction to 6 places (microdollars), or truncate extra decimals
  if (fractionPart.length < 6) {
    fractionPart = fractionPart.padEnd(6, "0");
  } else if (fractionPart.length > 6) {
    fractionPart = fractionPart.slice(0, 6);
  }

  const intBig = BigInt(integerPart);
  const fracBig = BigInt(fractionPart);
  const total = intBig * MICRODOLLAR_MULTIPLIER + fracBig;

  return isNegative ? -total : total;
}

/**
 * Converts microdollars to decimal USD dollars (number).
 * Note: Use only for presentation or UI display, never for internal financial calculations.
 */
export function microdollarsToDollars(microdollars: bigint): number {
  return Number(microdollars) / Number(MICRODOLLAR_MULTIPLIER);
}

/**
 * Converts whole cents to microdollars.
 * E.g. 50 cents -> 500_000n µ$.
 */
export function centsToMicrodollars(cents: number | bigint): bigint {
  const c = typeof cents === "bigint" ? cents : BigInt(Math.trunc(cents));
  return c * ONE_CENT_MICRODOLLARS;
}

/**
 * Converts microdollars to whole cents (truncated).
 */
export function microdollarsToCents(microdollars: bigint): bigint {
  return microdollars / ONE_CENT_MICRODOLLARS;
}

/**
 * Formats a microdollar value into a human-readable USD string.
 * E.g. 1_500_000n -> "$1.50"
 * E.g. 12n -> "$0.000012"
 */
export function formatMicrodollars(
  microdollars: bigint,
  options?: {
    includeSymbol?: boolean;
    precision?: "cents" | "microdollars" | "auto";
  }
): string {
  const includeSymbol = options?.includeSymbol ?? true;
  const precision = options?.precision ?? "auto";

  const isNegative = microdollars < 0n;
  const abs = isNegative ? -microdollars : microdollars;

  const intPart = abs / MICRODOLLAR_MULTIPLIER;
  const fracPart = abs % MICRODOLLAR_MULTIPLIER;
  const fracStr = fracPart.toString().padStart(6, "0");

  let formattedFrac: string;
  if (precision === "cents") {
    formattedFrac = fracStr.slice(0, 2);
  } else if (precision === "microdollars") {
    formattedFrac = fracStr;
  } else {
    // "auto": if sub-cent precision exists, show up to 6 decimals (trimmed trailing zeros down to 2 decimals)
    if (fracPart % ONE_CENT_MICRODOLLARS === 0n) {
      formattedFrac = fracStr.slice(0, 2);
    } else {
      formattedFrac = fracStr.replace(/0+$/, "");
      if (formattedFrac.length < 2) {
        formattedFrac = formattedFrac.padEnd(2, "0");
      }
    }
  }

  const sign = isNegative ? "-" : "";
  const symbol = includeSymbol ? "$" : "";
  return `${sign}${symbol}${intPart.toString()}.${formattedFrac}`;
}

/**
 * Validates if an unknown value is a valid non-negative microdollar amount.
 */
export function isValidMicrodollarAmount(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n;
}
