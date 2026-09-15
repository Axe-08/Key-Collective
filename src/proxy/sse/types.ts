/**
 * @file types.ts
 * Types and interfaces for Server-Sent Events (SSE) streaming and usage tracking.
 */

import type { TokenUsage } from "../../router/model_registry";

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
