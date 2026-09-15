/**
 * @file token_estimator.ts
 * Fast token estimator heuristics for request payloads.
 */

import { isRecord } from "./types";

/**
 * Fast token estimator heuristic (~4 characters per token + framing overhead).
 * Supports strings, numbers, message arrays, parts, and objects.
 */
export function estimateTokens(input: unknown): number {
  if (input === null || input === undefined) {
    return 0;
  }
  if (typeof input === "string") {
    if (input.length === 0) return 0;
    return Math.max(1, Math.ceil(input.length / 4));
  }
  if (typeof input === "number" || typeof input === "boolean") {
    return 1;
  }
  if (Array.isArray(input)) {
    let total = 0;
    for (const item of input) {
      total += estimateTokens(item) + 4; // 4 tokens framing overhead per message/item
    }
    return total;
  }
  if (isRecord(input)) {
    // Message object with role/content
    if ("content" in input) {
      let msgTokens = 4; // Message frame overhead
      if (typeof input.role === "string") {
        msgTokens += Math.max(1, Math.ceil(input.role.length / 4));
      }
      if (input.content !== undefined) {
        msgTokens += estimateTokens(input.content);
      }
      if ("name" in input && typeof input.name === "string") {
        msgTokens += Math.max(1, Math.ceil(input.name.length / 4));
      }
      if ("tool_calls" in input && Array.isArray(input.tool_calls)) {
        msgTokens += estimateTokens(input.tool_calls);
      }
      return msgTokens;
    }
    // Multimodal image part
    if (input.type === "image_url" || input.type === "image") {
      return 800; // Standard nominal image tile token cost
    }
    // Text part
    if (input.type === "text" && typeof input.text === "string") {
      return Math.max(1, Math.ceil(input.text.length / 4));
    }
    // General structured schema / function definition
    try {
      const json = JSON.stringify(input);
      return Math.max(1, Math.ceil(json.length / 4));
    } catch {
      return 10;
    }
  }
  return 0;
}
