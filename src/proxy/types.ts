/**
 * Internal proxy interfaces for provider-specific payloads, streaming responses,
 * and cost calculation metrics.
 *
 * Strict TypeScript mode: zero `any` usage.
 * Fixed-point financials: all costs represented in int64 microdollars (bigint).
 */

export type SupportedProvider = 'openai' | 'anthropic' | 'google';

/**
 * Common token usage metrics returned by or calculated from provider responses.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
}

/**
 * Cost calculation metrics in fixed-point microdollars (1 USD = 1,000,000 µ$).
 */
export interface CostMetrics {
  promptCostMicrodollars: bigint;
  completionCostMicrodollars: bigint;
  cachedCostMicrodollars: bigint;
  totalCostMicrodollars: bigint;
}

/**
 * Model pricing configuration per 1,000,000 tokens in microdollars.
 */
export interface ModelPricingTier {
  promptMicrodollarsPerMillion: bigint;
  completionMicrodollarsPerMillion: bigint;
  cachedPromptMicrodollarsPerMillion?: bigint;
}

/**
 * Normalized representation of an incoming chat completion request.
 */
export interface NormalizedChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface NormalizedProxyRequest {
  model: string;
  messages: NormalizedChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
  stop?: string | string[];
}

/**
 * Normalized representation of a non-streaming chat completion response.
 */
export interface NormalizedProxyResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: NormalizedChatMessage;
    finishReason: string | null;
  }>;
  usage: TokenUsage;
  cost: CostMetrics;
}

/**
 * Normalized streaming chunk delta.
 */
export interface NormalizedStreamChunk {
  id: string;
  model: string;
  delta: {
    role?: 'assistant';
    content?: string;
  };
  finishReason: string | null;
  usage?: TokenUsage;
}

// ============================================================================
// Provider-Specific Request Payloads
// ============================================================================

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string | unknown;
    name?: string;
  }>;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  stop?: string | string[];
  [key: string]: unknown;
}

export interface AnthropicMessageRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; [key: string]: unknown }>;
  }>;
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop_sequences?: string[];
  [key: string]: unknown;
}

export interface GoogleGeminiGenerateContentRequest {
  contents: Array<{
    role?: 'user' | 'model';
    parts: Array<{ text: string }>;
  }>;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
  [key: string]: unknown;
}

export type ProviderRequestPayload =
  | OpenAIChatCompletionRequest
  | AnthropicMessageRequest
  | GoogleGeminiGenerateContentRequest;

// ============================================================================
// Provider-Specific Streaming & Raw Chunk Definitions
// ============================================================================

export interface OpenAIStreamChunkChoice {
  index: number;
  delta: {
    role?: 'assistant';
    content?: string;
  };
  finish_reason: string | null;
}

export interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIStreamChunkChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface AnthropicStreamEvent {
  type:
    | 'message_start'
    | 'content_block_start'
    | 'content_block_delta'
    | 'content_block_stop'
    | 'message_delta'
    | 'message_stop'
    | 'ping'
    | 'error';
  message?: {
    id: string;
    type: string;
    role: string;
    content: unknown[];
    model: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  delta?: {
    type?: string;
    text?: string;
    stop_reason?: string | null;
    usage?: {
      output_tokens: number;
    };
  };
  usage?: {
    output_tokens: number;
  };
}

export interface GoogleGeminiStreamChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
      role?: string;
    };
    finishReason?: string;
    index?: number;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

// ============================================================================
// Proxy Execution Context & Adapter Interfaces
// ============================================================================

export interface UpstreamRequestConfig {
  url: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body: string;
}

export interface StreamAccumulatorState {
  id: string;
  model: string;
  fullContent: string;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  finishReason: string | null;
  ttftMs: number | null;
}

export interface ProxySessionContext {
  tenantId: string;
  keyId: string;
  provider: SupportedProvider;
  model: string;
  startTime: number;
  isStreaming: boolean;
}

export interface ProviderAdapter {
  readonly provider: SupportedProvider;

  buildUpstreamRequest(
    normalized: NormalizedProxyRequest,
    decryptedApiKey: string
  ): UpstreamRequestConfig;

  parseResponse(
    responseBody: string,
    model: string
  ): {
    normalized: NormalizedProxyResponse;
    usage: TokenUsage;
  };

  parseStreamChunk(
    rawSseLine: string,
    state: StreamAccumulatorState
  ): NormalizedStreamChunk | null;

  calculateCost(model: string, usage: TokenUsage): CostMetrics;
}
