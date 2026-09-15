/**
 * Key Collective v2 — Upstream Header Rewriting & Parsing
 *
 * Conforms to:
 * - RFC 7230 Section 6.1 (Hop-by-hop stripping).
 * - GEMINI.md Constitution: No Plaintext Keys leaked, strict TypeScript.
 */

import { HOP_BY_HOP_HEADERS, CLIENT_AUTH_HEADERS } from "./types";

/**
 * Parses HTTP Retry-After header value into integer seconds.
 * Supports decimal seconds, integer seconds, and RFC 1123 HTTP dates.
 */
export function parseRetryAfter(headerValue: string | null): number {
  if (!headerValue || headerValue.trim().length === 0) {
    return 60;
  }
  const trimmed = headerValue.trim();

  // Check for integer or float seconds
  const numericSeconds = parseFloat(trimmed);
  if (!isNaN(numericSeconds) && numericSeconds >= 0) {
    return Math.ceil(numericSeconds);
  }

  // Check for HTTP date format
  const parsedDateMs = Date.parse(trimmed);
  if (!isNaN(parsedDateMs)) {
    const diffSec = Math.ceil((parsedDateMs - Date.now()) / 1000);
    return Math.max(1, diffSec);
  }

  return 60;
}

/**
 * Rewrites outgoing HTTP headers for an upstream provider.
 * Strips client authentication, hop-by-hop, and edge headers, and injects
 * the provider-specific credentials and content negotiation headers.
 *
 * @param provider Target model provider
 * @param incomingHeaders Raw client headers to filter and rewrite
 * @param apiKey Plaintext API key to inject
 * @param options Streaming and provider version options
 * @returns Clean, rewritten Headers object ready for upstream fetch
 */
export function rewriteHeaders(
  provider: string,
  incomingHeaders?: HeadersInit | Record<string, string>,
  apiKey?: string,
  options: {
    stream?: boolean;
    anthropicVersion?: string;
  } = {}
): Headers {
  const result = new Headers();

  // 1. Filter and copy incoming headers
  if (incomingHeaders) {
    const entries: [string, string][] =
      incomingHeaders instanceof Headers
        ? Array.from(incomingHeaders.entries())
        : Array.isArray(incomingHeaders)
        ? (incomingHeaders as [string, string][])
        : Object.entries(incomingHeaders);

    for (const [rawKey, value] of entries) {
      const lower = rawKey.toLowerCase();

      // Strip hop-by-hop headers
      if (HOP_BY_HOP_HEADERS.includes(lower)) {
        continue;
      }
      // Strip client-side authentication and routing headers
      if (CLIENT_AUTH_HEADERS.includes(lower)) {
        continue;
      }
      // Strip internal Cloudflare edge routing headers
      if (lower.startsWith("cf-") || lower.startsWith("x-forwarded-")) {
        continue;
      }

      result.set(rawKey, value);
    }
  }

  // 2. Enforce Content-Type if missing
  if (!result.has("content-type")) {
    result.set("content-type", "application/json");
  }

  // 3. Enforce Accept header
  if (options.stream) {
    result.set("accept", "text/event-stream");
  } else if (!result.has("accept")) {
    result.set("accept", "application/json");
  }

  // 4. Inject provider-specific authentication headers
  if (apiKey && apiKey.trim().length > 0) {
    const normProvider = provider.toLowerCase();

    if (normProvider === "anthropic") {
      result.set("x-api-key", apiKey);
      if (!result.has("anthropic-version")) {
        result.set("anthropic-version", options.anthropicVersion ?? "2023-06-01");
      }
    } else if (normProvider === "google" || normProvider === "gemini") {
      result.set("x-goog-api-key", apiKey);
      result.set("authorization", `Bearer ${apiKey}`);
    } else {
      // Standard OpenAI-compatible providers (OpenAI, Groq, DeepSeek, Mistral, Together, Cohere)
      result.set("authorization", `Bearer ${apiKey}`);
    }
  }

  return result;
}
