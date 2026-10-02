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
import { isQuotaJailError } from "../../errors/routing_errors";
import { sanitize } from "../error_normalizer";
import { Logger } from "../../utils/logger";

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

export interface FormatRouterErrorOptions {
  requestId?: string;
  traceId?: string;
  tenantId?: string;
}

/**
 * Formats any caught error or exception into a standardized HTTP Response.
 * The client body is always { error: { message, type, code } } plus x-kc-request-id.
 * details is never serialised to clients. Full details go to the server logger keyed by trace id.
 * Injects WWW-Authenticate on 401 and Retry-After on 429.
 */
export function formatRouterError(
  error: unknown,
  optionsOrRequestId?: string | FormatRouterErrorOptions
): Response {
  const options =
    typeof optionsOrRequestId === "string"
      ? { requestId: optionsOrRequestId }
      : optionsOrRequestId ?? {};

  const requestId = options.requestId ?? crypto.randomUUID();
  const traceId = options.traceId ?? requestId;
  const tenantId =
    options.tenantId ??
    (error instanceof DomainError && error.details?.tenantId
      ? String(error.details.tenantId)
      : "system");

  let statusCode = 500;
  let code = "INTERNAL_ROUTING_ERROR";
  let type = "internal_server_error";
  let rawMessage = "Internal edge routing error";
  let retryAfter: number | undefined;
  let isAuthError = false;

  if (isQuotaJailError(error)) {
    const logger = new Logger({ traceId, tenantId });
    logger.error(error.message, {
      name: error.name,
      code: error.code,
      statusCode: error.statusCode,
      details: error.details,
    });
    return error.toResponse({
      "x-kc-request-id": requestId,
      "retry-after": String(DEFAULT_RETRY_AFTER_SECONDS),
    });
  }

  if (error instanceof RateLimitExceededError) {
    statusCode = error.statusCode;
    code = error.code;
    type = "rate_limit_error";
    rawMessage = error.message;
    retryAfter = error.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
  } else if (error instanceof QuotaExceededError) {
    statusCode = error.statusCode;
    code = error.code;
    type = "rate_limit_error";
    rawMessage = error.message;
    retryAfter = DEFAULT_RETRY_AFTER_SECONDS;
  } else if (error instanceof AuthenticationError) {
    statusCode = error.statusCode;
    code = error.code;
    type = "authentication_error";
    rawMessage = error.message;
    isAuthError = true;
  } else if (error instanceof DomainError) {
    statusCode = error.statusCode;
    code = error.code;
    rawMessage = error.message;
    if (statusCode === 401) {
      type = "authentication_error";
      isAuthError = true;
    } else if (statusCode === 403) {
      type = "permission_error";
    } else if (statusCode === 404) {
      type = "not_found_error";
    } else if (statusCode === 429) {
      type = "rate_limit_error";
      retryAfter = DEFAULT_RETRY_AFTER_SECONDS;
    } else if (statusCode === 503) {
      type = "service_unavailable";
    } else if (statusCode >= 400 && statusCode < 500) {
      type = "invalid_request_error";
    } else {
      type = "internal_server_error";
    }
  } else if (error instanceof Error) {
    rawMessage = error.message;
  } else if (typeof error === "string") {
    rawMessage = error;
  }

  // Full details go to the server logger keyed by trace id
  const logger = new Logger({ traceId, tenantId });
  logger.error(rawMessage, {
    name: error instanceof Error ? error.name : "UnknownError",
    code,
    statusCode,
    details: error instanceof DomainError ? error.details : undefined,
    stack: error instanceof Error ? error.stack : undefined,
  });

  // Only domain errors carry messages written for clients; anything else (runtime, library or
  // programming errors) may contain internals, so the client gets a fixed message.
  const message = error instanceof DomainError ? sanitize(rawMessage) : "Internal error";

  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "x-kc-request-id": requestId,
  });

  if (retryAfter !== undefined) {
    headers.set("retry-after", String(retryAfter));
  }

  if (isAuthError) {
    headers.set("www-authenticate", "Bearer");
  }

  return new Response(
    JSON.stringify({
      error: {
        message,
        type,
        code,
      },
    }),
    {
      status: statusCode,
      headers,
    }
  );
}
