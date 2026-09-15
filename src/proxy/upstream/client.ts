/**
 * Key Collective v2 — Upstream Client Implementation
 *
 * Conforms to:
 * - LLD 3.2: UpstreamClient handles HTTP communication with upstream AI providers.
 * - Key Responsibilities:
 *   1. Header rewriting and provider key injection.
 *   2. KeyPool interaction and usage tracking.
 *   3. Streaming passthrough via SSEStreamTransformer.
 *   4. Adaptive timeout via EWMA (mean + 3*sigma).
 *   5. Seamless response normalization for Cloudflare Workers routing.
 * - GEMINI.md Constitution: TypeScript strict mode (no `any`), no plaintext keys in logs,
 *   fixed-point microdollars (int64/bigint), non-blocking telemetry.
 */

import { normalizeUpstreamResponse } from "../../worker/error_normalizer";
import type { KeyPoolContract } from "../../contracts/key_pool";
import {
  SSEStreamTransformer,
  StreamUsage,
  extractUsageFromPayload,
} from "../sse_transformer";
import {
  DomainError,
  InvalidKeyError,
  ProviderRoutingError,
  ProviderTimeoutError,
} from "../../errors";
import {
  DEFAULT_PROVIDER_BASE_URLS,
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  UpstreamClientOptions,
  UpstreamRequest,
  UpstreamResponse,
  UpstreamChatRequest,
  UpstreamChatResponse,
} from "./types";
import { rewriteHeaders } from "./headers";
import { buildProviderUrl } from "./urls";
import { mapUpstreamHttpError } from "./errors";
import { extractContentFromPayload } from "./payload";

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
    const extra = new Headers(extraHeaders);
    const kcRequestId = extra.get('x-kc-trace-id') || extra.get('x-kc-request-id') || 'unknown';
    const modelUsed = extra.get('x-kc-model') || extra.get('x-kc-model-used') || undefined;
    const provider = extra.get('x-kc-provider') || undefined;

    const baseResponse = new Response(
      upstreamResponse.body ? (upstreamResponse.body as unknown as BodyInit) : null, 
      {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: upstreamResponse.headers,
      }
    );
    
    const normalized = normalizeUpstreamResponse(baseResponse, kcRequestId, modelUsed, provider);
    
    // Merge any extra non-kc headers
    for (const [key, value] of extra.entries()) {
      if (!key.toLowerCase().startsWith('x-kc-')) {
          normalized.headers.set(key, value);
      }
    }
    
    return normalized;
  }
}
