/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Cascade Router Subsystem: Types and Interfaces
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - Fixed-Point Microdollars: All pricing calculations utilize int64 / bigint microdollars. Zero floating-point math.
 */

import type { RouteRequest, RouteResponse } from "../../contracts/router";
import type { KeyPoolContract } from "../../contracts/key_pool";
import type { IModelRegistry } from "../model_registry";
import type { CapabilityFilter, ModelSortStrategy } from "../capability_filter";
import type { UpstreamClient, UpstreamResponse } from "../../proxy/upstream_client";
import type { StreamUsage } from "../../proxy/sse_transformer";
import type { ModelDef } from "../../types/models";
import type { FallbackAttempt } from "../../errors";

/**
 * Extended request options accepted by CascadeRouter.
 */
export interface CascadeRouteRequest extends RouteRequest {
  /** Target model identifier, logical alias, or generic routing keyword ("auto" | "cheapest" | "cascade") */
  modelAlias: string;
  /** Chat messages array */
  messages: unknown[];
  /** Whether to stream response chunks */
  stream: boolean;

  /** Sampling temperature (0.0 - 2.0) */
  temperature?: number;
  /** Maximum completion output tokens */
  maxTokens?: number;
  max_tokens?: number;
  max_completion_tokens?: number;

  /** Tool / function calling schemas */
  tools?: unknown[];
  functions?: unknown[];
  tool_choice?: unknown;
  function_call?: unknown;

  /** Structured output / JSON schema format */
  response_format?: unknown;
  /** System prompt override */
  system?: unknown;

  /** Explicit pre-calculated prompt token count */
  estimatedPromptTokens?: number;

  /** Explicit API key override for this request (bypasses KeyPool) */
  apiKey?: string;
  /** Explicit list of fallback model candidate IDs in priority order */
  fallbackModels?: readonly string[];
  /** Maximum fallback attempts for this request override */
  maxFallbacks?: number;

  /** Upstream request timeout in milliseconds */
  timeoutMs?: number;
  /** AbortSignal for request cancellation */
  signal?: AbortSignal;
  /** Additional HTTP headers forwarded to upstream */
  headers?: HeadersInit | Record<string, string>;
  /** Provider-specific extra request body fields */
  extraBodyParams?: Record<string, unknown>;
  /** Tenant ID for self-key routing */
  tenantId?: string;
}

/**
 * Detailed routing result returned by CascadeRouter.
 */
export interface CascadeRouteResponse extends RouteResponse {
  /** Extracted completion content text (or empty string if stream=true) */
  content: string;
  /** Authoritative transaction cost in microdollars (bigint) */
  costMicrodollars: bigint;
  /** Canonical model ID that fulfilled the request */
  model: string;
  /** Upstream provider that fulfilled the request */
  provider: string;
  /** Model definition of the model that fulfilled the request */
  modelDef: ModelDef<bigint>;
  /** Prior failed routing attempts leading up to this success */
  attempts: FallbackAttempt[];
  /** Authoritative token usage extracted from stream or response payload */
  usage: StreamUsage | null;
  /** Full underlying UpstreamResponse (contains transformed stream body if stream=true) */
  response?: UpstreamResponse;
  /** Whether a tenant's self-provided key was utilized */
  isSelfKey?: boolean;
}

/**
 * Options configuring CascadeRouter instantiation.
 */
export interface CascadeRouterOptions {
  /** Injected ModelRegistry instance (defaults to standard ModelRegistry with DEFAULT_MODEL_DEFINITIONS) */
  registry?: IModelRegistry;
  /** Injected CapabilityFilter instance (defaults to new CapabilityFilter(this.registry)) */
  capabilityFilter?: CapabilityFilter;
  /** Injected UpstreamClient instance (defaults to new UpstreamClient({ keyPool, costCalculator })) */
  upstreamClient?: UpstreamClient;
  /** KeyPoolContract instance to obtain and record keys */
  keyPool?: KeyPoolContract;
  /** Maximum fallback candidate models to attempt upon failure (default: 3) */
  maxFallbacks?: number;
  /** Default fallback model candidate IDs in priority order */
  fallbackModels?: readonly string[];
  /** Default candidate sorting strategy (default: "cost-asc") */
  sortBy?: ModelSortStrategy;
  /**
   * If true, allows falling back to other capable models when the explicitly requested
   * model lacks capabilities (e.g. tools or vision). Default is false (throws CapabilityMismatchError).
   */
  allowMismatchEscalation?: boolean;
  /** Default max completion output tokens */
  defaultMaxTokens?: number;
  /** Default sampling temperature */
  defaultTemperature?: number;
  /** Extra body parameters passed to all upstream calls */
  extraBodyParams?: Record<string, unknown>;
  /** Callback fired whenever a candidate fails and router escalates to the next model */
  onFallback?: (attempt: FallbackAttempt, nextModel?: ModelDef<bigint>) => void;
  /** Callback fired upon a successful route */
  onSuccess?: (response: CascadeRouteResponse) => void;
}

/**
 * Type guard for CascadeRouteResponse.
 */
export function isCascadeRouteResponse(value: unknown): value is CascadeRouteResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    "costMicrodollars" in value &&
    "model" in value &&
    "provider" in value &&
    "attempts" in value &&
    Array.isArray((value as Record<string, unknown>).attempts)
  );
}

/**
 * Type guard for CascadeRouteRequest.
 */
export function isCascadeRouteRequest(value: unknown): value is CascadeRouteRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "modelAlias" in value &&
    typeof (value as Record<string, unknown>).modelAlias === "string" &&
    "messages" in value &&
    Array.isArray((value as Record<string, unknown>).messages) &&
    "stream" in value &&
    typeof (value as Record<string, unknown>).stream === "boolean"
  );
}
