/**
 * @file legacy_cookie_auth.ts
 * Archived in WP-7.2 (T-7.2.3):
 * Legacy kc_auth_token cookie fallback from DashboardRouter, auth_routes,
 * admin_verifier, admin_handler, and console_handler.
 */

export const ARCHIVED_LEGACY_COOKIE_AUTH = `
    // From src/worker/router/dashboard/handler.ts:
    if (!session && !rawToken) {
      const cookieHeader = request.headers.get("cookie") || request.headers.get("Cookie");
      if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\\s*)kc_auth_token=([^;]+)/);
        if (match && match[1]) {
          rawToken = decodeURIComponent(match[1].trim());
        }
      }
    }
`;
