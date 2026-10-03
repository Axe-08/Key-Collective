/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Model, Provider, and Registry Types
 *
 * Invariants:
 * - Strict mode, no `any`.
 * - Fixed-point credit units (int64 credit units, 1 USD = 1,000,000 CU). Zero floating-point math.
 * - Multi-tenant isolation: per-tenant key pools and configuration.
 */

/**
 * Known standard upstream LLM providers supported by Key Collective.
 * Conforms to LLD 2.2: String union type (e.g. 'openai' | 'anthropic' | 'cohere').
 */
export const KNOWN_MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "cohere",
  "google",
  "gemini",
  "groq",
  "mistral",
  "deepseek",
  "together",
  "bedrock",
] as const;

export type KnownModelProvider = (typeof KNOWN_MODEL_PROVIDERS)[number];

/**
 * ModelProvider represents the upstream model provider.
 * Supports known standard providers while accommodating custom provider integrations.
 */
export type ModelProvider = KnownModelProvider | (string & {});

/**
 * Known standard model aliases commonly used across tenants.
 * Conforms to LLD 2.2: Abstract model names used by tenants (e.g. 'fast-model', 'smart-model').
 */
export const KNOWN_MODEL_ALIASES = [
  "fast-model",
  "smart-model",
  "smart-fast",
  "fast",
  "economy",
  "reasoning",
  "vision",
  "code",
] as const;

export type KnownModelAlias = (typeof KNOWN_MODEL_ALIASES)[number];

/**
 * ModelAlias represents abstract model names used by tenants.
 * Can be any of the standard aliases or an arbitrary tenant-configured alias string.
 */
export type ModelAlias = KnownModelAlias | (string & {});

/**
 * KeyStatus represents the health and availability status of a provider API key in the pool.
 */
export type KeyStatus =
  | "Healthy"
  | "RateLimited"
  | "Degraded"
  | "Disabled"
  | "healthy"
  | "rate_limited"
  | "exhausted"
  | "invalid"
  | "disabled";

export const KEY_STATUSES: readonly KeyStatus[] = [
  "Healthy",
  "RateLimited",
  "Degraded",
  "Disabled",
  "healthy",
  "rate_limited",
  "exhausted",
  "invalid",
  "disabled",
] as const;

/**
 * Canonical model capability flags.
 */
export interface ModelCapabilities {
  /** Supports tool / function calling */
  supportsTools: boolean;
  /** Supports multimodal vision inputs */
  supportsVision: boolean;
  /** Supports structured output / JSON schema mode */
  supportsJsonSchema: boolean;
  /** Supports streaming SSE responses */
  supportsStreaming?: boolean;
}

/**
 * Credit Unit (CU) weights of a model. CU is the only price unit (D-02).
 */
export interface ModelPricing {
  /** Base Credit Units per request */
  cuBase?: bigint;
  /** Input Credit Units per 1,000 tokens */
  cuInPer1k?: bigint;
  /** Cached token Credit Units per 1,000 tokens */
  cuCachedPer1k?: bigint;
  /** Output Credit Units per 1,000 tokens */
  cuOutPer1k?: bigint;
}

/**
 * ModelDef defines capabilities, pricing, and metadata of an AI model in the registry.
 * Conforms to D1 schema and domain contracts.
 */
export interface ModelDef {
  /** Unique canonical model identifier (e.g. "gemini-3.8-flash", "openai/gpt-oss-120b") */
  id: string;
  /** Upstream model provider */
  provider: ModelProvider;
  /** Logical aliases mapped to this model (e.g. ["smart-fast", "fast-model"]) */
  logicalAliases: ModelAlias[];
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
  /** Base Credit Units per request */
  cuBase?: bigint;
  /** Input Credit Units per 1,000 tokens */
  cuInPer1k?: bigint;
  /** Cached token Credit Units per 1,000 tokens */
  cuCachedPer1k?: bigint;
  /** Output Credit Units per 1,000 tokens */
  cuOutPer1k?: bigint;
  /** Whether the model supports function / tool calling */
  supportsTools: boolean;
  /** Whether the model supports multimodal vision */
  supportsVision: boolean;
  /** Whether the model supports JSON Schema structured outputs */
  supportsJsonSchema: boolean;
  /** Deprecation date (ISO-8601 or null) */
  deprecatedAt?: string | null;
  /** Sunset date (ISO-8601 or null) */
  sunsetAt?: string | null;
  /** Whether this model is currently active for routing */
  isActive: boolean;
  /** Timestamp when model definition was last synced */
  lastSyncedAt?: string;
}

/**
 * APIKey represents a provider API key and its state within the tenant's key pool.
 * Plaintext keys are never exposed; ciphertext and nonce are stored in D1.
 */
export interface APIKey {
  /** Unique key identifier */
  id: string;
  /** Tenant ID owning this key */
  tenantId: string;
  /** Human-readable key label */
  label: string;
  /** Model provider this key is valid for */
  provider: ModelProvider;
  /** AES-256-GCM encrypted key ciphertext in base64 */
  encryptedKeyB64: string;
  /** 12-byte initialization vector / nonce in base64 */
  nonceB64: string;
  /** Key prefix (e.g. "sk-proj-...") for UI masking */
  keyPrefix: string;
  /** Key suffix (e.g. "...XYZ1") for UI masking */
  keySuffix: string;
  /** Requests per minute limit */
  rpmLimit: number;
  /** Requests per day limit */
  rpdLimit: number;
  /** Priority tier (higher numbers prioritized first) */
  priority: number;
  /** Key health and circuit breaker status */
  status: KeyStatus;
  /** ISO-8601 timestamp until which the circuit breaker is open */
  circuitOpenUntil?: string | null;
  /** ISO-8601 timestamp when key was last used */
  lastUsedAt?: string | null;
  /** ISO-8601 timestamp when key was created */
  createdAt?: string;
  /** Pool assignment type (PRIVATE or COMMUNITY) */
  poolType?: "PRIVATE" | "COMMUNITY";
  /** Status in community pool routing */
  communityRoutingStatus?: "OBSERVATION" | "ACTIVE" | "QUARANTINED" | "REVOKED" | null;
  /** Timestamp until observation period ends */
  observationUntil?: string | number | null;
  /** Total requests dispatched today */
  dispatchedToday?: number;
  /** Communal requests dispatched today */
  dispatchedCommunal?: number;
  /** Vesting tier (0, 1, or 2) */
  vestingTier?: number;
  /** GCP project hash if probed */
  providerProjectHash?: string | null;
  /** HKDF per-tenant migration flag */
  hkdfMigrated?: number;
  /** Timestamp until 60-min anti-cycling tier ends (FR-18) */
  antiCyclingUntil?: string | number | null;
}

/**
 * RouterDecision captures the decision reasoning of the routing engine.
 */
export interface RouterDecision {
  /** ID of the key chosen from the pool */
  selectedKeyId: string;
  /** Upstream canonical model ID selected */
  selectedModelId: string;
  /** Tenant initiating the request */
  tenantId: string;
  /** Whether the candidate satisfied all requested capability filters */
  capabilityFilterPassed: boolean;
  /** Explanation of routing decision (e.g. "cost_optimal", "fallback_429", "priority_tier") */
  reason: string;
}

/**
 * CostLedgerEvent records the financial impact and token telemetry of a single request.
 * Enforces zero floating-point math using fixed-point credit units.
 */
export interface CostLedgerEvent<TCost = bigint> {
  /** Unique event identifier */
  id: string;
  /** Request correlation ID */
  requestId: string;
  /** Tenant owning the transaction */
  tenantId: string;
  /** API key used */
  keyId: string;
  /** Provider invoked */
  provider: ModelProvider;
  /** Model invoked */
  modelId: string;
  /** Prompt / input tokens consumed */
  promptTokens: number;
  /** Completion / output tokens consumed */
  completionTokens: number;
  /** Cached tokens read from prompt cache */
  cachedTokens: number;
  /** Reasoning / thought tokens consumed */
  reasoningTokens: number;
  /** Total transaction cost in int64 credit units */
  costCu: TCost;
  /** Total upstream latency in milliseconds */
  latencyMs: number;
  /** HTTP status code returned by upstream */
  statusCode: number;
  /** Creation timestamp */
  createdAt: string;
}

/**
 * Factory helper for creating a ModelDef with defaults.
 */
export function createModelDef(
  params: Omit<ModelDef, "isActive" | "cuBase" | "cuInPer1k" | "cuCachedPer1k" | "cuOutPer1k"> & {
    isActive?: boolean;
    cuBase?: bigint;
    cuInPer1k?: bigint;
    cuCachedPer1k?: bigint;
    cuOutPer1k?: bigint;
  }
): ModelDef {
  return {
    ...params,
    cuBase: params.cuBase ?? 0n,
    cuInPer1k: params.cuInPer1k ?? 0n,
    cuCachedPer1k: params.cuCachedPer1k ?? 0n,
    cuOutPer1k: params.cuOutPer1k ?? 0n,
    isActive: params.isActive ?? true,
  };
}

/**
 * Type guard for KnownModelProvider.
 */
export function isKnownModelProvider(value: unknown): value is KnownModelProvider {
  return (
    typeof value === "string" &&
    (KNOWN_MODEL_PROVIDERS as readonly string[]).includes(value)
  );
}

/**
 * Type guard for ModelProvider.
 */
export function isModelProvider(value: unknown): value is ModelProvider {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Type guard for KnownModelAlias.
 */
export function isKnownModelAlias(value: unknown): value is KnownModelAlias {
  return (
    typeof value === "string" &&
    (KNOWN_MODEL_ALIASES as readonly string[]).includes(value)
  );
}

/**
 * Type guard for ModelAlias.
 */
export function isModelAlias(value: unknown): value is ModelAlias {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Type guard for KeyStatus.
 */
export function isKeyStatus(value: unknown): value is KeyStatus {
  return (
    typeof value === "string" &&
    (KEY_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Type guard for ModelDef.
 */
export function isModelDef(value: unknown): value is ModelDef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const hasValidCu =
    (candidate.cuBase === undefined || typeof candidate.cuBase === "bigint") &&
    (candidate.cuInPer1k === undefined || typeof candidate.cuInPer1k === "bigint") &&
    (candidate.cuCachedPer1k === undefined || typeof candidate.cuCachedPer1k === "bigint") &&
    (candidate.cuOutPer1k === undefined || typeof candidate.cuOutPer1k === "bigint");
  return (
    typeof candidate.id === "string" &&
    isModelProvider(candidate.provider) &&
    Array.isArray(candidate.logicalAliases) &&
    typeof candidate.contextWindow === "number" &&
    typeof candidate.maxOutputTokens === "number" &&
    hasValidCu &&
    typeof candidate.supportsTools === "boolean" &&
    typeof candidate.supportsVision === "boolean" &&
    typeof candidate.supportsJsonSchema === "boolean" &&
    typeof candidate.isActive === "boolean"
  );
}

/**
 * Type guard for APIKey.
 */
export function isAPIKey(value: unknown): value is APIKey {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.tenantId === "string" &&
    typeof candidate.label === "string" &&
    isModelProvider(candidate.provider) &&
    typeof candidate.encryptedKeyB64 === "string" &&
    typeof candidate.nonceB64 === "string" &&
    typeof candidate.keyPrefix === "string" &&
    typeof candidate.keySuffix === "string" &&
    typeof candidate.rpmLimit === "number" &&
    typeof candidate.priority === "number" &&
    isKeyStatus(candidate.status)
  );
}

/**
 * Type guard for RouterDecision.
 */
export function isRouterDecision(value: unknown): value is RouterDecision {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.selectedKeyId === "string" &&
    typeof candidate.selectedModelId === "string" &&
    typeof candidate.tenantId === "string" &&
    typeof candidate.capabilityFilterPassed === "boolean" &&
    typeof candidate.reason === "string"
  );
}
