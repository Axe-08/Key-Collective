/**
 * Key Collective v2 — Upstream Subsystem Types & Constants
 *
 * Conforms to:
 * - LLD 3.2: Upstream Client configurations, request/response models, and headers.
 * - GEMINI.md Constitution: Strict TypeScript, no `any`, fixed-point microdollars.
 */

import type { KeyPoolContract } from "../../contracts/key_pool";
import type { StreamMetadata, StreamUsage, SSEStreamTransformer } from "../sse/index";

/**
 * Hop-by-hop HTTP headers that must not be forwarded across proxies.
 * Conforms to RFC 7230 Section 6.1.
 */
export const HOP_BY_HOP_HEADERS: readonly string[] = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
] as const;

/**
 * Client authentication and routing headers stripped from incoming requests
 * prior to injecting provider credentials.
 */
export const CLIENT_AUTH_HEADERS: readonly string[] = [
  "authorization",
  "x-api-key",
  "api-key",
  "proxy-authorization",
  "kc-token",
  "kc-tenant-id",
  "kc-trace-id",
  "kc-key-id",
] as const;

/**
 * Default base URLs for supported model providers.
 */
export const DEFAULT_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  cohere: "https://api.cohere.com/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
};

/**
 * Default API endpoints per model provider for chat completions.
 */
export const DEFAULT_PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: "/chat/completions",
  anthropic: "/messages",
  google: "/openai/chat/completions",
  gemini: "/openai/chat/completions",
  groq: "/chat/completions",
  deepseek: "/chat/completions",
  cohere: "/chat",
  mistral: "/chat/completions",
  together: "/chat/completions",
};

/**
 * Default request timeout in milliseconds (30 seconds).
 */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Options configuring UpstreamClient behavior.
 */
export interface UpstreamClientOptions {
  /**
   * Optional KeyPoolContract instance to obtain provider keys from and report metrics to.
   */
  keyPool?: KeyPoolContract;

  /**
   * Injectable fetch implementation for Cloudflare Workers runtime or unit testing.
   * Defaults to global fetch.
   */
  fetch?: typeof fetch;

  /**
   * Default timeout in milliseconds for upstream requests.
   * Defaults to DEFAULT_UPSTREAM_TIMEOUT_MS (30,000ms).
   */
  defaultTimeoutMs?: number;

  /**
   * Maximum generous ceiling for adaptive timeouts (e.g. 300,000ms / 5 minutes).
   * Defaults to 300_000ms.
   */
  maxTimeoutCeilingMs?: number;

  /**
   * Minimum floor for adaptive timeouts (e.g. 5,000ms).
   * Defaults to 5_000ms.
   */
  minTimeoutFloorMs?: number;

  /**
   * Whether to enable adaptive EWMA timeout calculation. Defaults to true.
   */
  enableAdaptiveTimeout?: boolean;

  /**
   * Base URL overrides per provider identifier.
   */
  baseUrls?: Partial<Record<string, string>>;

  /**
   * Default headers added to all outgoing requests.
   */
  defaultHeaders?: Record<string, string>;

  /**
   * Key resolver hook to decrypt or resolve a key from KeyPool before use.
   */
  keyResolver?: (keyFromPool: string, provider: string) => Promise<string> | string;

  /**
   * Fixed-point microdollar cost calculator for token usage.
   */
  costCalculator?: (model: string, usage: StreamUsage) => bigint;
}

/**
 * Parameters for executing a generic upstream HTTP request.
 */
export interface UpstreamRequest {
  /** Target provider (e.g. "openai", "anthropic", "google", "groq", "deepseek") */
  provider: string;
  /** Target model identifier (e.g. "gpt-4o", "gemini-2.0-flash", "claude-3-5-sonnet") */
  model?: string;
  /** Endpoint path (e.g. "/chat/completions", "/messages") or full URL */
  endpoint?: string;
  /** Explicit plaintext API key (bypasses KeyPool resolution if provided) */
  apiKey?: string;
  /** Optional key identifier in KeyPool for tracking usage */
  keyId?: string;
  /** HTTP request method (defaults to "POST") */
  method?: string;
  /** Request body payload (JSON object, string, Uint8Array, or ReadableStream) */
  body?: unknown;
  /** Headers to rewrite and forward */
  headers?: HeadersInit | Record<string, string>;
  /** Whether the request expects a Server-Sent Events (SSE) stream */
  stream?: boolean;
  /** Request timeout override in milliseconds */
  timeoutMs?: number;
  /** External AbortSignal to cancel the request */
  signal?: AbortSignal;
  /** Whether to record success/failure and usage in KeyPool (defaults to true if keyPool configured) */
  recordPoolUsage?: boolean;
  /** Callback fired as soon as token usage is extracted from stream */
  onUsage?: (usage: StreamUsage) => void;
  /** Callback fired with streaming metadata upon stream completion */
  onMetadata?: (metadata: StreamMetadata) => void;
}

/**
 * Structured response from an upstream provider.
 */
export interface UpstreamResponse {
  /** Whether HTTP response status is 2xx */
  ok: boolean;
  /** HTTP status code */
  status: number;
  /** HTTP status text */
  statusText: string;
  /** Upstream response headers */
  headers: Headers;
  /** Underlying fetch Response object */
  rawResponse: Response;
  /**
   * Transformed readable stream for SSE streaming passthrough (if stream was requested),
   * or the raw response body stream.
   */
  body: ReadableStream<Uint8Array | string> | null;
  /** Active SSEStreamTransformer if streaming passthrough was initiated */
  transformer?: SSEStreamTransformer;
  /** Asynchronously reads entire response body as UTF-8 string */
  text(): Promise<string>;
  /** Asynchronously parses response body as JSON */
  json<T = unknown>(): Promise<T>;
  /** Resolves authoritative token usage (or null if unavailable) */
  getUsage(timeoutMs?: number): Promise<StreamUsage | null>;
  /** Resolves stream timing and metadata (or null if unavailable) */
  getMetadata(timeoutMs?: number): Promise<StreamMetadata | null>;
}

/**
 * Parameters for standard chat completions request.
 */
export interface UpstreamChatRequest {
  /** Target provider */
  provider: string;
  /** Target canonical model ID */
  model: string;
  /** Chat messages array */
  messages: unknown[];
  /** Sampling temperature */
  temperature?: number;
  /** Maximum completion output tokens */
  maxTokens?: number;
  /** Whether to stream responses */
  stream?: boolean;
  /** Optional explicit API key */
  apiKey?: string;
  /** Optional key identifier */
  keyId?: string;
  /** Optional extra headers */
  headers?: HeadersInit | Record<string, string>;
  /** Optional timeout in milliseconds */
  timeoutMs?: number;
  /** Additional provider-specific body parameters */
  extraBodyParams?: Record<string, unknown>;
}

/**
 * Structured result of a chat completions call.
 */
export interface UpstreamChatResponse {
  /** Extracted completion content text */
  content: string;
  /** Model ID that handled the request */
  model: string;
  /** Provider that handled the request */
  provider: string;
  /** Authoritative token usage */
  usage: StreamUsage | null;
  /** Fixed-point cost in microdollars (bigint) */
  costMicrodollars: bigint;
  /** Full underlying UpstreamResponse */
  response: UpstreamResponse;
}
