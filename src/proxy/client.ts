/**
 * Core LLM Fetch Proxy Client
 *
 * Forwards requests to upstream LLM providers (OpenAI, Anthropic, Gemini, custom),
 * injects decrypted keys securely in-memory without persistent storage or leakage,
 * and parses response tokens across both JSON and SSE streaming payloads.
 *
 * Invariants Enforced:
 * - TypeScript strict mode, zero `any`.
 * - No Plaintext Keys stored persistently (in-memory request scope only).
 * - Non-blocking streaming with zero-buffering latency overhead.
 */

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'custom' | string;

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ForwardProxyOptions {
  /** Target provider name (e.g. 'openai', 'anthropic', 'gemini', 'custom') */
  provider: ProviderType;
  /** Raw incoming or target URL. If relative or omitted, provider default base URL is used */
  url?: string;
  /** Decrypted API key for the target provider (kept strictly in-memory) */
  decryptedKey: string;
  /** HTTP request method, defaults to 'POST' */
  method?: string;
  /** Incoming request headers or custom headers */
  headers?: HeadersInit;
  /** Request body (JSON string, stream, or ArrayBuffer) */
  body?: BodyInit | null;
  /** Optional timeout in milliseconds */
  timeoutMs?: number;
  /** Expected model identifier if known */
  model?: string;
}

export interface ProxyResult {
  /** The forwarded Response object returned to the client */
  response: Response;
  /** Promise resolving to token usage once the response/stream finishes */
  usagePromise: Promise<TokenUsage>;
  /** Provider targeted */
  provider: ProviderType;
  /** Extracted or configured model identifier */
  model?: string;
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
};

/**
 * Type-safe check for plain object records
 */
function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Parse number safely from unknown value
 */
function parseNumber(val: unknown): number | undefined {
  if (typeof val === 'number' && !Number.isNaN(val)) {
    return val;
  }
  if (typeof val === 'string') {
    const parsed = parseInt(val, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Resolves upstream endpoint URL based on provider and provided URL
 */
export function resolveProviderUrl(provider: ProviderType, inputUrl?: string): string {
  if (inputUrl && (inputUrl.startsWith('http://') || inputUrl.startsWith('https://'))) {
    return inputUrl;
  }

  const defaultUrl = DEFAULT_BASE_URLS[provider.toLowerCase()];
  if (!defaultUrl) {
    if (inputUrl) return inputUrl;
    throw new Error(`No default URL available for unknown provider: ${provider}`);
  }

  if (inputUrl && inputUrl.startsWith('/')) {
    const origin = new URL(defaultUrl).origin;
    return `${origin}${inputUrl}`;
  }

  return defaultUrl;
}

/**
 * Sanitizes incoming headers and attaches target provider authentication
 */
export function prepareProviderHeaders(
  provider: ProviderType,
  decryptedKey: string,
  incomingHeaders?: HeadersInit
): Headers {
  const headers = new Headers(incomingHeaders ?? {});

  // Remove internal/proxy hop-by-hop headers and client auth
  headers.delete('host');
  headers.delete('authorization');
  headers.delete('x-api-key');
  headers.delete('x-goog-api-key');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ray');
  headers.delete('cf-visitor');
  headers.delete('x-forwarded-for');
  headers.delete('x-forwarded-proto');

  // Inject provider authentication
  const norm = provider.toLowerCase();
  if (norm === 'anthropic') {
    headers.set('x-api-key', decryptedKey);
    if (!headers.has('anthropic-version')) {
      headers.set('anthropic-version', '2023-06-01');
    }
  } else if (norm === 'gemini' || norm === 'google') {
    headers.set('x-goog-api-key', decryptedKey);
  } else {
    // OpenAI and OpenAI-compatible default
    headers.set('Authorization', `Bearer ${decryptedKey}`);
  }

  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return headers;
}

/**
 * Extracts token usage from JSON response payloads across providers
 */
export function extractUsageFromJson(json: unknown): TokenUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;

  if (!isRecord(json)) {
    return { promptTokens, completionTokens, totalTokens };
  }

  // 1. OpenAI / generic format: { usage: { prompt_tokens, completion_tokens, total_tokens } }
  if (isRecord(json.usage)) {
    const u = json.usage;
    promptTokens = parseNumber(u.prompt_tokens) ?? parseNumber(u.input_tokens) ?? 0;
    completionTokens = parseNumber(u.completion_tokens) ?? parseNumber(u.output_tokens) ?? 0;
    totalTokens = parseNumber(u.total_tokens) ?? (promptTokens + completionTokens);
    return { promptTokens, completionTokens, totalTokens };
  }

  // 2. Anthropic format: top-level { usage: { input_tokens, output_tokens } }
  if (isRecord(json.usage)) {
    const u = json.usage;
    promptTokens = parseNumber(u.input_tokens) ?? 0;
    completionTokens = parseNumber(u.output_tokens) ?? 0;
    totalTokens = promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens };
  }

  // 3. Gemini format: { usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount } }
  if (isRecord(json.usageMetadata)) {
    const um = json.usageMetadata;
    promptTokens = parseNumber(um.promptTokenCount) ?? 0;
    completionTokens = parseNumber(um.candidatesTokenCount) ?? 0;
    totalTokens = parseNumber(um.totalTokenCount) ?? (promptTokens + completionTokens);
    return { promptTokens, completionTokens, totalTokens };
  }

  return { promptTokens, completionTokens, totalTokens };
}

/**
 * SSE Line parser to extract token counters across streaming chunks
 */
class StreamTokenCounter {
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;
  private estimatedCompletionTokens = 0;

  public processSseEvent(eventData: string): void {
    const trimmed = eventData.trim();
    if (!trimmed || trimmed === '[DONE]') {
      return;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isRecord(parsed)) return;

      // Check OpenAI chunk usage (e.g. stream_options: { include_usage: true })
      if (isRecord(parsed.usage)) {
        const u = parsed.usage;
        const pt = parseNumber(u.prompt_tokens) ?? parseNumber(u.input_tokens);
        const ct = parseNumber(u.completion_tokens) ?? parseNumber(u.output_tokens);
        const tt = parseNumber(u.total_tokens);
        if (pt !== undefined) this.promptTokens = pt;
        if (ct !== undefined) this.completionTokens = ct;
        if (tt !== undefined) this.totalTokens = tt;
      }

      // Check Anthropic streaming events
      // Type: message_start -> message.usage.input_tokens
      if (parsed.type === 'message_start' && isRecord(parsed.message) && isRecord(parsed.message.usage)) {
        const u = parsed.message.usage;
        const pt = parseNumber(u.input_tokens);
        if (pt !== undefined) this.promptTokens = pt;
      }
      // Type: message_delta -> usage.output_tokens
      if (parsed.type === 'message_delta' && isRecord(parsed.usage)) {
        const u = parsed.usage;
        const ct = parseNumber(u.output_tokens);
        if (ct !== undefined) this.completionTokens = ct;
      }

      // Check Gemini streaming usageMetadata
      if (isRecord(parsed.usageMetadata)) {
        const um = parsed.usageMetadata;
        const pt = parseNumber(um.promptTokenCount);
        const ct = parseNumber(um.candidatesTokenCount);
        const tt = parseNumber(um.totalTokenCount);
        if (pt !== undefined) this.promptTokens = pt;
        if (ct !== undefined) this.completionTokens = ct;
        if (tt !== undefined) this.totalTokens = tt;
      }

      // Fallback: estimate tokens if delta text is present and no explicit usage provided
      if (this.completionTokens === 0) {
        if (Array.isArray(parsed.choices)) {
          for (const choice of parsed.choices) {
            if (isRecord(choice) && isRecord(choice.delta) && typeof choice.delta.content === 'string') {
              this.estimatedCompletionTokens += 1;
            }
          }
        }
      }
    } catch {
      // Non-JSON SSE event data, ignore
    }
  }

  public finalize(): TokenUsage {
    const finalCompletion = this.completionTokens > 0 ? this.completionTokens : this.estimatedCompletionTokens;
    const finalTotal = this.totalTokens > 0 ? this.totalTokens : (this.promptTokens + finalCompletion);
    return {
      promptTokens: this.promptTokens,
      completionTokens: finalCompletion,
      totalTokens: finalTotal,
    };
  }
}

/**
 * Creates a pass-through TransformStream that taps into SSE events without buffering latency
 */
export function createStreamingUsageTransformer(): {
  transformStream: TransformStream<Uint8Array, Uint8Array>;
  usagePromise: Promise<TokenUsage>;
} {
  const counter = new StreamTokenCounter();
  const textDecoder = new TextDecoder();
  let buffer = '';

  let resolveUsage!: (usage: TokenUsage) => void;
  const usagePromise = new Promise<TokenUsage>((resolve) => {
    resolveUsage = resolve;
  });

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Immediately forward raw chunk to downstream caller for zero-latency streaming
      controller.enqueue(chunk);

      // Tap chunk into buffer for token counting
      buffer += textDecoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('data:')) {
          counter.processSseEvent(trimmedLine.slice(5));
        }
      }
    },
    flush(controller) {
      if (buffer.length > 0) {
        const trimmedLine = buffer.trim();
        if (trimmedLine.startsWith('data:')) {
          counter.processSseEvent(trimmedLine.slice(5));
        }
      }
      resolveUsage(counter.finalize());
    },
  });

  return { transformStream, usagePromise };
}

/**
 * Core LLM Proxy Client
 */
export class LlmProxyClient {
  /**
   * Forwards a request with decrypted key to the target LLM provider
   */
  public async forward(options: ForwardProxyOptions): Promise<ProxyResult> {
    const targetUrl = resolveProviderUrl(options.provider, options.url);
    const headers = prepareProviderHeaders(options.provider, options.decryptedKey, options.headers);

    let signal: AbortSignal | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      signal = AbortSignal.timeout(options.timeoutMs);
    }

    const fetchInit: RequestInit = {
      method: options.method ?? 'POST',
      headers,
      body: options.body,
      signal,
    };

    const upstreamResponse = await fetch(targetUrl, fetchInit);

    // If upstream returns an error status, pass through directly with zero usage
    if (!upstreamResponse.ok) {
      return {
        response: upstreamResponse,
        usagePromise: Promise.resolve({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
        provider: options.provider,
        model: options.model,
      };
    }

    const contentType = upstreamResponse.headers.get('content-type') ?? '';
    const isStream = contentType.includes('text/event-stream');

    if (isStream && upstreamResponse.body) {
      // Streaming SSE response
      const { transformStream, usagePromise } = createStreamingUsageTransformer();
      const pipedBody = upstreamResponse.body.pipeThrough(transformStream);

      const clientResponse = new Response(pipedBody, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: upstreamResponse.headers,
      });

      return {
        response: clientResponse,
        usagePromise,
        provider: options.provider,
        model: options.model,
      };
    }

    // Buffered JSON response
    const responseText = await upstreamResponse.text();
    let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    try {
      const json: unknown = JSON.parse(responseText);
      usage = extractUsageFromJson(json);
    } catch {
      // Non-JSON response body
    }

    const clientResponse = new Response(responseText, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: upstreamResponse.headers,
    });

    return {
      response: clientResponse,
      usagePromise: Promise.resolve(usage),
      provider: options.provider,
      model: options.model,
    };
  }
}

/**
 * Convenient standalone proxy function
 */
export async function forwardProxyRequest(options: ForwardProxyOptions): Promise<ProxyResult> {
  const client = new LlmProxyClient();
  return client.forward(options);
}
