/**
 * Key Collective v2 — Upstream Payload Normalization & Text Extraction
 *
 * Conforms to:
 * - LLD 3.2: Multi-provider payload extraction (OpenAI, Anthropic, Gemini, Cohere, Groq, Mistral, DeepSeek).
 */

/**
 * Extracts completion text content from arbitrary provider JSON payloads.
 * Handles OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, and Cohere response shapes.
 */
export function extractContentFromPayload(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }

  const obj = payload as Record<string, unknown>;

  // 1. OpenAI, Groq, DeepSeek, Mistral, Together format: choices[0].message.content or choices[0].text
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const firstChoice = obj.choices[0] as Record<string, unknown>;
    if (typeof firstChoice?.message === "object" && firstChoice.message !== null) {
      const msg = firstChoice.message as Record<string, unknown>;
      if (typeof msg.content === "string") {
        return msg.content;
      }
    }
    if (typeof firstChoice?.text === "string") {
      return firstChoice.text;
    }
  }

  // 2. Anthropic format: content array of [{ type: "text", text: "..." }]
  if (Array.isArray(obj.content)) {
    const textBlocks: string[] = [];
    for (const item of obj.content) {
      if (typeof item === "object" && item !== null) {
        const block = item as Record<string, unknown>;
        if (block.type === "text" && typeof block.text === "string") {
          textBlocks.push(block.text);
        }
      }
    }
    if (textBlocks.length > 0) {
      return textBlocks.join("");
    }
  }

  // 3. Google / Gemini format: candidates[0].content.parts[0].text
  if (Array.isArray(obj.candidates) && obj.candidates.length > 0) {
    const candidate = obj.candidates[0] as Record<string, unknown>;
    if (typeof candidate?.content === "object" && candidate.content !== null) {
      const content = candidate.content as Record<string, unknown>;
      if (Array.isArray(content.parts)) {
        const partsText: string[] = [];
        for (const part of content.parts) {
          if (
            typeof part === "object" &&
            part !== null &&
            typeof (part as Record<string, unknown>).text === "string"
          ) {
            partsText.push((part as Record<string, unknown>).text as string);
          }
        }
        if (partsText.length > 0) {
          return partsText.join("");
        }
      }
    }
  }

  // 4. Cohere format: message.content or direct text field
  if (typeof obj.text === "string") {
    return obj.text;
  }
  if (typeof obj.message === "object" && obj.message !== null) {
    const msg = obj.message as Record<string, unknown>;
    if (typeof msg.content === "string") {
      return msg.content;
    }
  }

  return "";
}
