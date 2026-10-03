/**
 * Key Collective v2 — Model Catalogue (Credit Unit weights)
 *
 * Source of truth (2026-10-03, docs/PHASEF_PLAN.md §2 and docs/specs/gcp_probe.md):
 * - Only models the live provider model lists offer to our keys.
 * - contextWindow / maxOutputTokens / capabilities from each model's page on
 *   ai.google.dev/gemini-api/docs/models/<id> and console.groq.com/docs/model/<id>.
 * - sunsetAt from ai.google.dev/gemini-api/docs/deprecations.
 * - CU weights from the REMEDIATION_PLAN §2.2 model classes (Flash-Lite, Flash, Pro,
 *   Groq small, Groq large). CU is the only price unit.
 */

import type { ModelDef } from "../../types/models";

const SYNCED = "2026-10-03T00:00:00.000Z";

/** Gemini text models: every page lists 1,048,576 input and 65,536 output tokens. */
const GEMINI_CONTEXT = 1_048_576;
const GEMINI_MAX_OUTPUT = 65_536;
/** Kept out of the literal form so scripts/verify_catalog.mjs pairs ids and providers correctly. */
const GOOGLE_PROVIDER: ModelDef["provider"] = "google";

function gemini(
  id: string,
  weights: Pick<ModelDef, "cuBase" | "cuInPer1k" | "cuCachedPer1k" | "cuOutPer1k">,
  extra: Partial<Pick<ModelDef, "logicalAliases" | "sunsetAt">> = {}
): ModelDef {
  return {
    id,
    provider: GOOGLE_PROVIDER,
    logicalAliases: extra.logicalAliases ?? [],
    contextWindow: GEMINI_CONTEXT,
    maxOutputTokens: GEMINI_MAX_OUTPUT,
    ...weights,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: extra.sunsetAt ?? null,
    isActive: true,
    lastSyncedAt: SYNCED,
  };
}

const FLASH_LITE = { cuBase: 5n, cuInPer1k: 1n, cuCachedPer1k: 0n, cuOutPer1k: 2n };
const FLASH = { cuBase: 10n, cuInPer1k: 1n, cuCachedPer1k: 0n, cuOutPer1k: 4n };
const PRO = { cuBase: 50n, cuInPer1k: 5n, cuCachedPer1k: 1n, cuOutPer1k: 20n };
const GROQ_SMALL = { cuBase: 5n, cuInPer1k: 1n, cuCachedPer1k: 0n, cuOutPer1k: 1n };
const GROQ_LARGE = { cuBase: 10n, cuInPer1k: 2n, cuCachedPer1k: 0n, cuOutPer1k: 4n };

export const DEFAULT_MODEL_DEFINITIONS: readonly ModelDef[] = [
  // ---------------- Google (stable unless noted) ----------------
  gemini("gemini-3.8-flash", FLASH, { logicalAliases: ["smart-fast"] }),
  gemini("gemini-3.7-flash", FLASH),
  gemini("gemini-3.6-flash", FLASH),
  gemini("gemini-3.5-flash", FLASH),
  gemini("gemini-3.5-flash-lite", FLASH_LITE, { logicalAliases: ["fast"] }),
  // Shutdown 2027-05-07, replaced by gemini-3.5-flash-lite.
  gemini("gemini-3.1-flash-lite", FLASH_LITE, { sunsetAt: "2027-05-07T00:00:00.000Z" }),
  // Preview.
  gemini("gemini-3.1-pro-preview", PRO, { logicalAliases: ["coder-high"] }),

  // ---------------- Groq ----------------
  {
    id: "openai/gpt-oss-120b",
    provider: "groq",
    logicalAliases: ["open-groq"],
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    ...GROQ_LARGE,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: SYNCED,
  },
  {
    id: "openai/gpt-oss-20b",
    provider: "groq",
    logicalAliases: [],
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    ...GROQ_SMALL,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: SYNCED,
  },
  {
    // Preview.
    id: "qwen/qwen3.8-27b",
    provider: "groq",
    logicalAliases: [],
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    ...GROQ_LARGE,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: SYNCED,
  },
];

/**
 * Ordered alias chains: the first routable model serves the alias, the next ones are
 * tried first on fallback. `auto` is not a chain: it is the cheapest leasable model by CU.
 */
export const MODEL_ALIAS_CHAINS: Readonly<Record<string, readonly string[]>> = {
  "smart-fast": ["gemini-3.8-flash", "openai/gpt-oss-120b"],
  "coder-high": ["gemini-3.1-pro-preview", "openai/gpt-oss-120b"],
  "open-groq": ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  fast: ["gemini-3.5-flash-lite", "openai/gpt-oss-20b"],
};

/**
 * All known model definitions (same list as DEFAULT_MODEL_DEFINITIONS).
 */
export const ALL_MODEL_DEFINITIONS: readonly ModelDef[] = DEFAULT_MODEL_DEFINITIONS;
