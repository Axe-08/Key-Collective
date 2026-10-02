/**
 * @file legacy_hosts_routes.ts
 * Archived in WP-7.1 (T-7.1.2 / T-7.1.3):
 * Legacy WP-2.7 host topology tests that verified Deprecation, Sunset, Link
 * headers and legacy_route_hit telemetry on retired aliases.
 */

// Archived from test/integration/hosts.test.ts lines 98-219:
export const ARCHIVED_LEGACY_HOSTS_TESTS = `
  describe("2. Legacy Routes & Deprecation Headers", () => {
    it("serves POST /v1/chat/completions on console.* with Deprecation, Sunset, Link headers", async () => {
      const res = await fetchWorker("https://console.test/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
      });

      // Equivalent to api.* (401 unauthenticated)
      expect(res.status).toBe(401);
      expect(res.headers.get("deprecation")).toBe("true");
      expect(res.headers.get("sunset")).toBeDefined();
      expect(res.headers.get("link")).toContain('<https://api.test/v1>; rel="successor-version"');
    });
    // ... retired in WP-7.1
  });
`;
