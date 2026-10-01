/**
 * @file usage_extractor.ts
 * Multi-provider usage and token extraction logic from raw SSE JSON chunks.
 */

import type { StreamUsage } from "./types";

/**
 * Safely extracts streamed delta content from an SSE chunk JSON payload.
 * Supports OpenAI-compatible chunk schemas (choices[0].delta.content).
 */
export function extractDeltaContent(payload: unknown): string | null {
  let obj: unknown = payload;
  if (typeof payload === "string") {
    try {
      obj = JSON.parse(payload);
    } catch {
      return null;
    }
  }

  if (typeof obj !== "object" || obj === null) {
    return null;
  }

  const record = obj as Record<string, unknown>;
  if (Array.isArray(record.choices) && record.choices.length > 0) {
    const firstChoice = record.choices[0];
    if (typeof firstChoice === "object" && firstChoice !== null) {
      const delta = (firstChoice as Record<string, unknown>).delta;
      if (typeof delta === "object" && delta !== null) {
        const content = (delta as Record<string, unknown>).content;
        if (typeof content === "string") {
          return content;
        }
      }
      if (typeof (firstChoice as Record<string, unknown>).text === "string") {
        return (firstChoice as Record<string, unknown>).text as string;
      }
    }
  }

  return null;
}

/**
 * Helper to safely extract usage tokens from arbitrary provider JSON payloads.
 * Handles OpenAI (standard and include_usage), Gemini, Anthropic, Cohere, Bedrock, Groq,
 * and Key Collective kc.usage schemas.
 */
export function extractUsageFromPayload(
  payload: unknown
): Partial<StreamUsage> | null {
  let obj: unknown = payload;
  if (typeof payload === "string") {
    try {
      obj = JSON.parse(payload);
    } catch {
      return null;
    }
  }

  if (typeof obj !== "object" || obj === null) {
    return null;
  }

  const record = obj as Record<string, unknown>;
  const result: Partial<StreamUsage> = {};
  let found = false;

  // 1. OpenAI, Groq, DeepSeek, Together, Mistral standard format: record.usage or record.tokens
  let usageObj: Record<string, unknown> | null = null;
  if (typeof record.usage === "object" && record.usage !== null) {
    usageObj = record.usage as Record<string, unknown>;
  } else if (
    typeof record.x_groq === "object" &&
    record.x_groq !== null &&
    typeof (record.x_groq as Record<string, unknown>).usage === "object" &&
    (record.x_groq as Record<string, unknown>).usage !== null
  ) {
    usageObj = (record.x_groq as Record<string, unknown>).usage as Record<string, unknown>;
  } else if (typeof record.tokens === "object" && record.tokens !== null) {
    usageObj = record.tokens as Record<string, unknown>;
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

  // 2. Google / Gemini format: record.usageMetadata
  if (typeof record.usageMetadata === "object" && record.usageMetadata !== null) {
    const meta = record.usageMetadata as Record<string, unknown>;
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
  // message_start event: record.message.usage = { input_tokens, output_tokens, cache_read_input_tokens }
  // message_delta event: record.usage = { output_tokens }
  if (typeof record.message === "object" && record.message !== null) {
    const msg = record.message as Record<string, unknown>;
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

  // 4. Cohere format: record.meta.tokens or record.meta.billed_units
  if (typeof record.meta === "object" && record.meta !== null) {
    const meta = record.meta as Record<string, unknown>;
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

  // 5. Amazon Bedrock invocation metrics: record["amazon-bedrock-invocationMetrics"]
  const bedrockMetrics = record["amazon-bedrock-invocationMetrics"];
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

  // 6. Key Collective kc.usage metrics (e.g. { cu: number } or { kc: { cu: number } })
  if (typeof record.cu === "number") {
    result.cu = record.cu;
    found = true;
  } else if (
    typeof record.kc === "object" &&
    record.kc !== null &&
    typeof (record.kc as Record<string, unknown>).cu === "number"
  ) {
    result.cu = (record.kc as Record<string, unknown>).cu as number;
    found = true;
  }

  // 7. Direct root tokens (e.g. { prompt_tokens: 10, completion_tokens: 20 })
  if (typeof record.prompt_tokens === "number") {
    result.promptTokens = record.prompt_tokens;
    found = true;
  } else if (typeof record.promptTokens === "number") {
    result.promptTokens = record.promptTokens;
    found = true;
  } else if (typeof record.input_tokens === "number") {
    result.promptTokens = record.input_tokens;
    found = true;
  }

  if (typeof record.completion_tokens === "number") {
    result.completionTokens = record.completion_tokens;
    found = true;
  } else if (typeof record.completionTokens === "number") {
    result.completionTokens = record.completionTokens;
    found = true;
  } else if (typeof record.output_tokens === "number") {
    result.completionTokens = record.output_tokens;
    found = true;
  }

  if (typeof record.total_tokens === "number") {
    result.totalTokens = record.total_tokens;
    found = true;
  } else if (typeof record.totalTokens === "number") {
    result.totalTokens = record.totalTokens;
    found = true;
  }

  if (typeof record.cached_tokens === "number") {
    result.cachedTokens = record.cached_tokens;
  } else if (typeof record.cachedTokens === "number") {
    result.cachedTokens = record.cachedTokens;
  }

  if (typeof record.reasoning_tokens === "number") {
    result.reasoningTokens = record.reasoning_tokens;
  } else if (typeof record.reasoningTokens === "number") {
    result.reasoningTokens = record.reasoningTokens;
  }

  // 8. Estimation and streamed chars flags if present
  if (typeof record.usage_estimated === "number") {
    result.usage_estimated = record.usage_estimated;
    result.usageEstimated = record.usage_estimated;
    found = true;
  } else if (typeof record.usageEstimated === "number") {
    result.usage_estimated = record.usageEstimated;
    result.usageEstimated = record.usageEstimated;
    found = true;
  }

  if (typeof record.streamedChars === "number") {
    result.streamedChars = record.streamedChars;
    found = true;
  } else if (typeof record.streamed_chars === "number") {
    result.streamedChars = record.streamed_chars;
    found = true;
  }

  if (!found) {
    return null;
  }

  return result;
}
