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
 * every fetch. The console authenticates with the HttpOnly `kc_session`
 * cookie (`credentials: "same-origin"`); mutations also carry the session's
 * CSRF token, which `GET /api/session` hands out (WP-3.4). No bearer token
 * is ever sent from the console.
 */
export interface AuthTransport {
  getHeaders(method: string): Record<string, string>;
}

let csrfToken: string | null = null;

/** Stores the CSRF token from `GET /api/session` (null on sign-out). */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const sessionAuthTransport: AuthTransport = {
  getHeaders(method: string): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (MUTATIONS.has(method.toUpperCase()) && csrfToken) {
      headers['x-kc-csrf'] = csrfToken;
    }
    return headers;
  },
};

export async function request<T>(
  schema: ZodType<T>,
  path: string,
  init?: RequestInit,
  transport: AuthTransport = sessionAuthTransport
): Promise<T> {
  const headers = {
    ...transport.getHeaders(init?.method ?? 'GET'),
    ...(init?.headers as Record<string, string> | undefined),
  };

  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });

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
