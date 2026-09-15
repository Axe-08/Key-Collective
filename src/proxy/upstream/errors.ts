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
export function mapUpstreamHttpError(
  provider: string,
  status: number,
  responseText: string,
  headers?: Headers,
  modelId?: string,
  timeoutMs?: number
): DomainError {
  const truncatedMsg = truncateText(responseText, 500);

  // 1. Rate Limits (HTTP 429) -> RateLimitExceededError
  if (status === 429) {
    const retryAfter = parseRetryAfter(headers?.get("retry-after") ?? null);
    return new RateLimitExceededError(
      `Upstream provider '${provider}' rate limit exceeded (HTTP 429): ${truncatedMsg}`,
      {
        provider,
        retryAfterSeconds: retryAfter,
        details: {
          upstreamStatusCode: 429,
          upstreamResponseText: truncateText(responseText, 1000),
        },
      }
    );
  }

  // 2. Authentication / Authorization Failures (HTTP 401 / 403) -> InvalidKeyError
  if (status === 401 || status === 403) {
    return new InvalidKeyError(
      `Upstream provider '${provider}' rejected API key (HTTP ${status}): ${truncatedMsg}`,
      {
        provider,
        reason: truncatedMsg,
        details: {
          upstreamStatusCode: status,
          upstreamResponseText: truncateText(responseText, 1000),
        },
      }
    );
  }

  // 3. Timeouts (HTTP 408 / 504) -> ProviderTimeoutError
  if (status === 408 || status === 504) {
    return new ProviderTimeoutError(
      provider,
      `Upstream provider '${provider}' timed out (HTTP ${status}): ${truncatedMsg}`,
      {
        modelId,
        timeoutMs: timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
        details: {
          upstreamStatusCode: status,
          upstreamResponseText: truncateText(responseText, 1000),
        },
      }
    );
  }

  // 4. Server Errors (HTTP 500, 502, 503) -> ProviderRoutingError
  if (status >= 500) {
    return new ProviderRoutingError(
      provider,
      `Upstream provider '${provider}' service error (HTTP ${status}): ${truncatedMsg}`,
      {
        modelId,
        upstreamStatusCode: status,
        upstreamResponseText: truncateText(responseText, 1000),
        statusCode: status === 504 ? 504 : 502,
      }
    );
  }

  // 5. Client Errors (HTTP 400, 404, 422) -> ProviderRoutingError
  return new ProviderRoutingError(
    provider,
    `Upstream provider '${provider}' rejected request (HTTP ${status}): ${truncatedMsg}`,
    {
      modelId,
      upstreamStatusCode: status,
      upstreamResponseText: truncateText(responseText, 1000),
      statusCode: 502,
    }
  );
}
