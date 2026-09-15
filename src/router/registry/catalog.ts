/**
 * Key Collective v2 — Default Model Catalogue & Pricing Table
 *
 * Invariants (GEMINI.md Constitution):
 * - Fixed-point microdollars (bigint / int64) throughout. Zero float math.
 * - Multi-provider benchmark configurations (Google, OpenAI, Anthropic, Groq, DeepSeek).
 */

import type { ModelDef } from "../../types/models";

export const DEFAULT_MODEL_DEFINITIONS: readonly ModelDef<bigint>[] = [
  {
    id: "gemini-2.0-flash",
    provider: "google",
    logicalAliases: ["smart-fast", "fast-model", "fast"],
    contextWindow: 1_048_576,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 100_000n, // $0.10 / 1M
    outputCostPerMTokMicro: 400_000n, // $0.40 / 1M
    cacheReadCostPerMTokMicro: 25_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: "2026-09-01T00:00:00.000Z",
    sunsetAt: "2026-12-31T00:00:00.000Z",
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "gemini-1.5-pro",
    provider: "google",
    logicalAliases: ["smart-model", "reasoning"],
    contextWindow: 2_097_152,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 1_250_000n, // $1.25 / 1M
    outputCostPerMTokMicro: 5_000_000n, // $5.00 / 1M
    cacheReadCostPerMTokMicro: 312_500n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: "2026-09-01T00:00:00.000Z",
    sunsetAt: "2026-12-31T00:00:00.000Z",
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "gpt-4o",
    provider: "openai",
    logicalAliases: ["smart-model", "reasoning", "vision"],
    contextWindow: 128_000,
    maxOutputTokens: 16384,
    inputCostPerMTokMicro: 2_500_000n, // $2.50 / 1M
    outputCostPerMTokMicro: 10_000_000n, // $10.00 / 1M
    cacheReadCostPerMTokMicro: 1_250_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    logicalAliases: ["fast-model", "economy", "fast"],
    contextWindow: 128_000,
    maxOutputTokens: 16384,
    inputCostPerMTokMicro: 150_000n, // $0.15 / 1M
    outputCostPerMTokMicro: 600_000n, // $0.60 / 1M
    cacheReadCostPerMTokMicro: 75_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "claude-3-5-sonnet",
    provider: "anthropic",
    logicalAliases: ["smart-model", "reasoning", "code"],
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 3_000_000n, // $3.00 / 1M
    outputCostPerMTokMicro: 15_000_000n, // $15.00 / 1M
    cacheReadCostPerMTokMicro: 300_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: "2026-09-01T00:00:00.000Z",
    sunsetAt: "2026-12-31T00:00:00.000Z",
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "claude-3-5-haiku",
    provider: "anthropic",
    logicalAliases: ["fast-model", "economy"],
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 800_000n, // $0.80 / 1M
    outputCostPerMTokMicro: 4_000_000n, // $4.00 / 1M
    cacheReadCostPerMTokMicro: 80_000n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "deepseek-chat",
    provider: "deepseek",
    logicalAliases: ["economy", "fast", "deepseek-v3"],
    contextWindow: 64_000,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 140_000n, // $0.14 / 1M
    outputCostPerMTokMicro: 280_000n, // $0.28 / 1M
    cacheReadCostPerMTokMicro: 14_000n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: "2026-09-01T00:00:00.000Z",
    sunsetAt: "2026-12-31T00:00:00.000Z",
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "llama-3.3-70b-versatile",
    provider: "groq",
    logicalAliases: ["fast-model", "smart-fast"],
    contextWindow: 128_000,
    maxOutputTokens: 32768,
    inputCostPerMTokMicro: 590_000n, // $0.59 / 1M
    outputCostPerMTokMicro: 790_000n, // $0.79 / 1M
    cacheReadCostPerMTokMicro: 0n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
];

/**
 * Modern Next-Generation Model Definitions.
 * All pricing strictly in int64 microdollars (bigint) per 1M tokens.
 */
export const FREE_TIER_MODEL_DEFINITIONS: readonly ModelDef<bigint>[] = [
  {
    id: "gemini-2.5-flash",
    provider: "google",
    logicalAliases: ["gemini-flash", "google-flash", "flash-2.5"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65536,
    inputCostPerMTokMicro: 75_000n, // $0.075 / 1M
    outputCostPerMTokMicro: 300_000n, // $0.30 / 1M
    cacheReadCostPerMTokMicro: 18_750n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "gemini-3.5-flash",
    provider: "google",
    logicalAliases: ["gemini-3.5", "flash-3.5"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65536,
    inputCostPerMTokMicro: 100_000n, // $0.10 / 1M
    outputCostPerMTokMicro: 400_000n, // $0.40 / 1M
    cacheReadCostPerMTokMicro: 25_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "gemini-3.5-flash-lite",
    provider: "google",
    logicalAliases: ["flash-lite", "gemini-lite"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65536,
    inputCostPerMTokMicro: 50_000n, // $0.05 / 1M
    outputCostPerMTokMicro: 200_000n, // $0.20 / 1M
    cacheReadCostPerMTokMicro: 12_500n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "gemini-3.1-pro-preview",
    provider: "google",
    logicalAliases: ["gemini-pro", "gemini-3.1-pro", "pro-3.1"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65536,
    inputCostPerMTokMicro: 1_250_000n, // $1.25 / 1M
    outputCostPerMTokMicro: 5_000_000n, // $5.00 / 1M
    cacheReadCostPerMTokMicro: 312_500n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "gemini-3.8-flash",
    provider: "google",
    logicalAliases: ["smart-fast-next", "gemini-3.8", "flash-3.8"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65536,
    inputCostPerMTokMicro: 150_000n, // $0.15 / 1M
    outputCostPerMTokMicro: 600_000n, // $0.60 / 1M
    cacheReadCostPerMTokMicro: 37_500n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "qwen/qwen3.6-27b",
    provider: "groq",
    logicalAliases: ["groq-code", "qwen-27b"],
    contextWindow: 131_072,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 200_000n, // $0.20 / 1M
    outputCostPerMTokMicro: 400_000n, // $0.40 / 1M
    cacheReadCostPerMTokMicro: 50_000n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "qwen/qwen3.8-27b",
    provider: "groq",
    logicalAliases: ["qwen-3.8", "groq-qwen"],
    contextWindow: 131_072,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 350_000n, // $0.35 / 1M
    outputCostPerMTokMicro: 700_000n, // $0.70 / 1M
    cacheReadCostPerMTokMicro: 87_500n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "openai/gpt-oss-120b",
    provider: "groq",
    logicalAliases: ["groq-oss", "gpt-oss", "gpt-oss-120b"],
    contextWindow: 131_072,
    maxOutputTokens: 65536,
    inputCostPerMTokMicro: 600_000n, // $0.60 / 1M
    outputCostPerMTokMicro: 1_200_000n, // $1.20 / 1M
    cacheReadCostPerMTokMicro: 150_000n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "openai/gpt-oss-20b",
    provider: "groq",
    logicalAliases: ["gpt-oss-20b", "groq-fast"],
    contextWindow: 131_072,
    maxOutputTokens: 65536,
    inputCostPerMTokMicro: 150_000n, // $0.15 / 1M
    outputCostPerMTokMicro: 300_000n, // $0.30 / 1M
    cacheReadCostPerMTokMicro: 37_500n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "deepseek/deepseek-r1-distill-llama-70b",
    provider: "deepseek",
    logicalAliases: ["deepseek-r1", "r1-distill"],
    contextWindow: 131_072,
    maxOutputTokens: 32768,
    inputCostPerMTokMicro: 550_000n, // $0.55 / 1M
    outputCostPerMTokMicro: 1_500_000n, // $1.50 / 1M
    cacheReadCostPerMTokMicro: 137_500n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
];

/**
 * All known model definitions combining default paid benchmarks and free-tier models.
 */
export const ALL_MODEL_DEFINITIONS: readonly ModelDef<bigint>[] = [
  ...DEFAULT_MODEL_DEFINITIONS,
  ...FREE_TIER_MODEL_DEFINITIONS,
];

