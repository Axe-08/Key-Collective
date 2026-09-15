/**
 * @file error_formatter.ts
 * Formats authentication and quota domain errors into compliant HTTP Responses.
 */

import { DEFAULT_RETRY_AFTER_SECONDS } from "../../constants/limits";
import { AuthenticationError } from "../../errors/auth_errors";
import { DomainError } from "../../errors/domain_error";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "../../errors/key_errors";

/**
 * Converts any DomainError or thrown exception into a standard JSON HTTP Response.
 * Automatically injects `WWW-Authenticate` for 401 and `Retry-After` for 429.
 */
export function formatAuthError(error: unknown): Response {
  if (error instanceof RateLimitExceededError) {
    return error.toResponse();
  }

  if (error instanceof QuotaExceededError) {
    return error.toResponse({
      "retry-after": String(DEFAULT_RETRY_AFTER_SECONDS),
    });
  }

  if (error instanceof AuthenticationError) {
    return error.toResponse();
  }

  if (error instanceof DomainError) {
    return error.toResponse();
  }

  const message =
    error instanceof Error ? error.message : "Internal authentication error";
  return new Response(
    JSON.stringify({
      error: message,
      code: "INTERNAL_AUTH_ERROR",
      statusCode: 500,
    }),
    {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }
  );
}
