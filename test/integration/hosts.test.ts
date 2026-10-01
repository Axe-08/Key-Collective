/**
 * @file hosts.test.ts
 * Integration tests for WP-2.7 Host Topology:
 * - Route matrix on api.*
 * - Legacy route handling with Deprecation, Sunset, Link headers and telemetry
 * - Apex redirects (301 for GET/HEAD, 308 for other methods)
 * - CORS isolation (api.* returns CORS headers, console.* and admin.* do not)
 */

import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { MainWorker } from "../../src/worker/index";
import type { WorkerEnv } from "../../src/worker/auth/index";

describe("WP-2.7 Host Topology Integration Tests", () => {
  const worker = new MainWorker();
  const workerEnv = env as unknown as WorkerEnv;

  const fetchWorker = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    return worker.fetch(req, workerEnv);
  };

  describe("1. Route Matrix on api.*", () => {
    it("GET /v1/health returns 200 healthy", async () => {
      const res = await fetchWorker("https://api.test/v1/health", { method: "GET" });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: string };
      expect(["ok", "healthy"]).toContain(data.status);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("GET /v1/openapi.json returns 200", async () => {
      const res = await fetchWorker("https://api.test/v1/openapi.json", { method: "GET" });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { openapi: string };
      expect(data.openapi).toBeDefined();
    });

    it("GET / returns 200 ready message", async () => {
      const res = await fetchWorker("https://api.test/", { method: "GET" });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Key Collective v2 Edge Proxy Ready");
    });

    it("POST /v1/chat/completions rejects unauthenticated request with 401", async () => {
      const res = await fetchWorker("https://api.test/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("GET /v1/models returns 200 model list", async () => {
      const res = await fetchWorker("https://api.test/v1/models", { method: "GET" });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { object: string; data: unknown[] };
      expect(data.object).toBe("list");
      expect(Array.isArray(data.data)).toBe(true);
    });

    it("POST /v1/demo/token returns 200 with ephemeral token", async () => {
      const res = await fetchWorker("https://api.test/v1/demo/token", { method: "POST" });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { token: string };
      expect(data.token).toBeDefined();
    });

    it("GET /api/keys returns 404 on api.*", async () => {
      const res = await fetchWorker("https://api.test/api/keys", { method: "GET" });
      expect(res.status).toBe(404);
    });

    it("GET /v1/keys returns 404 on api.*", async () => {
      const res = await fetchWorker("https://api.test/v1/keys", { method: "GET" });
      expect(res.status).toBe(404);
    });

    it("POST /v1/keys returns 404 on api.*", async () => {
      const res = await fetchWorker("https://api.test/v1/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for unrouted paths on api.*", async () => {
      const res = await fetchWorker("https://api.test/unrouted-test-path", { method: "GET" });
      expect(res.status).toBe(404);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });
  });

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

    it("serves GET /v1/health on console.* with 200 and legacy headers", async () => {
      const res = await fetchWorker("https://console.test/v1/health", { method: "GET" });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: string };
      expect(["ok", "healthy"]).toContain(data.status);
      expect(res.headers.get("deprecation")).toBe("true");
      expect(res.headers.get("sunset")).toBeDefined();
      expect(res.headers.get("link")).toContain('<https://api.test/v1>; rel="successor-version"');
    });

    it("serves POST /v1/chat/completions on apex with legacy headers", async () => {
      const res = await fetchWorker("https://apex.test/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("deprecation")).toBe("true");
      expect(res.headers.get("sunset")).toBeDefined();
      expect(res.headers.get("link")).toContain('<https://api.test/v1>; rel="successor-version"');
    });

    it("serves alias POST /chat/completions on api.* with legacy headers", async () => {
      const res = await fetchWorker("https://api.test/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("deprecation")).toBe("true");
      expect(res.headers.get("sunset")).toBeDefined();
      expect(res.headers.get("link")).toContain('<https://api.test/v1>; rel="successor-version"');
    });

    it("serves alias POST /v1/route on api.* with legacy headers", async () => {
      const res = await fetchWorker("https://api.test/v1/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("deprecation")).toBe("true");
      expect(res.headers.get("sunset")).toBeDefined();
      expect(res.headers.get("link")).toContain('<https://api.test/v1>; rel="successor-version"');
    });

    it("serves alias POST / on api.* with legacy headers", async () => {
      const res = await fetchWorker("https://api.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("deprecation")).toBe("true");
      expect(res.headers.get("sunset")).toBeDefined();
      expect(res.headers.get("link")).toContain('<https://api.test/v1>; rel="successor-version"');
    });

    it("serves alias GET /models on api.* with legacy headers", async () => {
      const res = await fetchWorker("https://api.test/models", { method: "GET" });
      expect(res.status).toBe(200);
      expect(res.headers.get("deprecation")).toBe("true");
      expect(res.headers.get("sunset")).toBeDefined();
      expect(res.headers.get("link")).toContain('<https://api.test/v1>; rel="successor-version"');
    });

    it("serves alias POST /demo/token with legacy headers", async () => {
      const res = await fetchWorker("https://api.test/demo/token", { method: "POST" });
      expect(res.status).toBe(200);
      expect(res.headers.get("deprecation")).toBe("true");
      expect(res.headers.get("sunset")).toBeDefined();
      expect(res.headers.get("link")).toContain('<https://api.test/v1>; rel="successor-version"');
    });

    it("serves alias POST /api/demo/token on api.* with legacy headers", async () => {
      const res = await fetchWorker("https://api.test/api/demo/token", { method: "POST" });
      expect(res.status).toBe(200);
      expect(res.headers.get("deprecation")).toBe("true");
      expect(res.headers.get("sunset")).toBeDefined();
      expect(res.headers.get("link")).toContain('<https://api.test/v1>; rel="successor-version"');
    });

    it("emits legacy_route_hit telemetry on legacy route access", async () => {
      const mockTelemetry = {
        writeDataPoint: vi.fn(),
      };
      const customEnv: WorkerEnv = {
        ...workerEnv,
        TELEMETRY: mockTelemetry as unknown as AnalyticsEngineDataset,
      };

      const customWorker = new MainWorker();
      const req = new Request("https://api.test/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
      });

      const res = await customWorker.fetch(req, customEnv);
      expect(res.status).toBe(401);
      expect(mockTelemetry.writeDataPoint).toHaveBeenCalledWith(
        expect.objectContaining({
          blobs: expect.arrayContaining(["legacy_route_hit", "POST /chat/completions"]),
        })
      );
    });
  });

  describe("3. Apex Redirects (D-25)", () => {
    it("redirects apex GET / to console with 301", async () => {
      const res = await fetchWorker("https://apex.test/", {
        method: "GET",
      });
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://console.test/");
    });

    it("redirects apex GET /arbitrary-path to console with 301", async () => {
      const res = await fetchWorker("https://apex.test/dashboard/settings?tab=1", {
        method: "GET",
      });
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://console.test/dashboard/settings?tab=1");
    });

    it("redirects apex HEAD / to console with 301", async () => {
      const res = await fetchWorker("https://apex.test/", {
        method: "HEAD",
      });
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://console.test/");
    });

    it("redirects apex POST /anything-else to console with 308", async () => {
      const res = await fetchWorker("https://apex.test/anything-else", {
        method: "POST",
      });
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe("https://console.test/anything-else");
    });

    it("redirects apex PUT /random to console with 308", async () => {
      const res = await fetchWorker("https://apex.test/random", {
        method: "PUT",
      });
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe("https://console.test/random");
    });
  });

  describe("4. CORS Isolation", () => {
    it("returns CORS headers on api.* OPTIONS preflight", async () => {
      const res = await fetchWorker("https://api.test/v1/chat/completions", {
        method: "OPTIONS",
        headers: {
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
      expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
    });

    it("returns NO CORS headers on console.* OPTIONS preflight", async () => {
      const res = await fetchWorker("https://console.test/v1/chat/completions", {
        method: "OPTIONS",
        headers: {
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("returns NO CORS headers on admin.* OPTIONS preflight", async () => {
      const res = await fetchWorker("https://admin.test/v1/chat/completions", {
        method: "OPTIONS",
        headers: {
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("returns NO CORS headers on apex OPTIONS preflight", async () => {
      const res = await fetchWorker("https://apex.test/", {
        method: "OPTIONS",
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});
