/**
 * Key Collective v2/v4 — Router Subsystem Errors & Error Formatting
 */

import { DEFAULT_RETRY_AFTER_SECONDS } from "../../constants/limits";
import { AuthenticationError } from "../../errors/auth_errors";
import { DomainError, DomainErrorOptions } from "../../errors/domain_error";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "../../errors/key_errors";
import { sanitizeErrorMessage } from "../error_normalizer";

/**
 * Concrete domain error for edge routing failures.
 */
export class RouterError extends DomainError {
  public override readonly name = "RouterError";

  constructor(message: string, options: DomainErrorOptions = {}) {
    super(message, options);
    Object.setPrototypeOf(this, RouterError.prototype);
  }
}

/**
 * Formats any caught error or exception into a standardized HTTP Response.
 * Injects WWW-Authenticate on 401 and Retry-After on 429.
 */
export function formatRouterError(error: unknown): Response {
  if (error instanceof RateLimitExceededError) {
    const retryAfter = error.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
    const body = error.toJSON();
    body.error = sanitizeErrorMessage(body.error);
    return new Response(JSON.stringify(body), {
      status: error.statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(retryAfter),
      },
    });
  }

  if (error instanceof QuotaExceededError) {
    const body = error.toJSON();
    body.error = sanitizeErrorMessage(body.error);
    return new Response(JSON.stringify(body), {
      status: error.statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(DEFAULT_RETRY_AFTER_SECONDS),
      },
    });
  }

  if (error instanceof AuthenticationError) {
    const body = error.toJSON();
    body.error = sanitizeErrorMessage(body.error);
    return new Response(JSON.stringify(body), {
      status: error.statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "www-authenticate": "Bearer",
      },
    });
  }

  if (error instanceof DomainError) {
    const body = error.toJSON();
    body.error = sanitizeErrorMessage(body.error);
    return new Response(JSON.stringify(body), {
      status: error.statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }

  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Internal edge routing error";
  const message = sanitizeErrorMessage(rawMessage);
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: "internal_server_error",
        code: "INTERNAL_ROUTING_ERROR",
        statusCode: 500,
      },
    }),
    {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }
  );
}
