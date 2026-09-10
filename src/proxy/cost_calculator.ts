/**
 * Cost Calculation Utilities for LLM Proxy
 *
 * Implements fixed-point microdollar cost calculations based on token usage.
 * Microdollar standard: 1 USD = 1,000,000 µ$ (int64/bigint).
 * Zero floating-point math for financial operations.
 */

export const MICRODOLLARS_PER_USD = 1_000_000n;
export const TOKENS_PER_MILLION = 1_000_000n;

export interface TokenUsage {
  promptTokens: number | bigint;
  completionTokens: number | bigint;
  totalTokens?: number | bigint;
}

export interface ModelPricing {
  promptMicrodollarsPerMillion: bigint;
  completionMicrodollarsPerMillion: bigint;
}

export interface CostBreakdown {
  promptCostMicrodollars: bigint;
  completionCostMicrodollars: bigint;
  totalCostMicrodollars: bigint;
}

/**
 * Standard pricing table in microdollars per 1,000,000 tokens.
 * 1 USD = 1,000,000 microdollars.
 * E.g., $2.50 / 1M tokens = 2,500,000 µ$.
 */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI Models
  'gpt-4o': {
    promptMicrodollarsPerMillion: 2_500_000n, // $2.50 / 1M
    completionMicrodollarsPerMillion: 10_000_000n, // $10.00 / 1M
  },
  'gpt-4o-mini': {
    promptMicrodollarsPerMillion: 150_000n, // $0.15 / 1M
    completionMicrodollarsPerMillion: 600_000n, // $0.60 / 1M
  },
  'gpt-4-turbo': {
    promptMicrodollarsPerMillion: 10_000_000n, // $10.00 / 1M
    completionMicrodollarsPerMillion: 30_000_000n, // $30.00 / 1M
  },
  'gpt-4': {
    promptMicrodollarsPerMillion: 30_000_000n, // $30.00 / 1M
    completionMicrodollarsPerMillion: 60_000_000n, // $60.00 / 1M
  },
  'gpt-3.5-turbo': {
    promptMicrodollarsPerMillion: 500_000n, // $0.50 / 1M
    completionMicrodollarsPerMillion: 1_500_000n, // $1.50 / 1M
  },
  'o1': {
    promptMicrodollarsPerMillion: 15_000_000n, // $15.00 / 1M
    completionMicrodollarsPerMillion: 60_000_000n, // $60.00 / 1M
  },
  'o1-mini': {
    promptMicrodollarsPerMillion: 3_000_000n, // $3.00 / 1M
    completionMicrodollarsPerMillion: 12_000_000n, // $12.00 / 1M
  },
  'text-embedding-3-small': {
    promptMicrodollarsPerMillion: 20_000n, // $0.02 / 1M
    completionMicrodollarsPerMillion: 0n,
  },
  'text-embedding-3-large': {
    promptMicrodollarsPerMillion: 130_000n, // $0.13 / 1M
    completionMicrodollarsPerMillion: 0n,
  },

  // Anthropic Models
  'claude-3-5-sonnet': {
    promptMicrodollarsPerMillion: 3_000_000n, // $3.00 / 1M
    completionMicrodollarsPerMillion: 15_000_000n, // $15.00 / 1M
  },
  'claude-3-5-haiku': {
    promptMicrodollarsPerMillion: 800_000n, // $0.80 / 1M
    completionMicrodollarsPerMillion: 4_000_000n, // $4.00 / 1M
  },
  'claude-3-opus': {
    promptMicrodollarsPerMillion: 15_000_000n, // $15.00 / 1M
    completionMicrodollarsPerMillion: 75_000_000n, // $75.00 / 1M
  },
  'claude-3-sonnet': {
    promptMicrodollarsPerMillion: 3_000_000n, // $3.00 / 1M
    completionMicrodollarsPerMillion: 15_000_000n, // $15.00 / 1M
  },
  'claude-3-haiku': {
    promptMicrodollarsPerMillion: 250_000n, // $0.25 / 1M
    completionMicrodollarsPerMillion: 1_250_000n, // $1.25 / 1M
  },

  // Default fallback rate for unspecified models ($1.00 prompt / $3.00 completion)
  'default': {
    promptMicrodollarsPerMillion: 1_000_000n,
    completionMicrodollarsPerMillion: 3_000_000n,
  },
};

/**
 * Mutable registry for dynamic or custom model pricing.
 */
const customModelPricing: Map<string, ModelPricing> = new Map();

/**
 * Registers custom pricing for a model.
 */
export function registerModelPricing(model: string, pricing: ModelPricing): void {
  customModelPricing.set(model.toLowerCase().trim(), pricing);
}

/**
 * Clears custom model pricing entries (primarily for testing).
 */
export function clearCustomModelPricing(): void {
  customModelPricing.clear();
}

/**
 * Normalizes model names by lowercasing, trimming, and stripping provider prefixes
 * and snapshot date suffixes where appropriate.
 */
export function normalizeModelName(model: string): string {
  let normalized = model.toLowerCase().trim();

  // Strip provider prefix if present (e.g., 'openai/gpt-4o' -> 'gpt-4o')
  const slashIdx = normalized.indexOf('/');
  if (slashIdx !== -1) {
    normalized = normalized.substring(slashIdx + 1);
  }

  return normalized;
}

/**
 * Resolves the ModelPricing configuration for a given model identifier.
 * Matches exact matches first, then prefix matches (e.g. 'gpt-4o-2024-08-06' -> 'gpt-4o'),
 * falling back to the 'default' pricing.
 */
export function getModelPricing(model: string): ModelPricing {
  const normalized = normalizeModelName(model);

  // 1. Check custom registry exact match
  const custom = customModelPricing.get(normalized);
  if (custom) {
    return custom;
  }

  // 2. Check default pricing exact match
  if (normalized in DEFAULT_MODEL_PRICING) {
    return DEFAULT_MODEL_PRICING[normalized];
  }

  // 3. Prefix matching for versioned models (e.g., 'gpt-4o-2024-05-13' matches 'gpt-4o')
  for (const [key, pricing] of Object.entries(DEFAULT_MODEL_PRICING)) {
    if (key !== 'default' && normalized.startsWith(key)) {
      return pricing;
    }
  }

  // 4. Fallback default pricing
  return DEFAULT_MODEL_PRICING['default'];
}

/**
 * Calculates token cost in bigint microdollars using pure integer arithmetic.
 *
 * Formula:
 * (tokens * ratePerMillionMicrodollars + roundUpOffset) / 1_000_000
 *
 * @param tokens Number of tokens consumed
 * @param ratePerMillionMicrodollars Pricing in microdollars per 1M tokens
 * @param roundUp If true, applies ceiling division so fractional microdollars round up to 1µ$
 */
export function calculateTokenCost(
  tokens: number | bigint,
  ratePerMillionMicrodollars: bigint,
  roundUp: boolean = false
): bigint {
  const t = typeof tokens === 'bigint' ? tokens : BigInt(Math.max(0, Math.floor(tokens)));
  if (t <= 0n || ratePerMillionMicrodollars <= 0n) {
    return 0n;
  }

  const numerator = t * ratePerMillionMicrodollars;
  if (roundUp) {
    return (numerator + (TOKENS_PER_MILLION - 1n)) / TOKENS_PER_MILLION;
  }
  return numerator / TOKENS_PER_MILLION;
}

/**
 * Calculates detailed cost breakdown (prompt, completion, total) in microdollars.
 *
 * @param model Model identifier
 * @param usage Token usage numbers
 * @param roundUp Whether to round up fractional microdollars
 */
export function calculateCostBreakdown(
  model: string,
  usage: TokenUsage,
  roundUp: boolean = false
): CostBreakdown {
  const pricing = getModelPricing(model);

  const promptCostMicrodollars = calculateTokenCost(
    usage.promptTokens,
    pricing.promptMicrodollarsPerMillion,
    roundUp
  );

  const completionCostMicrodollars = calculateTokenCost(
    usage.completionTokens,
    pricing.completionMicrodollarsPerMillion,
    roundUp
  );

  const totalCostMicrodollars = promptCostMicrodollars + completionCostMicrodollars;

  return {
    promptCostMicrodollars,
    completionCostMicrodollars,
    totalCostMicrodollars,
  };
}

/**
 * Calculates total cost in microdollars for a given model and token usage.
 *
 * @param model Model identifier
 * @param usage Token usage numbers
 * @param roundUp Whether to round up fractional microdollars
 */
export function calculateCost(
  model: string,
  usage: TokenUsage,
  roundUp: boolean = false
): bigint {
  return calculateCostBreakdown(model, usage, roundUp).totalCostMicrodollars;
}

/**
 * Converts a decimal USD string or number into bigint microdollars without floating-point errors.
 * e.g., "0.0025" or 0.0025 -> 2500n
 * E.g., "1.5" -> 1500000n
 */
export function usdToMicrodollars(usd: string | number): bigint {
  const str = typeof usd === 'number' ? usd.toFixed(6) : usd.trim();
  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;

  const parts = unsigned.split('.');
  const wholePart = parts[0] ? BigInt(parts[0]) : 0n;
  const fractionalStr = (parts[1] || '').padEnd(6, '0').slice(0, 6);
  const fracPart = BigInt(fractionalStr);

  const result = wholePart * MICRODOLLARS_PER_USD + fracPart;
  return negative ? -result : result;
}

/**
 * Converts bigint microdollars to formatted USD string without floating-point precision loss.
 * e.g., 2_500_000n -> "$2.500000" or trimmed "$2.50"
 */
export function microdollarsToUsdString(microdollars: bigint, minDecimals: number = 2): string {
  const isNegative = microdollars < 0n;
  const abs = isNegative ? -microdollars : microdollars;

  const whole = abs / MICRODOLLARS_PER_USD;
  const frac = abs % MICRODOLLARS_PER_USD;

  let fracStr = frac.toString().padStart(6, '0');
  if (minDecimals < 6) {
    // Trim trailing zeros but preserve at least minDecimals
    let trimmed = fracStr;
    while (trimmed.length > minDecimals && trimmed.endsWith('0')) {
      trimmed = trimmed.slice(0, -1);
    }
    fracStr = trimmed;
  }

  const sign = isNegative ? '-' : '';
  return `${sign}$${whole.toString()}.${fracStr}`;
}
