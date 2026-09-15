/**
 * @file usage_extractor.ts
 * Multi-provider usage and token extraction logic from raw SSE JSON chunks.
 */

import type { StreamUsage } from "./types";

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
