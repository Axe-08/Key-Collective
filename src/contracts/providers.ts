export const CANONICAL_PROVIDERS = ["gemini", "groq", "cerebras", "deepseek", "sambanova"] as const;
export type CanonicalProvider = typeof CANONICAL_PROVIDERS[number];

export function normalizeProvider(provider: string): CanonicalProvider {
  const p = provider.toLowerCase();
  if (CANONICAL_PROVIDERS.includes(p as CanonicalProvider)) {
    return p as CanonicalProvider;
  }
  return "gemini";
}
