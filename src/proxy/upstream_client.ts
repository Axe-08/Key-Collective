/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Upstream Client Module (proxy-upstream-client)
 *
 * Conforms to:
 * - LLD 3.2: UpstreamClient handles HTTP communication with upstream AI providers.
 * - Key Responsibilities:
 *   1. Constructs upstream requests with appropriate header rewriting (removing client auth, injecting provider keys).
 *   2. Handles key injection from KeyPoolContract.
 *   3. Supports streaming passthrough by piping response bodies through SSEStreamTransformer.
 *   4. Catches HTTP errors and maps them to standard internal error types to trigger fallback in CascadeRouter.
 *   5. Seamless endpoint resolution across major providers (OpenAI, Anthropic, Google, Groq, DeepSeek, Mistral, Cohere, etc.).
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no \`any\`).
 * - No Plaintext Keys: Provider keys are injected solely into outgoing HTTP headers and never leaked in logs or error messages.
 * - Non-blocking hot path: Streaming passthrough adds 0ms latency to chunk delivery.
 * - Fixed-point microdollars: All pricing calculations utilize int64 / bigint microdollars (1 USD = 1,000,000 µ$). Zero floating-point math.
 */

import type { KeyPoolContract } from "../contracts/key_pool";
import {
  SSEStreamTransformer,
  StreamUsage,
  StreamMetadata,
  extractUsageFromPayload,
} from "./sse_transformer";
import {
  DomainError,
  RateLimitExceededError,
  InvalidKeyError,
  ProviderRoutingError,
  ProviderTimeoutError,
} from "../errors";

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

/**
 * Parses HTTP Retry-After header value into integer seconds.
 * Supports decimal seconds, integer seconds, and RFC 1123 HTTP dates.
 */
export function parseRetryAfter(headerValue: string | null): number {
  if (!headerValue || headerValue.trim().length === 0) {
    return 60;
  }
  const trimmed = headerValue.trim();

  // Check for integer or float seconds
  const numericSeconds = parseFloat(trimmed);
  if (!isNaN(numericSeconds) && numericSeconds >= 0) {
    return Math.ceil(numericSeconds);
  }

  // Check for HTTP date format
  const parsedDateMs = Date.parse(trimmed);
  if (!isNaN(parsedDateMs)) {
    const diffSec = Math.ceil((parsedDateMs - Date.now()) / 1000);
    return Math.max(1, diffSec);
  }

  return 60;
}

/**
 * Safely truncates response text for error reporting without ballooning memory.
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + "... [truncated]";
}

/**
 * Rewrites outgoing HTTP headers for an upstream provider.
 * Strips client authentication, hop-by-hop, and edge headers, and injects
 * the provider-specific credentials and content negotiation headers.
 *
 * @param provider Target model provider
 * @param incomingHeaders Raw client headers to filter and rewrite
 * @param apiKey Plaintext API key to inject
 * @param options Streaming and provider version options
 * @returns Clean, rewritten Headers object ready for upstream fetch
 */
export function rewriteHeaders(
  provider: string,
  incomingHeaders?: HeadersInit | Record<string, string>,
  apiKey?: string,
  options: {
    stream?: boolean;
    anthropicVersion?: string;
  } = {}
): Headers {
  const result = new Headers();

  // 1. Filter and copy incoming headers
  if (incomingHeaders) {
    const entries: [string, string][] =
      incomingHeaders instanceof Headers
        ? Array.from(incomingHeaders.entries())
        : Array.isArray(incomingHeaders)
        ? (incomingHeaders as [string, string][])
        : Object.entries(incomingHeaders);

    for (const [rawKey, value] of entries) {
      const lower = rawKey.toLowerCase();

      // Strip hop-by-hop headers
      if (HOP_BY_HOP_HEADERS.includes(lower)) {
        continue;
      }
      // Strip client-side authentication and routing headers
      if (CLIENT_AUTH_HEADERS.includes(lower)) {
        continue;
      }
      // Strip internal Cloudflare edge routing headers
      if (lower.startsWith("cf-") || lower.startsWith("x-forwarded-")) {
        continue;
      }

      result.set(rawKey, value);
    }
  }

  // 2. Enforce Content-Type if missing
  if (!result.has("content-type")) {
    result.set("content-type", "application/json");
  }

  // 3. Enforce Accept header
  if (options.stream) {
    result.set("accept", "text/event-stream");
  } else if (!result.has("accept")) {
    result.set("accept", "application/json");
  }

  // 4. Inject provider-specific authentication headers
  if (apiKey && apiKey.trim().length > 0) {
    const normProvider = provider.toLowerCase();

    if (normProvider === "anthropic") {
      result.set("x-api-key", apiKey);
      if (!result.has("anthropic-version")) {
        result.set("anthropic-version", options.anthropicVersion ?? "2023-06-01");
      }
    } else if (normProvider === "google" || normProvider === "gemini") {
      result.set("x-goog-api-key", apiKey);
      result.set("authorization", `Bearer ${apiKey}`);
    } else {
      // Standard OpenAI-compatible providers (OpenAI, Groq, DeepSeek, Mistral, Together, Cohere)
      result.set("authorization", `Bearer ${apiKey}`);
    }
  }

  return result;
}

/**
 * Resolves the full URL for an upstream request based on provider and endpoint.
 *
 * @param provider Upstream model provider
 * @param endpoint Relative endpoint or absolute URL
 * @param model Optional model ID for URL rewriting
 * @param baseUrls Optional base URL lookup overrides
 * @returns Fully qualified destination URL string
 */
export function buildProviderUrl(
  provider: string,
  endpoint?: string,
  model?: string,
  baseUrls?: Record<string, string>
): string {
  // If endpoint is already an absolute URL, return immediately
  if (endpoint && (endpoint.startsWith("http://") || endpoint.startsWith("https://"))) {
    return endpoint;
  }

  const normProvider = provider.toLowerCase();
  const rawBase =
    baseUrls?.[normProvider] ??
    DEFAULT_PROVIDER_BASE_URLS[normProvider] ??
    `https://api.${normProvider}.com/v1`;
  const base = rawBase.replace(/\/+$/, "");

  // Resolve target endpoint
  let resolvedEndpoint = endpoint;
  if (!resolvedEndpoint || resolvedEndpoint.trim().length === 0) {
    resolvedEndpoint = DEFAULT_PROVIDER_ENDPOINTS[normProvider] ?? "/chat/completions";
  }

  // Normalization for cross-provider compatibility
  if (normProvider === "anthropic" && resolvedEndpoint === "/chat/completions") {
    resolvedEndpoint = "/messages";
  } else if (
    (normProvider === "google" || normProvider === "gemini") &&
    resolvedEndpoint === "/chat/completions"
  ) {
    resolvedEndpoint = "/openai/chat/completions";
  } else if (
    (normProvider === "google" || normProvider === "gemini") &&
    resolvedEndpoint.includes(":generateContent") &&
    model &&
    !resolvedEndpoint.includes("/models/")
  ) {
    resolvedEndpoint = `/models/${model}${resolvedEndpoint}`;
  }

  const cleanPath = resolvedEndpoint.replace(/^\/+/, "");
  return `${base}/${cleanPath}`;
}

/**
 * Maps upstream HTTP error status codes and response bodies to standard Key Collective domain errors.
 * These errors trigger fallback escalation in CascadeRouter.
 *
 * @param provider Provider identifier
 * @param status HTTP response status code
 * @param responseText Error response body text
 * @param headers Upstream response headers
 * @param modelId Target model ID
 * @param timeoutMs Request timeout threshold
 * @returns Mapped DomainError instance
 */
export function mapUpstreamHttpError(
  provider: string,
  status: number,
  responseText: string,
  headers?: Headers,
  modelId?: string,
  timeoutMs?: number
): DomainError {
  const truncatedMsg = truncateText(responseText, 500);

  // 1. Rate Limits (HTTP 429) -> RateLimitExceededError
  if (status === 429) {
    const retryAfter = parseRetryAfter(headers?.get("retry-after") ?? null);
    return new RateLimitExceededError(
      `Upstream provider '${provider}' rate limit exceeded (HTTP 429): ${truncatedMsg}`,
      {
        provider,
        retryAfterSeconds: retryAfter,
        details: {
          upstreamStatusCode: 429,
          upstreamResponseText: truncateText(responseText, 1000),
        },
      }
    );
  }

  // 2. Authentication / Authorization Failures (HTTP 401 / 403) -> InvalidKeyError
  if (status === 401 || status === 403) {
    return new InvalidKeyError(
      `Upstream provider '${provider}' rejected API key (HTTP ${status}): ${truncatedMsg}`,
      {
        provider,
        reason: truncatedMsg,
        details: {
          upstreamStatusCode: status,
          upstreamResponseText: truncateText(responseText, 1000),
        },
      }
    );
  }

  // 3. Timeouts (HTTP 408 / 504) -> ProviderTimeoutError
  if (status === 408 || status === 504) {
    return new ProviderTimeoutError(
      provider,
      `Upstream provider '${provider}' timed out (HTTP ${status}): ${truncatedMsg}`,
      {
        modelId,
        timeoutMs: timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
        details: {
          upstreamStatusCode: status,
          upstreamResponseText: truncateText(responseText, 1000),
        },
      }
    );
  }

  // 4. Server Errors (HTTP 500, 502, 503) -> ProviderRoutingError
  if (status >= 500) {
    return new ProviderRoutingError(
      provider,
      `Upstream provider '${provider}' service error (HTTP ${status}): ${truncatedMsg}`,
      {
        modelId,
        upstreamStatusCode: status,
        upstreamResponseText: truncateText(responseText, 1000),
        statusCode: status === 504 ? 504 : 502,
      }
    );
  }

  // 5. Client Errors (HTTP 400, 404, 422) -> ProviderRoutingError
  return new ProviderRoutingError(
    provider,
    `Upstream provider '${provider}' rejected request (HTTP ${status}): ${truncatedMsg}`,
    {
      modelId,
      upstreamStatusCode: status,
      upstreamResponseText: truncateText(responseText, 1000),
      statusCode: 502,
    }
  );
}

/**
 * Extracts completion text content from arbitrary provider JSON payloads.
 * Handles OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, and Cohere response shapes.
 */
export function extractContentFromPayload(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }
  const obj = payload as Record<string, unknown>;

  // 1. OpenAI, Groq, DeepSeek, Mistral, Together format: choices[0].message.content or choices[0].text
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const firstChoice = obj.choices[0] as Record<string, unknown>;
    if (typeof firstChoice?.message === "object" && firstChoice.message !== null) {
      const msg = firstChoice.message as Record<string, unknown>;
      if (typeof msg.content === "string") {
        return msg.content;
      }
    }
    if (typeof firstChoice?.text === "string") {
      return firstChoice.text;
    }
  }

  // 2. Anthropic format: content array of [{ type: "text", text: "..." }]
  if (Array.isArray(obj.content)) {
    const textBlocks: string[] = [];
    for (const item of obj.content) {
      if (typeof item === "object" && item !== null) {
        const block = item as Record<string, unknown>;
        if (block.type === "text" && typeof block.text === "string") {
          textBlocks.push(block.text);
        }
      }
    }
    if (textBlocks.length > 0) {
      return textBlocks.join("");
    }
  }

  // 3. Google / Gemini format: candidates[0].content.parts[0].text
  if (Array.isArray(obj.candidates) && obj.candidates.length > 0) {
    const candidate = obj.candidates[0] as Record<string, unknown>;
    if (typeof candidate?.content === "object" && candidate.content !== null) {
      const content = candidate.content as Record<string, unknown>;
      if (Array.isArray(content.parts)) {
        const partsText: string[] = [];
        for (const part of content.parts) {
          if (
            typeof part === "object" &&
            part !== null &&
            typeof (part as Record<string, unknown>).text === "string"
          ) {
            partsText.push((part as Record<string, unknown>).text as string);
          }
        }
        if (partsText.length > 0) {
          return partsText.join("");
        }
      }
    }
  }

  // 4. Cohere format: message.content or direct text field
  if (typeof obj.text === "string") {
    return obj.text;
  }
  if (typeof obj.message === "object" && obj.message !== null) {
    const msg = obj.message as Record<string, unknown>;
    if (typeof msg.content === "string") {
      return msg.content;
    }
  }

  return "";
}

/**
 * UpstreamClient handles HTTP communication with upstream AI providers.
 *
 * Coordinates header rewriting, key injection, streaming passthrough via
 * SSEStreamTransformer, and error mapping for CascadeRouter fallbacks.
 */
export class UpstreamClient {
  private readonly options: UpstreamClientOptions;
  private readonly keyPool?: KeyPoolContract;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly baseUrls: Record<string, string>;
  private readonly modelLatencyStats = new Map<
    string,
    { mean: number; variance: number; count: number }
  >();
  private readonly maxTimeoutCeilingMs: number;
  private readonly minTimeoutFloorMs: number;
  private readonly enableAdaptiveTimeout: boolean;

  constructor(options: UpstreamClientOptions = {}) {
    this.options = options;
    this.keyPool = options.keyPool;
    this.fetchFn = options.fetch
      ? (options.fetch.bind(globalThis) as typeof fetch)
      : (...args: Parameters<typeof fetch>) => globalThis.fetch(...args);
    this.timeoutMs = options.defaultTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
    this.maxTimeoutCeilingMs = options.maxTimeoutCeilingMs ?? 300_000; // 5 minutes generous ceiling
    this.minTimeoutFloorMs = options.minTimeoutFloorMs ?? 5_000; // 5 seconds floor
    this.enableAdaptiveTimeout = options.enableAdaptiveTimeout ?? true;

    const mergedBaseUrls: Record<string, string> = {
      ...DEFAULT_PROVIDER_BASE_URLS,
    };
    if (options.baseUrls) {
      for (const [providerKey, urlVal] of Object.entries(options.baseUrls)) {
        if (urlVal !== undefined) {
          mergedBaseUrls[providerKey] = urlVal;
        }
      }
    }
    this.baseUrls = mergedBaseUrls;
  }

  /**
   * Resolves the effective adaptive timeout for a given model.
   * Starts with a generous 5-minute ceiling, adapting dynamically down to mean + 3*sigma.
   */
  public getAdaptiveTimeout(modelId?: string, requestedTimeoutMs?: number): number {
    if (requestedTimeoutMs !== undefined) {
      return requestedTimeoutMs;
    }
    if (!this.enableAdaptiveTimeout || !modelId) {
      return this.timeoutMs;
    }

    const stats = this.modelLatencyStats.get(modelId.toLowerCase());
    if (!stats || stats.count < 3) {
      // Warm-up phase: generous ceiling (5 minutes for reasoning / deep queries)
      return this.maxTimeoutCeilingMs;
    }

    const stdDev = Math.sqrt(stats.variance);
    // P99 boundary = mean + 3 * stdDev
    const adaptive = Math.round(stats.mean + 3 * stdDev);
    return Math.min(this.maxTimeoutCeilingMs, Math.max(this.minTimeoutFloorMs, adaptive));
  }

  /**
   * Updates the Exponentially Weighted Moving Average (EWMA) latency profile for a model.
   */
  public recordModelLatency(modelId: string, latencyMs: number): void {
    if (!modelId || latencyMs <= 0) return;
    const key = modelId.toLowerCase();
    const current = this.modelLatencyStats.get(key);
    const alpha = 0.2; // Weighting factor for recent requests

    if (!current) {
      this.modelLatencyStats.set(key, {
        mean: latencyMs,
        variance: 0,
        count: 1,
      });
      return;
    }

    const delta = latencyMs - current.mean;
    const newMean = current.mean + alpha * delta;
    const newVariance = (1 - alpha) * (current.variance + alpha * delta * delta);

    this.modelLatencyStats.set(key, {
      mean: newMean,
      variance: newVariance,
      count: current.count + 1,
    });
  }

  /**
   * Resolves the full URL for a provider and endpoint.
   */
  public buildUrl(provider: string, endpoint?: string, model?: string): string {
    return buildProviderUrl(provider, endpoint, model, this.baseUrls);
  }

  /**
   * Rewrites incoming headers for an upstream provider request.
   */
  public rewriteHeaders(
    provider: string,
    headers?: HeadersInit | Record<string, string>,
    apiKey?: string,
    options?: { stream?: boolean }
  ): Headers {
    const rewritten = rewriteHeaders(provider, headers, apiKey, options);

    // Merge default headers if specified
    if (this.options.defaultHeaders) {
      for (const [key, value] of Object.entries(this.options.defaultHeaders)) {
        if (!rewritten.has(key)) {
          rewritten.set(key, value);
        }
      }
    }

    return rewritten;
  }

  /**
   * Maps an upstream HTTP error status to a domain error.
   */
  public mapError(
    provider: string,
    status: number,
    responseText: string,
    headers?: Headers,
    modelId?: string,
    timeoutMs?: number
  ): DomainError {
    return mapUpstreamHttpError(
      provider,
      status,
      responseText,
      headers,
      modelId,
      timeoutMs ?? this.timeoutMs
    );
  }

  /**
   * Executes an upstream request with header rewriting, key injection,
   * streaming passthrough, and error handling.
   *
   * @param request Upstream request configuration
   * @returns UpstreamResponse wrapping the result
   */
  public async send(request: UpstreamRequest): Promise<UpstreamResponse> {
    const startTs = Date.now();

    // 1. Resolve API key and key ID
    let apiKey = request.apiKey;
    let keyId = request.keyId;

    if ((!apiKey || apiKey.trim().length === 0) && this.keyPool) {
      const poolKey = await this.keyPool.getKey(request.provider);
      keyId = keyId ?? poolKey;
      if (this.options.keyResolver) {
        apiKey = await this.options.keyResolver(poolKey, request.provider);
      } else {
        apiKey = poolKey;
      }
    } else if (apiKey && this.options.keyResolver && (apiKey.startsWith("key_") || (!apiKey.startsWith("AIza") && !apiKey.startsWith("gsk_") && !apiKey.startsWith("sk-")))) {
      keyId = keyId ?? apiKey;
      apiKey = await this.options.keyResolver(apiKey, request.provider);
    }

    if (!apiKey || apiKey.trim().length === 0) {
      throw new InvalidKeyError(
        `No API key provided or available in pool for provider '${request.provider}'`,
        { provider: request.provider }
      );
    }

    // 2. Build URL and rewritten headers
    const url = this.buildUrl(request.provider, request.endpoint, request.model);
    const headers = this.rewriteHeaders(request.provider, request.headers, apiKey, {
      stream: request.stream,
    });

    // 3. Serialize request body
    let bodyPayload: BodyInit | undefined;
    if (request.body !== undefined && request.body !== null) {
      if (
        typeof request.body === "string" ||
        request.body instanceof Uint8Array ||
        request.body instanceof ReadableStream ||
        request.body instanceof FormData ||
        request.body instanceof URLSearchParams
      ) {
        bodyPayload = request.body as BodyInit;
      } else {
        bodyPayload = JSON.stringify(request.body);
      }
    }

    // 4. Setup timeout and cancellation
    const effectiveTimeoutMs = this.getAdaptiveTimeout(
      request.model,
      request.timeoutMs
    );
    const abortController = new AbortController();
    let isTimedOut = false;

    const timeoutTimer = setTimeout(() => {
      isTimedOut = true;
      abortController.abort();
    }, effectiveTimeoutMs);

    // Forward external signal if provided
    if (request.signal) {
      if (request.signal.aborted) {
        clearTimeout(timeoutTimer);
        abortController.abort();
      } else {
        request.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeoutTimer);
            abortController.abort();
          },
          { once: true }
        );
      }
    }

    // 5. Execute fetch
    let rawResponse: Response;
    try {
      rawResponse = await this.fetchFn(url, {
        method: request.method ?? "POST",
        headers,
        body: bodyPayload,
        signal: abortController.signal,
      });
    } catch (err) {
      clearTimeout(timeoutTimer);

      // Record failure on KeyPool if configured
      if (this.keyPool && keyId && request.recordPoolUsage !== false) {
        this.keyPool.recordResult(keyId, false).catch(() => {});
      }

      if (isTimedOut) {
        throw new ProviderTimeoutError(
          request.provider,
          `Request to provider '${request.provider}' timed out after ${effectiveTimeoutMs}ms`,
          {
            modelId: request.model,
            timeoutMs: effectiveTimeoutMs,
          }
        );
      }

      if (err instanceof DomainError) {
        throw err;
      }

      throw new ProviderRoutingError(
        request.provider,
        `Network error connecting to provider '${request.provider}': ${
          err instanceof Error ? err.message : String(err)
        }`,
        {
          modelId: request.model,
          upstreamStatusCode: 502,
          details: { originalError: err instanceof Error ? err.message : String(err) },
        }
      );
    }

    clearTimeout(timeoutTimer);
    const durationMs = Date.now() - startTs;
    if (rawResponse.ok && request.model) {
      this.recordModelLatency(request.model, durationMs);
    }

    // 6. Handle HTTP error status codes
    if (!rawResponse.ok) {
      const errorText = await rawResponse.text().catch(() => "");

      // Record failure on KeyPool if configured
      if (this.keyPool && keyId && request.recordPoolUsage !== false) {
        this.keyPool.recordResult(keyId, false).catch(() => {});
      }

      throw this.mapError(
        request.provider,
        rawResponse.status,
        errorText,
        rawResponse.headers,
        request.model,
        effectiveTimeoutMs
      );
    }

    // 7. Handle Streaming Response
    const contentType = rawResponse.headers.get("content-type") ?? "";
    const isStreaming = request.stream || contentType.includes("text/event-stream");

    if (isStreaming) {
      if (!rawResponse.body) {
        throw new ProviderRoutingError(
          request.provider,
          `Upstream provider '${request.provider}' returned empty body for streaming response`,
          {
            modelId: request.model,
            upstreamStatusCode: rawResponse.status,
          }
        );
      }

      const transformer = new SSEStreamTransformer({
        mode: "passthrough",
        startedAt: startTs,
        onUsage: (usage) => {
          request.onUsage?.(usage);
        },
        onMetadata: (metadata) => {
          request.onMetadata?.(metadata);
        },
        onDone: () => {
          // Record success and calculated cost upon completion
          if (this.keyPool && keyId && request.recordPoolUsage !== false) {
            this.keyPool.recordResult(keyId, true).catch(() => {});

            const usage = transformer.usage;
            if (usage && this.options.costCalculator && request.model) {
              try {
                const cost = this.options.costCalculator(request.model, usage);
                this.keyPool.recordUsage(keyId, cost).catch(() => {});
              } catch {
                // Non-blocking hot path telemetry
              }
            }
          }
        },
      });

      const transformedStream = rawResponse.body.pipeThrough(transformer);

      const readStreamText = async (): Promise<string> => {
        const reader = transformedStream.getReader();
        const decoder = new TextDecoder();
        let result = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (typeof value === "string") {
            result += value;
          } else {
            result += decoder.decode(value, { stream: true });
          }
        }
        result += decoder.decode();
        return result;
      };

      const parseStreamJson = async <T = unknown>(): Promise<T> => {
        const textVal = await readStreamText();
        return JSON.parse(textVal) as T;
      };

      return {
        ok: true,
        status: rawResponse.status,
        statusText: rawResponse.statusText,
        headers: rawResponse.headers,
        rawResponse,
        body: transformedStream,
        transformer,
        text: readStreamText,
        json: parseStreamJson,
        async getUsage(timeoutMs?: number) {
          return transformer.getUsage(timeoutMs);
        },
        async getMetadata(timeoutMs?: number) {
          return transformer.getMetadata(timeoutMs);
        },
      };
    }

    // 8. Handle Non-Streaming Response
    if (this.keyPool && keyId && request.recordPoolUsage !== false) {
      this.keyPool.recordResult(keyId, true).catch(() => {});
    }

    let cachedText: string | null = null;
    let cachedJson: unknown = undefined;
    let extractedUsage: StreamUsage | null = null;
    let usageExtracted = false;

    const extractAndRecordUsage = (jsonObj: unknown) => {
      if (usageExtracted) return;
      usageExtracted = true;
      const usagePartial = extractUsageFromPayload(jsonObj);
      if (usagePartial) {
        const prompt = usagePartial.promptTokens ?? 0;
        const completion = usagePartial.completionTokens ?? 0;
        const total = usagePartial.totalTokens ?? prompt + completion;
        extractedUsage = {
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: total,
          ...(usagePartial.cachedTokens !== undefined
            ? { cachedTokens: usagePartial.cachedTokens }
            : {}),
          ...(usagePartial.reasoningTokens !== undefined
            ? { reasoningTokens: usagePartial.reasoningTokens }
            : {}),
          prompt_tokens: prompt,
          completion_tokens: completion,
          total_tokens: total,
        };

        if (
          this.keyPool &&
          keyId &&
          request.recordPoolUsage !== false &&
          this.options.costCalculator &&
          request.model
        ) {
          try {
            const cost = this.options.costCalculator(request.model, extractedUsage);
            this.keyPool.recordUsage(keyId, cost).catch(() => {});
          } catch {
            // Non-blocking hot path telemetry
          }
        }
        request.onUsage?.(extractedUsage);
      }
    };

    const readNonStreamText = async (): Promise<string> => {
      if (cachedText === null) {
        cachedText = await rawResponse.text();
      }
      return cachedText;
    };

    const parseNonStreamJson = async <T = unknown>(): Promise<T> => {
      if (cachedJson === undefined) {
        const textVal = await readNonStreamText();
        cachedJson = JSON.parse(textVal);
        extractAndRecordUsage(cachedJson);
      }
      return cachedJson as T;
    };

    return {
      ok: true,
      status: rawResponse.status,
      statusText: rawResponse.statusText,
      headers: rawResponse.headers,
      rawResponse,
      body: rawResponse.body,
      text: readNonStreamText,
      json: parseNonStreamJson,
      async getUsage() {
        if (!usageExtracted) {
          try {
            await parseNonStreamJson();
          } catch {
            // Ignore parse errors on non-JSON payloads
          }
        }
        return extractedUsage;
      },
      async getMetadata() {
        const duration = Date.now() - startTs;
        return {
          startedAt: startTs,
          completedAt: Date.now(),
          totalDurationMs: duration,
          chunkCount: 1,
          eventCount: 0,
        };
      },
    };
  }

  /**
   * Alias for send(request).
   */
  public async request(request: UpstreamRequest): Promise<UpstreamResponse> {
    return this.send(request);
  }

  /**
   * High-level chat completions helper.
   * Formats chat payload per provider, executes request, and extracts content and cost.
   *
   * @param request UpstreamChatRequest configuration
   * @returns UpstreamChatResponse containing content, usage, and cost
   */
  public async chat(request: UpstreamChatRequest): Promise<UpstreamChatResponse> {
    const provider = request.provider.toLowerCase();
    const isAnthropic = provider === "anthropic";

    let body: Record<string, unknown>;
    if (isAnthropic) {
      body = {
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxTokens ?? 4096,
        stream: request.stream ?? false,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...request.extraBodyParams,
      };
    } else {
      body = {
        model: request.model,
        messages: request.messages,
        stream: request.stream ?? false,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
        ...request.extraBodyParams,
      };
    }

    const upstreamRes = await this.send({
      provider: request.provider,
      model: request.model,
      body,
      stream: request.stream ?? false,
      apiKey: request.apiKey,
      keyId: request.keyId,
      headers: request.headers,
      timeoutMs: request.timeoutMs,
    });

    if (request.stream) {
      return {
        content: "",
        model: request.model,
        provider: request.provider,
        usage: null,
        costMicrodollars: 0n,
        response: upstreamRes,
      };
    }

    const jsonPayload = await upstreamRes.json();
    const content = extractContentFromPayload(jsonPayload);
    const usage = await upstreamRes.getUsage();
    let costMicrodollars = 0n;
    if (usage && this.options.costCalculator) {
      costMicrodollars = this.options.costCalculator(request.model, usage);
    }

    return {
      content,
      model: request.model,
      provider: request.provider,
      usage,
      costMicrodollars,
      response: upstreamRes,
    };
  }

  /**
   * Converts an UpstreamResponse into a clean client Response for Cloudflare Workers routing.
   * Filters hop-by-hop headers and forwards status and stream body.
   *
   * @param upstreamResponse Result from send or chat
   * @param extraHeaders Optional client headers to merge
   * @returns Standard Response object
   */
  public toClientResponse(
    upstreamResponse: UpstreamResponse,
    extraHeaders?: HeadersInit
  ): Response {
    const headers = new Headers();
    for (const [key, value] of upstreamResponse.headers.entries()) {
      const lower = key.toLowerCase();
      if (!HOP_BY_HOP_HEADERS.includes(lower) && lower !== "content-length") {
        headers.set(key, value);
      }
    }

    if (extraHeaders) {
      const extra = new Headers(extraHeaders);
      for (const [key, value] of extra.entries()) {
        headers.set(key, value);
      }
    }

    if (upstreamResponse.body) {
      return new Response(upstreamResponse.body as unknown as BodyInit, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers,
      });
    }

    return new Response(null, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  }
}
