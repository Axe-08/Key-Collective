/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * SSE Stream Transformer Module (proxy-sse-transformer)
 *
 * Conforms to:
 * - LLD 3.1: Web TransformStream implementation for parsing upstream Server-Sent Events (SSE).
 * - Key Responsibilities:
 *   1. Parses upstream chunks on the fly without blocking the hot path.
 *   2. Extracts authoritative usage blocks (token counts) embedded in the stream across all major
 *      providers (OpenAI, Gemini, Anthropic, Cohere, Bedrock/AWS, Groq).
 *   3. Yields standard SSE chunks back to the client while intercepting metadata for telemetry and billing.
 *   4. Handles partial chunks, multi-byte UTF-8 split boundaries, CRLF/LF line endings, and multiline events.
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - Zero floating-point math: token counts are integers, compatible with int64 microdollar pricing.
 * - Non-blocking hot path: zero copying or delaying of streaming chunks in passthrough mode.
 */

import type { TokenUsage } from "../router/model_registry";

/**
 * Authoritative token usage extracted from an upstream SSE stream.
 * Extends TokenUsage from router to allow seamless downstream cost calculation.
 */
export interface StreamUsage extends TokenUsage {
  /** Prompt / input tokens consumed */
  promptTokens: number;
  /** Completion / output tokens generated */
  completionTokens: number;
  /** Total tokens (prompt + completion) */
  totalTokens: number;
  /** Cached prompt tokens read from cache */
  cachedTokens?: number;
  /** Reasoning / thought tokens consumed */
  reasoningTokens?: number;

  // Snake_case aliases for compatibility with diverse provider conventions
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;

  /** Raw unparsed usage payload as returned by upstream provider */
  raw?: Record<string, unknown>;
}

/**
 * Parsed Server-Sent Event structure.
 */
export interface SSEEvent {
  /** Event type name if specified (e.g. "message", "message_start", "message_delta") */
  event?: string;
  /** Event ID if specified by upstream */
  id?: string;
  /** Event data string payload */
  data: string;
  /** Client reconnection retry delay in milliseconds if specified */
  retry?: number;
  /** Full raw textual representation of the event block */
  raw: string;
}

/**
 * Stream timing and provider metadata intercepted during streaming.
 */
export interface StreamMetadata {
  /** Resolved model ID from chunk payload (e.g. "gemini-2.0-flash", "gpt-4o") */
  model?: string;
  /** System fingerprint identifier if provided by upstream */
  systemFingerprint?: string;
  /** Upstream completion finish reason (e.g. "stop", "length", "tool_calls") */
  finishReason?: string;
  /** Latency from transformer initialization to receipt of first chunk/token (ms) */
  timeToFirstTokenMs?: number;
  /** Total duration of stream from initialization to completion (ms) */
  totalDurationMs?: number;
  /** Timestamp (ms) when transformer was instantiated or started */
  startedAt: number;
  /** Timestamp (ms) when first chunk was received */
  firstChunkReceivedAt?: number;
  /** Timestamp (ms) when stream finished */
  completedAt?: number;
  /** Total number of raw chunks processed */
  chunkCount: number;
  /** Total number of complete SSE events parsed */
  eventCount: number;
}

/**
 * Options configuring SSEStreamTransformer behavior.
 */
export interface SSEStreamTransformerOptions {
  /**
   * Callback invoked whenever a complete SSE event is parsed.
   */
  onEvent?: (event: SSEEvent) => void;

  /**
   * Callback invoked as soon as an authoritative usage block is extracted.
   */
  onUsage?: (usage: StreamUsage) => void;

  /**
   * Callback invoked with stream metadata (TTFT, latency, chunk count, etc.) upon stream close.
   */
  onMetadata?: (metadata: StreamMetadata) => void;

  /**
   * Callback invoked when the stream has cleanly closed.
   */
  onDone?: () => void;

  /**
   * Start timestamp (ms) for TTFT and total latency calculation.
   * Defaults to Date.now() when transformer is created.
   */
  startedAt?: number;

  /**
   * Stream delivery mode:
   * - "passthrough": immediately forwards incoming chunks without buffering (0ms added latency, default).
   * - "events": enqueues normalized SSE formatted strings/bytes as events are completed.
   */
  mode?: "passthrough" | "events";

  /**
   * Whether to accumulate all parsed SSEEvent instances in the `.events` array.
   * Default: true. Set to false for memory efficiency on massive long-running streams.
   */
  bufferEvents?: boolean;
}

/**
 * Helper to safely extract usage tokens from arbitrary provider JSON payloads.
 * Handles OpenAI, Gemini, Anthropic, Cohere, Bedrock, and Groq schemas.
 */
export function extractUsageFromPayload(
  payload: unknown
): Partial<StreamUsage> | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const obj = payload as Record<string, unknown>;
  const result: Partial<StreamUsage> = {};
  let found = false;

  // 1. OpenAI, Groq, DeepSeek, Together, Mistral standard format: obj.usage
  let usageObj: Record<string, unknown> | null = null;
  if (typeof obj.usage === "object" && obj.usage !== null) {
    usageObj = obj.usage as Record<string, unknown>;
  } else if (
    typeof obj.x_groq === "object" &&
    obj.x_groq !== null &&
    typeof (obj.x_groq as Record<string, unknown>).usage === "object" &&
    (obj.x_groq as Record<string, unknown>).usage !== null
  ) {
    usageObj = (obj.x_groq as Record<string, unknown>).usage as Record<string, unknown>;
  }

  if (usageObj) {
    if (typeof usageObj.prompt_tokens === "number") {
      result.promptTokens = usageObj.prompt_tokens;
      found = true;
    } else if (typeof usageObj.promptTokens === "number") {
      result.promptTokens = usageObj.promptTokens;
      found = true;
    } else if (typeof usageObj.input_tokens === "number") {
      result.promptTokens = usageObj.input_tokens;
      found = true;
    }

    if (typeof usageObj.completion_tokens === "number") {
      result.completionTokens = usageObj.completion_tokens;
      found = true;
    } else if (typeof usageObj.completionTokens === "number") {
      result.completionTokens = usageObj.completionTokens;
      found = true;
    } else if (typeof usageObj.output_tokens === "number") {
      result.completionTokens = usageObj.output_tokens;
      found = true;
    }

    if (typeof usageObj.total_tokens === "number") {
      result.totalTokens = usageObj.total_tokens;
      found = true;
    } else if (typeof usageObj.totalTokens === "number") {
      result.totalTokens = usageObj.totalTokens;
      found = true;
    }

    // Cached tokens details
    if (
      typeof usageObj.prompt_tokens_details === "object" &&
      usageObj.prompt_tokens_details !== null
    ) {
      const details = usageObj.prompt_tokens_details as Record<string, unknown>;
      if (typeof details.cached_tokens === "number") {
        result.cachedTokens = details.cached_tokens;
      }
    } else if (typeof usageObj.cached_tokens === "number") {
      result.cachedTokens = usageObj.cached_tokens;
    }

    // Reasoning tokens details
    if (
      typeof usageObj.completion_tokens_details === "object" &&
      usageObj.completion_tokens_details !== null
    ) {
      const details = usageObj.completion_tokens_details as Record<string, unknown>;
      if (typeof details.reasoning_tokens === "number") {
        result.reasoningTokens = details.reasoning_tokens;
      }
    } else if (typeof usageObj.reasoning_tokens === "number") {
      result.reasoningTokens = usageObj.reasoning_tokens;
    }
  }

  // 2. Google / Gemini format: obj.usageMetadata
  if (typeof obj.usageMetadata === "object" && obj.usageMetadata !== null) {
    const meta = obj.usageMetadata as Record<string, unknown>;
    if (typeof meta.promptTokenCount === "number") {
      result.promptTokens = meta.promptTokenCount;
      found = true;
    } else if (typeof meta.prompt_token_count === "number") {
      result.promptTokens = meta.prompt_token_count;
      found = true;
    }

    if (typeof meta.candidatesTokenCount === "number") {
      result.completionTokens = meta.candidatesTokenCount;
      found = true;
    } else if (typeof meta.candidates_token_count === "number") {
      result.completionTokens = meta.candidates_token_count;
      found = true;
    }

    if (typeof meta.totalTokenCount === "number") {
      result.totalTokens = meta.totalTokenCount;
      found = true;
    } else if (typeof meta.total_token_count === "number") {
      result.totalTokens = meta.total_token_count;
      found = true;
    }

    if (typeof meta.cachedContentTokenCount === "number") {
      result.cachedTokens = meta.cachedContentTokenCount;
    } else if (typeof meta.cached_content_token_count === "number") {
      result.cachedTokens = meta.cached_content_token_count;
    }

    if (typeof meta.thoughtsTokenCount === "number") {
      result.reasoningTokens = meta.thoughtsTokenCount;
    } else if (typeof meta.thoughts_token_count === "number") {
      result.reasoningTokens = meta.thoughts_token_count;
    }
  }

  // 3. Anthropic format:
  // message_start event: obj.message.usage = { input_tokens, output_tokens, cache_read_input_tokens }
  // message_delta event: obj.usage = { output_tokens }
  if (typeof obj.message === "object" && obj.message !== null) {
    const msg = obj.message as Record<string, unknown>;
    if (typeof msg.usage === "object" && msg.usage !== null) {
      const anthropicUsage = msg.usage as Record<string, unknown>;
      if (typeof anthropicUsage.input_tokens === "number") {
        result.promptTokens = anthropicUsage.input_tokens;
        found = true;
      }
      if (typeof anthropicUsage.output_tokens === "number") {
        result.completionTokens = anthropicUsage.output_tokens;
        found = true;
      }
      if (typeof anthropicUsage.cache_read_input_tokens === "number") {
        result.cachedTokens = anthropicUsage.cache_read_input_tokens;
      }
    }
  }

  // 4. Cohere format: obj.meta.tokens or obj.response.meta.tokens
  if (typeof obj.meta === "object" && obj.meta !== null) {
    const meta = obj.meta as Record<string, unknown>;
    if (typeof meta.tokens === "object" && meta.tokens !== null) {
      const tokens = meta.tokens as Record<string, unknown>;
      if (typeof tokens.input_tokens === "number") {
        result.promptTokens = tokens.input_tokens;
        found = true;
      }
      if (typeof tokens.output_tokens === "number") {
        result.completionTokens = tokens.output_tokens;
        found = true;
      }
    } else if (typeof meta.billed_units === "object" && meta.billed_units !== null) {
      const units = meta.billed_units as Record<string, unknown>;
      if (typeof units.input_tokens === "number") {
        result.promptTokens = units.input_tokens;
        found = true;
      }
      if (typeof units.output_tokens === "number") {
        result.completionTokens = units.output_tokens;
        found = true;
      }
    }
  }

  // 5. Amazon Bedrock invocation metrics: obj["amazon-bedrock-invocationMetrics"]
  const bedrockMetrics = obj["amazon-bedrock-invocationMetrics"];
  if (typeof bedrockMetrics === "object" && bedrockMetrics !== null) {
    const metrics = bedrockMetrics as Record<string, unknown>;
    if (typeof metrics.inputTokenCount === "number") {
      result.promptTokens = metrics.inputTokenCount;
      found = true;
    }
    if (typeof metrics.outputTokenCount === "number") {
      result.completionTokens = metrics.outputTokenCount;
      found = true;
    }
  }

  // 6. Direct root tokens (e.g. { prompt_tokens: 10, completion_tokens: 20 })
  if (!found) {
    if (typeof obj.prompt_tokens === "number") {
      result.promptTokens = obj.prompt_tokens;
      found = true;
    }
    if (typeof obj.completion_tokens === "number") {
      result.completionTokens = obj.completion_tokens;
      found = true;
    }
    if (typeof obj.total_tokens === "number") {
      result.totalTokens = obj.total_tokens;
      found = true;
    }
  }

  if (!found) {
    return null;
  }

  return result;
}

/**
 * Web TransformStream implementation for parsing upstream Server-Sent Events (SSE).
 *
 * Operates on incoming chunk stream (Uint8Array or string), emits standard SSE chunks
 * to downstream client while extracting usage and telemetry metadata in real-time.
 */
export class SSEStreamTransformer<
  TChunk extends Uint8Array | string = Uint8Array | string
> extends TransformStream<TChunk, TChunk> {
  private readonly options: SSEStreamTransformerOptions;
  private readonly decoder: TextDecoder;
  private readonly encoder: TextEncoder;

  private buffer: string = "";
  private isBinaryStream: boolean = true;
  private currentEventDataLines: string[] = [];
  private currentEventRawLines: string[] = [];
  private currentEventType?: string;
  private currentEventId?: string;
  private currentEventRetry?: number;

  private _promptTokens: number = 0;
  private _completionTokens: number = 0;
  private _totalTokens?: number;
  private _cachedTokens: number = 0;
  private _reasoningTokens: number = 0;
  private _hasUsage: boolean = false;
  private _usage: StreamUsage | null = null;

  private readonly _metadata: StreamMetadata;
  private readonly _events: SSEEvent[] = [];

  private usageResolve!: (usage: StreamUsage | null) => void;
  private metadataResolve!: (metadata: StreamMetadata) => void;

  public readonly usagePromise: Promise<StreamUsage | null>;
  public readonly metadataPromise: Promise<StreamMetadata>;

  constructor(options: SSEStreamTransformerOptions = {}) {
    let instanceRef!: SSEStreamTransformer<TChunk>;

    super({
      transform(chunk: TChunk, controller: TransformStreamDefaultController<TChunk>) {
        instanceRef.handleTransform(chunk, controller);
      },
      flush(controller: TransformStreamDefaultController<TChunk>) {
        instanceRef.handleFlush(controller);
      },
    });

    instanceRef = this;
    this.options = options;
    this.decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });
    this.encoder = new TextEncoder();

    const startTs = options.startedAt ?? Date.now();
    this._metadata = {
      startedAt: startTs,
      chunkCount: 0,
      eventCount: 0,
    };

    this.usagePromise = new Promise<StreamUsage | null>((resolve) => {
      this.usageResolve = resolve;
    });

    this.metadataPromise = new Promise<StreamMetadata>((resolve) => {
      this.metadataResolve = resolve;
    });
  }

  /**
   * Synchronous getter for current extracted usage (null if no usage block has been encountered).
   */
  public get usage(): StreamUsage | null {
    return this._usage;
  }

  /**
   * Synchronous getter for stream metadata intercepted up to this point.
   */
  public get metadata(): Readonly<StreamMetadata> {
    return this._metadata;
  }

  /**
   * List of all parsed SSEEvent instances.
   */
  public get events(): readonly SSEEvent[] {
    return this._events;
  }

  /**
   * Asynchronously retrieves the final authoritative usage block once the stream finishes.
   * If timeoutMs is specified, rejects if stream does not complete within the duration.
   */
  public async getUsage(timeoutMs?: number): Promise<StreamUsage | null> {
    if (timeoutMs === undefined || timeoutMs <= 0) {
      return this.usagePromise;
    }

    return Promise.race([
      this.usagePromise,
      new Promise<StreamUsage | null>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Timed out waiting for stream usage after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  }

  /**
   * Asynchronously retrieves the final stream metadata once the stream finishes.
   */
  public async getMetadata(timeoutMs?: number): Promise<StreamMetadata> {
    if (timeoutMs === undefined || timeoutMs <= 0) {
      return this.metadataPromise;
    }

    return Promise.race([
      this.metadataPromise,
      new Promise<StreamMetadata>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Timed out waiting for stream metadata after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  }

  /**
   * Core chunk transformation handler.
   */
  private handleTransform(
    chunk: TChunk,
    controller: TransformStreamDefaultController<TChunk>
  ): void {
    const now = Date.now();
    this._metadata.chunkCount++;

    if (typeof chunk === "string") {
      this.isBinaryStream = false;
    }

    if (this._metadata.firstChunkReceivedAt === undefined) {
      this._metadata.firstChunkReceivedAt = now;
      this._metadata.timeToFirstTokenMs = now - this._metadata.startedAt;
    }

    // In passthrough mode, forward the raw chunk to client immediately with zero delay
    const mode = this.options.mode ?? "passthrough";
    if (mode === "passthrough") {
      controller.enqueue(chunk);
    }

    // Decode chunk text for non-blocking SSE parsing
    let textChunk: string;
    if (typeof chunk === "string") {
      textChunk = chunk;
    } else {
      textChunk = this.decoder.decode(chunk, { stream: true });
    }

    this.buffer += textChunk;
    this.parseBuffer(controller, mode === "events");
  }

  /**
   * Flushes remaining buffered bytes and completes metadata upon stream end.
   */
  private handleFlush(controller: TransformStreamDefaultController<TChunk>): void {
    const remainingText = this.decoder.decode();
    if (remainingText.length > 0) {
      this.buffer += remainingText;
    }

    const mode = this.options.mode ?? "passthrough";
    this.parseBuffer(controller, mode === "events", true);

    // If there is un-delimited text in the buffer, process it as a line
    if (this.buffer.length > 0) {
      const remainingLine = this.buffer;
      this.buffer = "";
      this.processLine(remainingLine, controller, mode === "events");
    }

    // If there is an unfinished event remaining in the buffer, dispatch it
    if (
      this.currentEventDataLines.length > 0 ||
      this.currentEventType !== undefined ||
      this.currentEventId !== undefined
    ) {
      this.dispatchEvent(controller, mode === "events");
    }

    const now = Date.now();
    this._metadata.completedAt = now;
    this._metadata.totalDurationMs = now - this._metadata.startedAt;

    // Resolve promises
    this.usageResolve(this._usage);
    this.metadataResolve(this._metadata);

    // Fire callbacks
    this.options.onMetadata?.(this._metadata);
    this.options.onDone?.();
  }

  /**
   * Scans buffer for complete lines and dispatches SSE events on empty lines.
   */
  private parseBuffer(
    controller: TransformStreamDefaultController<TChunk>,
    enqueueEvents: boolean,
    isFlushing: boolean = false
  ): void {
    let newlineIndex: number;

    while ((newlineIndex = this.findNextNewlineIndex(this.buffer, isFlushing)) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      const isCRLF =
        this.buffer.charCodeAt(newlineIndex) === 13 &&
        this.buffer.charCodeAt(newlineIndex + 1) === 10;
      const delimiterLen = isCRLF ? 2 : 1;

      this.buffer = this.buffer.slice(newlineIndex + delimiterLen);
      this.processLine(line, controller, enqueueEvents);
    }
  }

  /**
   * Finds index of next newline character (\n or \r\n or \r).
   * If a trailing \r is at the buffer edge and not flushing, returns -1 to await next chunk.
   */
  private findNextNewlineIndex(buf: string, isFlushing: boolean): number {
    for (let i = 0; i < buf.length; i++) {
      const code = buf.charCodeAt(i);
      if (code === 10) {
        return i;
      }
      if (code === 13) {
        if (i === buf.length - 1 && !isFlushing) {
          return -1;
        }
        return i;
      }
    }
    return -1;
  }

  /**
   * Processes a single SSE line.
   * An empty line signals the end of an event block and dispatches it.
   */
  private processLine(
    line: string,
    controller: TransformStreamDefaultController<TChunk>,
    enqueueEvents: boolean
  ): void {
    // SSE event delimiter: empty line
    if (line.length === 0) {
      if (
        this.currentEventDataLines.length > 0 ||
        this.currentEventType !== undefined ||
        this.currentEventId !== undefined
      ) {
        this.dispatchEvent(controller, enqueueEvents);
      }
      return;
    }

    // Comment line (begins with ':')
    if (line.charCodeAt(0) === 58) {
      this.currentEventRawLines.push(line);
      return;
    }

    this.currentEventRawLines.push(line);

    // Parse SSE fields: data, event, id, retry
    if (line.startsWith("data:")) {
      let value = line.slice(5);
      if (value.charCodeAt(0) === 32) {
        value = value.slice(1);
      }
      this.currentEventDataLines.push(value);
    } else if (line === "data") {
      this.currentEventDataLines.push("");
    } else if (line.startsWith("event:")) {
      let value = line.slice(6);
      if (value.charCodeAt(0) === 32) {
        value = value.slice(1);
      }
      this.currentEventType = value;
    } else if (line.startsWith("id:")) {
      let value = line.slice(3);
      if (value.charCodeAt(0) === 32) {
        value = value.slice(1);
      }
      this.currentEventId = value;
    } else if (line.startsWith("retry:")) {
      let value = line.slice(6).trim();
      const parsedRetry = parseInt(value, 10);
      if (!isNaN(parsedRetry)) {
        this.currentEventRetry = parsedRetry;
      }
    }
  }

  /**
   * Dispatches a completed SSE event, extracting usage and metadata.
   */
  private dispatchEvent(
    controller: TransformStreamDefaultController<TChunk>,
    enqueueEvents: boolean
  ): void {
    const data = this.currentEventDataLines.join("\n");
    const raw = this.currentEventRawLines.join("\n");

    const event: SSEEvent = {
      ...(this.currentEventType !== undefined ? { event: this.currentEventType } : {}),
      ...(this.currentEventId !== undefined ? { id: this.currentEventId } : {}),
      ...(this.currentEventRetry !== undefined ? { retry: this.currentEventRetry } : {}),
      data,
      raw,
    };

    // Reset current event state
    this.currentEventDataLines = [];
    this.currentEventRawLines = [];
    this.currentEventType = undefined;
    this.currentEventId = undefined;
    this.currentEventRetry = undefined;

    this._metadata.eventCount++;

    if (this.options.bufferEvents !== false) {
      this._events.push(event);
    }

    // In events mode, enqueue the formatted SSE event to downstream
    if (enqueueEvents) {
      let sseFormatted = "";
      if (event.event !== undefined) {
        sseFormatted += `event: ${event.event}\n`;
      }
      if (event.id !== undefined) {
        sseFormatted += `id: ${event.id}\n`;
      }
      if (event.retry !== undefined) {
        sseFormatted += `retry: ${event.retry}\n`;
      }
      for (const line of data.split("\n")) {
        sseFormatted += `data: ${line}\n`;
      }
      sseFormatted += "\n";

      // Match input chunk type (string or Uint8Array)
      if (this.isBinaryStream) {
        controller.enqueue(this.encoder.encode(sseFormatted) as unknown as TChunk);
      } else {
        controller.enqueue(sseFormatted as unknown as TChunk);
      }
    }

    // Attempt to inspect JSON payload for usage and metadata
    this.inspectEventPayload(event);

    // Trigger onEvent callback
    this.options.onEvent?.(event);
  }

  /**
   * Inspects event.data for JSON-encoded model metadata and usage blocks.
   */
  private inspectEventPayload(event: SSEEvent): void {
    const trimmed = event.data.trim();
    if (
      trimmed.length === 0 ||
      trimmed === "[DONE]" ||
      (!trimmed.startsWith("{") && !trimmed.startsWith("["))
    ) {
      return;
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;

      // Intercept model metadata
      if (typeof parsed.model === "string" && !this._metadata.model) {
        this._metadata.model = parsed.model;
      }
      if (
        typeof parsed.system_fingerprint === "string" &&
        !this._metadata.systemFingerprint
      ) {
        this._metadata.systemFingerprint = parsed.system_fingerprint;
      }

      // Check choices for finish_reason
      if (Array.isArray(parsed.choices) && parsed.choices.length > 0) {
        const firstChoice = parsed.choices[0] as Record<string, unknown>;
        if (
          typeof firstChoice?.finish_reason === "string" &&
          firstChoice.finish_reason.length > 0
        ) {
          this._metadata.finishReason = firstChoice.finish_reason;
        }
      }

      // Extract usage blocks across providers
      const usageUpdate = extractUsageFromPayload(parsed);
      if (usageUpdate) {
        this.applyUsageUpdate(usageUpdate, parsed);
      }
    } catch {
      // Ignore JSON parse errors on non-JSON SSE lines
    }
  }

  /**
   * Applies an incremental or terminal usage update to the internal state.
   */
  private applyUsageUpdate(
    update: Partial<StreamUsage>,
    rawPayload?: Record<string, unknown>
  ): void {
    this._hasUsage = true;

    if (update.promptTokens !== undefined) {
      this._promptTokens = update.promptTokens;
    }
    if (update.completionTokens !== undefined) {
      this._completionTokens = update.completionTokens;
    }
    if (update.cachedTokens !== undefined) {
      this._cachedTokens = update.cachedTokens;
    }
    if (update.reasoningTokens !== undefined) {
      this._reasoningTokens = update.reasoningTokens;
    }

    const total =
      update.totalTokens !== undefined
        ? update.totalTokens
        : this._promptTokens + this._completionTokens;
    this._totalTokens = total;

    const compiledUsage: StreamUsage = {
      promptTokens: this._promptTokens,
      completionTokens: this._completionTokens,
      totalTokens: total,
      ...(this._cachedTokens > 0 ? { cachedTokens: this._cachedTokens } : {}),
      ...(this._reasoningTokens > 0 ? { reasoningTokens: this._reasoningTokens } : {}),

      // Snake_case aliases
      prompt_tokens: this._promptTokens,
      completion_tokens: this._completionTokens,
      total_tokens: total,
      ...(this._cachedTokens > 0 ? { cached_tokens: this._cachedTokens } : {}),
      ...(this._reasoningTokens > 0 ? { reasoning_tokens: this._reasoningTokens } : {}),

      ...(rawPayload !== undefined ? { raw: rawPayload } : {}),
    };

    this._usage = compiledUsage;
    this.options.onUsage?.(compiledUsage);
  }
}
