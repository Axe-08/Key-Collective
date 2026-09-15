/**
 * @file extractor.ts
 * Extraction of capability requirements from request payloads.
 */

import {
  CapabilityRequirements,
  RequirementExtractionOptions,
  isRecord,
  isCapabilityRequirements,
} from "./types";
import { estimateTokens } from "./token_estimator";

/**
 * Extracts required model capabilities from an incoming request payload or RouteRequest.
 * Inspects messages for multimodal content, tool definitions, structured response format,
 * and estimates required context window tokens.
 */
export function extractRequirements(
  request: unknown,
  options?: RequirementExtractionOptions
): CapabilityRequirements {
  if (!request || !isRecord(request)) {
    return {
      requiresTools: false,
      requiresVision: false,
      requiresJsonSchema: false,
      onlyActive: options?.onlyActive ?? true,
      ...(options?.provider ? { provider: options.provider } : {}),
      ...(options?.maxCostPerMTokMicro !== undefined
        ? { maxCostPerMTokMicro: options.maxCostPerMTokMicro }
        : {}),
    };
  }

  // If caller already provided a CapabilityRequirements object, pass it through with options merged
  if (isCapabilityRequirements(request)) {
    const cr = request as CapabilityRequirements;
    return {
      minContextLength: cr.minContextLength,
      maxOutputTokens: cr.maxOutputTokens,
      requiresTools: cr.requiresTools,
      requiresVision: cr.requiresVision,
      requiresJsonSchema: cr.requiresJsonSchema,
      requiresStreaming: cr.requiresStreaming,
      onlyActive: options?.onlyActive ?? cr.onlyActive ?? true,
      provider: options?.provider ?? cr.provider,
      maxCostPerMTokMicro: options?.maxCostPerMTokMicro ?? cr.maxCostPerMTokMicro,
    };
  }

  const req = request as Record<string, unknown>;

  let requiresTools = false;
  let requiresVision = false;
  let requiresJsonSchema = false;
  let requiresStreaming = false;

  // 1. Tool / Function Calling Extraction
  const hasTools = Array.isArray(req.tools) && req.tools.length > 0;
  const hasFunctions = Array.isArray(req.functions) && req.functions.length > 0;
  const toolChoice = req.tool_choice;
  const functionCall = req.function_call;

  if (hasTools || hasFunctions) {
    requiresTools = true;
  } else if (toolChoice !== undefined && toolChoice !== "none") {
    requiresTools = true;
  } else if (functionCall !== undefined && functionCall !== "none") {
    requiresTools = true;
  }

  // 2. Multimodal Vision Extraction
  if (Array.isArray(req.messages)) {
    for (const msg of req.messages) {
      if (!isRecord(msg)) continue;

      // Check multipart content array
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (!isRecord(part)) continue;
          const partType = typeof part.type === "string" ? part.type.toLowerCase() : "";
          if (
            partType === "image_url" ||
            partType === "image" ||
            "image_url" in part ||
            "image" in part
          ) {
            requiresVision = true;
            break;
          }
        }
      } else if (typeof msg.content === "string") {
        // Check inline data URI images (e.g. data:image/png;base64,...)
        if (msg.content.includes("data:image/")) {
          requiresVision = true;
        }
      }

      // Ollama / local multimodal image arrays
      if (Array.isArray(msg.images) && msg.images.length > 0) {
        requiresVision = true;
      }

      if (requiresVision) break;
    }
  }

  // Top-level image fields
  if (Array.isArray(req.images) && req.images.length > 0) {
    requiresVision = true;
  }

  // 3. Structured Output / JSON Schema Extraction
  if (req.response_format !== undefined) {
    if (typeof req.response_format === "string") {
      const rf = req.response_format.toLowerCase().trim();
      if (rf === "json_object" || rf === "json_schema") {
        requiresJsonSchema = true;
      }
    } else if (isRecord(req.response_format)) {
      const rfType =
        typeof req.response_format.type === "string"
          ? req.response_format.type.toLowerCase().trim()
          : "";
      if (
        rfType === "json_object" ||
        rfType === "json_schema" ||
        "json_schema" in req.response_format
      ) {
        requiresJsonSchema = true;
      }
    }
  }

  if (req.json_schema !== undefined || req.output_schema !== undefined) {
    requiresJsonSchema = true;
  }

  // 4. Streaming Request Flag
  if (req.stream === true) {
    requiresStreaming = true;
  }

  // 5. Context Window & Max Output Extraction
  let maxOutputTokens: number | undefined;
  if (typeof req.max_tokens === "number" && req.max_tokens > 0) {
    maxOutputTokens = Math.trunc(req.max_tokens);
  } else if (
    typeof req.max_completion_tokens === "number" &&
    req.max_completion_tokens > 0
  ) {
    maxOutputTokens = Math.trunc(req.max_completion_tokens);
  } else if (
    options?.defaultMaxOutputTokens !== undefined &&
    options.defaultMaxOutputTokens > 0
  ) {
    maxOutputTokens = Math.trunc(options.defaultMaxOutputTokens);
  }

  let estimatedPromptTokens = 0;
  if (
    options?.estimatedPromptTokens !== undefined &&
    options.estimatedPromptTokens >= 0
  ) {
    estimatedPromptTokens = Math.trunc(options.estimatedPromptTokens);
  } else {
    // Estimate prompt tokens from messages, system prompt, and tools
    if (Array.isArray(req.messages)) {
      estimatedPromptTokens += estimateTokens(req.messages);
    }
    if (req.system !== undefined) {
      estimatedPromptTokens += estimateTokens(req.system);
    }
    if (Array.isArray(req.tools)) {
      estimatedPromptTokens += estimateTokens(req.tools);
    }
    if (Array.isArray(req.functions)) {
      estimatedPromptTokens += estimateTokens(req.functions);
    }
  }

  const bufferMultiplier = options?.contextBufferMultiplier ?? 1.0;
  const totalRequiredTokens = Math.ceil(
    (estimatedPromptTokens + (maxOutputTokens ?? 0)) * bufferMultiplier
  );
  const minContextLength = totalRequiredTokens > 0 ? totalRequiredTokens : undefined;

  return {
    requiresTools,
    requiresVision,
    requiresJsonSchema,
    requiresStreaming: requiresStreaming || undefined,
    minContextLength,
    maxOutputTokens,
    onlyActive: options?.onlyActive ?? true,
    provider: options?.provider,
    maxCostPerMTokMicro: options?.maxCostPerMTokMicro,
  };
}
