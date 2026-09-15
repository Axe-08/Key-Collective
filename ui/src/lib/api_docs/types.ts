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
  inputCost1kMicro: number;
  outputCost1kMicro: number;
  inputCostPerMUsd: string;
  outputCostPerMUsd: string;
  bulletClass: string;
  isDeprecated: boolean;
  sunsetAt?: string | null;
}

export interface ResponseChunk {
  text: string;
  class: string;
}

export const CANONICAL_MODELS: ModelOption[] = [
  { id: 'gemini-3.8-flash', provider: 'google' },
  { id: 'gemini-3.5-flash', provider: 'google' },
  { id: 'gemini-3.5-flash-lite', provider: 'google' },
  { id: 'gemini-3.1-pro-preview', provider: 'google' },
  { id: 'gemini-2.5-flash', provider: 'google' },
  { id: 'qwen/qwen3.8-27b', provider: 'groq' },
  { id: 'qwen/qwen3.6-27b', provider: 'groq' },
  { id: 'openai/gpt-oss-120b', provider: 'groq' },
  { id: 'openai/gpt-oss-20b', provider: 'groq' },
  { id: 'deepseek/deepseek-r1-distill-llama-70b', provider: 'deepseek' },
  { id: 'Meta-Llama-3.1-405B-Instruct', provider: 'sambanova' },
  { id: 'llama3.1-70b', provider: 'cerebras' },
];
