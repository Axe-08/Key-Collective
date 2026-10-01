/**
 * @file types.ts
 * Types and interfaces for the ApiDocs component and interactive runner.
 */

export type ProviderFilter = 'OpenAI Compatible' | 'Anthropic' | 'Gemini' | 'Groq' | 'DeepSeek';

export interface ModelOption {
  id: string;
  provider: string;
}

export interface ModelPricingItem {
  id: string;
  owned_by: string;
  routing_engine: string;
  cu_base: number;
  cu_in_per_1k: number;
  cu_cached_per_1k: number;
  cu_out_per_1k: number;
  bulletClass: string;
  isDeprecated: boolean;
  sunsetAt?: string | null;
}

export interface ResponseChunk {
  text: string;
  class: string;
}

