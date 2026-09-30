/**
 * Key Collective v2 — Provider Configuration
 *
 * Single source of truth for supported model providers and their base URLs.
 * Conforms to LLD 3.4 (Providers and model catalog).
 */

/**
 * Supported upstream provider identifiers.
 */
export type ProviderId = "google" | "groq";

/**
 * Configuration for a single upstream provider.
 */
export interface ProviderConfig {
  /** Canonical provider identifier. */
  id: ProviderId;
  /** Base URL for the provider's OpenAI-compatible API surface. */
  baseUrl: string;
}

/**
 * The single, authoritative list of supported providers and their base URLs.
 */
export const PROVIDERS: Readonly<Record<ProviderId, ProviderConfig>> = {
  google: {
    id: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  groq: {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
  },
} as const;

/**
 * Default base URLs for supported model providers, derived from PROVIDERS.
 */
export const PROVIDER_BASE_URLS: Readonly<Record<ProviderId, string>> = {
  google: PROVIDERS.google.baseUrl,
  groq: PROVIDERS.groq.baseUrl,
} as const;
