import type { ZodType } from 'zod';

/**
 * Thrown by `request()` for any non-2xx response, and for a 2xx response
 * whose body does not match the expected schema.
 */
export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.message = message;
  }
}

/**
 * Pluggable auth transport: supplies the headers `request()` merges into
 * every fetch. Phase 1 uses the bearer token from localStorage
 * (`bearerAuthTransport`). WP-3.4 will introduce a transport that instead
 * relies on `credentials: "same-origin"` plus an `x-kc-csrf` header on
 * mutations — this interface keeps that swap a drop-in.
 */
export interface AuthTransport {
  getHeaders(): Record<string, string>;
}

export const bearerAuthTransport: AuthTransport = {
  getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (typeof window !== 'undefined') {
      const token = window.localStorage.getItem('kc_auth_token');
      if (token && token.trim().length > 0) {
        headers['Authorization'] = `Bearer ${token.trim()}`;
      }
    }
    return headers;
  },
};

export async function request<T>(
  schema: ZodType<T>,
  path: string,
  init?: RequestInit,
  transport: AuthTransport = bearerAuthTransport
): Promise<T> {
  const headers = {
    ...transport.getHeaders(),
    ...(init?.headers as Record<string, string> | undefined),
  };

  const res = await fetch(path, { ...init, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    throw new ApiError(
      res.status,
      (body as { code?: string }).code ?? 'unknown_error',
      (body as { error?: string; message?: string }).error ??
        (body as { error?: string; message?: string }).message ??
        `Request failed (HTTP ${res.status})`
    );
  }

  const data = await res.json();
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(
      res.status,
      'invalid_response',
      'Server returned data that does not match the expected schema.'
    );
  }
  return result.data;
}
