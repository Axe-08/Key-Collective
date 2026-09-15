/**
 * @file transformer.ts
 * Web TransformStream implementation for parsing upstream Server-Sent Events (SSE).
 */

import type {
  SSEEvent,
  StreamMetadata,
  StreamUsage,
  SSEStreamTransformerOptions,
} from "./types";
import { extractUsageFromPayload } from "./usage_extractor";

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
