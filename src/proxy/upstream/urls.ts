/**
 * Key Collective v2 — Upstream URL Resolution
 *
 * Conforms to:
 * - LLD 3.2: Multi-provider URL normalization and path mapping.
 */

import { DEFAULT_PROVIDER_BASE_URLS, DEFAULT_PROVIDER_ENDPOINTS } from "./types";

/**
 * Resolves the full URL for an upstream request based on provider and endpoint.
 *
 * @param provider Upstream model provider
 * @param endpoint Relative endpoint or absolute URL
 * @param model Optional model ID for URL rewriting
 * @param baseUrls Optional base URL lookup overrides
 * @returns Fully qualified destination URL string
 */
export function buildProviderUrl(
  provider: string,
  endpoint?: string,
  model?: string,
  baseUrls?: Record<string, string>
): string {
  // If endpoint is already an absolute URL, return immediately
  if (endpoint && (endpoint.startsWith("http://") || endpoint.startsWith("https://"))) {
    return endpoint;
  }

  const normProvider = provider.toLowerCase();
  const rawBase =
    baseUrls?.[normProvider] ??
    DEFAULT_PROVIDER_BASE_URLS[normProvider] ??
    `https://api.${normProvider}.com/v1`;
  const base = rawBase.replace(/\/+$/, "");

  // Resolve target endpoint
  let resolvedEndpoint = endpoint;
  if (!resolvedEndpoint || resolvedEndpoint.trim().length === 0) {
    resolvedEndpoint = DEFAULT_PROVIDER_ENDPOINTS[normProvider] ?? "/chat/completions";
  }

  // Normalization for cross-provider compatibility
  if (normProvider === "anthropic" && resolvedEndpoint === "/chat/completions") {
    resolvedEndpoint = "/messages";
  } else if (
    (normProvider === "google" || normProvider === "gemini") &&
    resolvedEndpoint === "/chat/completions"
  ) {
    resolvedEndpoint = "/openai/chat/completions";
  } else if (
    (normProvider === "google" || normProvider === "gemini") &&
    resolvedEndpoint.includes(":generateContent") &&
    model &&
    !resolvedEndpoint.includes("/models/")
  ) {
    resolvedEndpoint = `/models/${model}${resolvedEndpoint}`;
  }

  const cleanPath = resolvedEndpoint.replace(/^\/+/, "");
  return `${base}/${cleanPath}`;
}
