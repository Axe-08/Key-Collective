/**
 * Key Collective v2 — Upstream Error Mapping
 *
 * Conforms to:
 * - LLD 3.2: Maps upstream HTTP status codes and payloads to DomainError instances.
 * - GEMINI.md Constitution: No Plaintext Keys leaked in errors, strict typing.
 */

import {
  DomainError,
  RateLimitExceededError,
  InvalidKeyError,
  ProviderRoutingError,
  ProviderTimeoutError,
} from "../../errors";
import { DEFAULT_UPSTREAM_TIMEOUT_MS } from "./types";
import { parseRetryAfter } from "./headers";

/**
 * Safely truncates response text for error reporting without ballooning memory.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + "... [truncated]";
}

/**
 * Maps upstream HTTP error status codes and response bodies to standard Key Collective domain errors.
 * These errors trigger fallback escalation in CascadeRouter.
 *
 * @param provider Provider identifier
 * @param status HTTP response status code
 * @param responseText Error response body text
 * @param headers Upstream response headers
 * @param modelId Target model ID
 * @param timeoutMs Request timeout threshold
 * @returns Mapped DomainError instance
 */
import { classifyUpstreamResponse } from "./classify";

export function mapUpstreamHttpError(
  provider: string,
  status: number,
  responseText: string,
  headers?: Headers,
  modelId?: string,
  timeoutMs?: number
): DomainError {
  // Upstream response body is retained only on the internal `upstreamBody`
  // property for server-side logging; it must never appear in the public
  // error `message` (which flows to client responses via formatRouterError).
  const upstreamBody = truncateText(responseText, 1000);
  const upstreamHeaders: Record<string, string> = {};
  if (headers) {
    for (const [k, v] of headers.entries()) {
      upstreamHeaders[k.toLowerCase()] = v;
    }
  }
  const classification = classifyUpstreamResponse({
    status,
    headers: upstreamHeaders,
    body: responseText,
    timedOut: status === 408 || status === 504,
  });

  // 1. Rate Limits (HTTP 429) -> RateLimitExceededError
  if (status === 429) {
    const retryAfter = parseRetryAfter(headers?.get("retry-after") ?? null);
    return new RateLimitExceededError("Upstream rate limit", {
      provider,
      retryAfterSeconds: classification.retryAfterSeconds ?? retryAfter,
      details: {
        upstreamStatusCode: 429,
        upstreamBody,
        upstreamHeaders,
        classification,
      },
    });
  }

  // 2. Authentication / Authorization Failures (HTTP 401 / 403) -> InvalidKeyError
  if (status === 401 || status === 403) {
    return new InvalidKeyError("Upstream authentication failed", {
      provider,
      reason: "Upstream authentication failed",
      details: {
        upstreamStatusCode: status,
        upstreamBody,
        upstreamHeaders,
        classification,
      },
    });
  }

  // 3. Timeouts (HTTP 408 / 504) -> ProviderTimeoutError
  if (status === 408 || status === 504) {
    return new ProviderTimeoutError(provider, "Upstream timeout", {
      modelId,
      timeoutMs: timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
      details: {
        upstreamStatusCode: status,
        upstreamBody,
        upstreamHeaders,
        classification,
      },
    });
  }

  // 4. Server Errors (HTTP 500, 502, 503) -> ProviderRoutingError
  if (status >= 500) {
    return new ProviderRoutingError(provider, "Upstream unavailable", {
      modelId,
      upstreamStatusCode: status,
      details: {
        upstreamBody,
        upstreamHeaders,
        classification,
      },
      statusCode: status === 504 ? 504 : 502,
    });
  }

  // 5. Client Errors (HTTP 400 -> statusCode 400 without fallback; 404, 422 -> 502)
  return new ProviderRoutingError(provider, "Upstream unavailable", {
    modelId,
    upstreamStatusCode: status,
    details: {
      upstreamBody,
      upstreamHeaders,
      classification,
    },
    statusCode: status === 400 ? 400 : 502,
  });
}

