/**
 * Typed Errors for Edge Worker and Proxy Runtime.
 *
 * Provides typed errors with HTTP status codes for the edge worker to catch,
 * format, and return appropriate JSON responses without leaking internal details.
 */

export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string = 'Unauthorized', code: string = 'UNAUTHORIZED') {
    super(message);
    this.name = 'AuthError';
    this.statusCode = 401;
    this.code = code;
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

export class ForbiddenError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string = 'Forbidden', code: string = 'FORBIDDEN') {
    super(message);
    this.name = 'ForbiddenError';
    this.statusCode = 403;
    this.code = code;
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export class NotFoundError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string = 'Not Found', code: string = 'NOT_FOUND') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
    this.code = code;
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class BadRequestError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(message: string = 'Bad Request', code: string = 'BAD_REQUEST', details?: unknown) {
    super(message);
    this.name = 'BadRequestError';
    this.statusCode = 400;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, BadRequestError.prototype);
  }
}

export class ValidationError extends BadRequestError {
  constructor(message: string = 'Validation Failed', details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class RateLimitError extends Error {
  statusCode: number;
  code: string;
  retryAfterSeconds?: number;

  constructor(message: string = 'Rate limit exceeded', retryAfterSeconds?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.statusCode = 429;
    this.code = 'RATE_LIMIT_EXCEEDED';
    this.retryAfterSeconds = retryAfterSeconds;
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class QuotaExceededError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string = 'Quota exceeded', code: string = 'QUOTA_EXCEEDED') {
    super(message);
    this.name = 'QuotaExceededError';
    this.statusCode = 429;
    this.code = code;
    Object.setPrototypeOf(this, QuotaExceededError.prototype);
  }
}

export class CircuitBreakerError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string = 'Service temporarily unavailable due to open circuit breaker', code: string = 'CIRCUIT_OPEN') {
    super(message);
    this.name = 'CircuitBreakerError';
    this.statusCode = 503;
    this.code = code;
    Object.setPrototypeOf(this, CircuitBreakerError.prototype);
  }
}

export class KeyPoolExhaustedError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string = 'No available keys in pool', code: string = 'KEY_POOL_EXHAUSTED') {
    super(message);
    this.name = 'KeyPoolExhaustedError';
    this.statusCode = 503;
    this.code = code;
    Object.setPrototypeOf(this, KeyPoolExhaustedError.prototype);
  }
}

export class InternalError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string = 'Internal server error', code: string = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'InternalError';
    this.statusCode = 500;
    this.code = code;
    Object.setPrototypeOf(this, InternalError.prototype);
  }
}

/**
 * Type guard to check if an error object has an HTTP status code.
 */
export function hasStatusCode(error: unknown): error is { statusCode: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof (error as Record<string, unknown>).statusCode === 'number'
  );
}

/**
 * Format any error into a standardized JSON response format.
 */
export function formatError(error: unknown): { statusCode: number; body: { error: { message: string; code: string } } } {
  if (hasStatusCode(error) && error instanceof Error) {
    const code =
      'code' in error && typeof (error as Record<string, unknown>).code === 'string'
        ? ((error as Record<string, unknown>).code as string)
        : 'ERROR';

    return {
      statusCode: error.statusCode,
      body: {
        error: {
          message: error.message,
          code,
        },
      },
    };
  }

  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  return {
    statusCode: 500,
    body: {
      error: {
        message,
        code: 'INTERNAL_ERROR',
      },
    },
  };
}
