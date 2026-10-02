/**
 * @file bearer_auth.ts
 * Archived in WP-7.2 (T-7.2.1):
 * Legacy bearer token authentication branch from src/worker/router/dashboard/handler.ts.
 * Console /api/* now accepts only kc_session cookie authentication.
 */

export const ARCHIVED_DASHBOARD_BEARER_AUTH = `
    // 2. Legacy bearer token (never needs CSRF)
    let rawToken: string | undefined;
    const authHeader =
      request.headers.get("authorization") ||
      request.headers.get("Authorization");

    if (!session && authHeader && authHeader.startsWith("Bearer ")) {
      rawToken = authHeader.substring(7).trim();
    }
`;
