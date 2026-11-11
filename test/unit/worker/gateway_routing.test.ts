/**
 * @file gateway_routing.test.ts
 * Unit tests for gateway subdomain routing helpers and RouteDispatcherFn decoupling.
 */

import { describe, expect, it, vi } from "vitest";
import {
  applyCors,
  parseSubdomain,
  resolveHost,
  resolveHostRoute,
  type RouteDispatcherFn,
} from "../../../src/worker/gateway/subdomain";
import { handleAdminRequest } from "../../../src/worker/gateway/admin_handler";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import type { ExecutionContextLike } from "../../../src/worker/telemetry_emitter";

describe("Gateway Subdomain Routing & RouteDispatcher", () => {
  describe("resolveHost", () => {
    it("matches configured host environment variables", () => {
      const mockEnv = {
        API_HOST: "api.custom.io",
        CONSOLE_HOST: "console.custom.io",
        ADMIN_HOST: "admin.custom.io",
        APEX_HOST: "custom.io",
      } as unknown as WorkerEnv;

      expect(resolveHost("api.custom.io", mockEnv)).toBe("api");
      expect(resolveHost("console.custom.io:443", mockEnv)).toBe("console");
      expect(resolveHost("ADMIN.CUSTOM.IO", mockEnv)).toBe("admin");
      expect(resolveHost("custom.io:80", mockEnv)).toBe("apex");
      expect(resolveHost("unknown.custom.io", mockEnv)).toBe("unknown");
    });

    it("falls back to default hostnames when environment variables are unset", () => {
      expect(resolveHost("api.key-col.axe08.tech")).toBe("api");
      expect(resolveHost("api.keycollective.ai")).toBe("api");
      expect(resolveHost("api.localhost:8787")).toBe("api");
      expect(resolveHost("proxy.keycollective.internal")).toBe("api");

      expect(resolveHost("console.key-col.axe08.tech")).toBe("console");
      expect(resolveHost("console.localhost:8787")).toBe("console");

      expect(resolveHost("admin.key-col.axe08.tech")).toBe("admin");
      expect(resolveHost("admin.localhost:8787")).toBe("admin");

      expect(resolveHost("key-col.axe08.tech")).toBe("apex");
      expect(resolveHost("localhost:8787")).toBe("apex");

      expect(resolveHost("unrecognized.domain.com")).toBe("unknown");
      expect(resolveHost("")).toBe("unknown");
    });
  });

  describe("parseSubdomain", () => {
    it("extracts subdomain prefix from hostname", () => {
      expect(parseSubdomain("api.keycollective.ai")).toBe("api");
      expect(parseSubdomain("api.localhost:8787")).toBe("api");
      expect(parseSubdomain("api")).toBe("api");

      expect(parseSubdomain("console.keycollective.ai")).toBe("console");
      expect(parseSubdomain("console.localhost")).toBe("console");
      expect(parseSubdomain("console")).toBe("console");

      expect(parseSubdomain("admin.keycollective.ai")).toBe("admin");
      expect(parseSubdomain("admin.localhost")).toBe("admin");
      expect(parseSubdomain("admin")).toBe("admin");

      expect(parseSubdomain("keycollective.ai")).toBe("apex");
      expect(parseSubdomain("localhost")).toBe("apex");
      expect(parseSubdomain("")).toBe("apex");
    });
  });

  describe("resolveHostRoute", () => {
    it("returns correct routing flags for api subdomain", () => {
      const route = resolveHostRoute("api.example.com");
      expect(route).toEqual({
        host: "api.example.com",
        subdomain: "api",
        isApiGateway: true,
        isConsoleSpa: false,
        requiresAdminAuth: false,
      });
    });

    it("returns correct routing flags for console subdomain", () => {
      const route = resolveHostRoute("console.example.com");
      expect(route).toEqual({
        host: "console.example.com",
        subdomain: "console",
        isApiGateway: false,
        isConsoleSpa: true,
        requiresAdminAuth: false,
      });
    });

    it("returns correct routing flags for admin subdomain", () => {
      const route = resolveHostRoute("admin.example.com");
      expect(route).toEqual({
        host: "admin.example.com",
        subdomain: "admin",
        isApiGateway: false,
        isConsoleSpa: false,
        requiresAdminAuth: true,
      });
    });

    it("returns correct routing flags for apex", () => {
      const route = resolveHostRoute("example.com");
      expect(route).toEqual({
        host: "example.com",
        subdomain: "apex",
        isApiGateway: false,
        isConsoleSpa: false,
        requiresAdminAuth: false,
      });
    });
  });

  describe("applyCors", () => {
    it("injects default CORS headers if absent", () => {
      const res = new Response("ok", { status: 200 });
      const withCors = applyCors(res);
      expect(withCors.headers.get("access-control-allow-origin")).toBe("*");
      expect(withCors.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
      expect(withCors.headers.get("access-control-max-age")).toBe("86400");
    });

    it("preserves existing CORS headers", () => {
      const res = new Response("ok", {
        status: 200,
        headers: {
          "access-control-allow-origin": "https://dashboard.keycollective.ai",
        },
      });
      const withCors = applyCors(res);
      expect(withCors.headers.get("access-control-allow-origin")).toBe("https://dashboard.keycollective.ai");
    });
  });

  describe("handleAdminRequest with RouteDispatcherFn", () => {
    const mockEnv = {} as unknown as WorkerEnv;
    const mockCtx: ExecutionContextLike = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };

    it("dispatches /v1/chat/completions and /api/keys using a standalone RouteDispatcherFn", async () => {
      const dispatcherFn: RouteDispatcherFn = vi.fn(
        async (req: Request): Promise<Response> => {
          const url = new URL(req.url);
          return new Response(JSON.stringify({ routed: true, path: url.pathname }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
      );

      const chatReq = new Request("https://admin.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-4" }),
      });

      const chatRes = await handleAdminRequest(chatReq, mockEnv, dispatcherFn, { cors: false }, mockCtx);
      expect(chatRes.status).toBe(200);
      const chatBody = (await chatRes.json()) as { routed: boolean; path: string };
      expect(chatBody).toEqual({ routed: true, path: "/v1/chat/completions" });
      expect(dispatcherFn).toHaveBeenCalledTimes(1);

      const keysReq = new Request("https://admin.keycollective.ai/api/keys", {
        method: "GET",
      });

      const keysRes = await handleAdminRequest(keysReq, mockEnv, dispatcherFn, { cors: false }, mockCtx);
      expect(keysRes.status).toBe(200);
      const keysBody = (await keysRes.json()) as { routed: boolean; path: string };
      expect(keysBody).toEqual({ routed: true, path: "/api/keys" });
      expect(dispatcherFn).toHaveBeenCalledTimes(2);
    });

    it("dispatches using an object implementing { handle: RouteDispatcherFn }", async () => {
      const handleMock: RouteDispatcherFn = vi.fn(
        async (req: Request): Promise<Response> => {
          const url = new URL(req.url);
          return new Response(JSON.stringify({ objectDispatched: true, path: url.pathname }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
      );

      const routerHandlerObj = { handle: handleMock };

      const chatReq = new Request("https://admin.keycollective.ai/v1/chat/completions", {
        method: "POST",
      });
      const chatRes = await handleAdminRequest(chatReq, mockEnv, routerHandlerObj, { cors: false }, mockCtx);
      expect(chatRes.status).toBe(200);
      const chatBody = (await chatRes.json()) as { objectDispatched: boolean; path: string };
      expect(chatBody).toEqual({ objectDispatched: true, path: "/v1/chat/completions" });
      expect(handleMock).toHaveBeenCalledTimes(1);

      const openApiReq = new Request("https://admin.keycollective.ai/openapi.json", {
        method: "GET",
      });
      const openApiRes = await handleAdminRequest(openApiReq, mockEnv, routerHandlerObj, { cors: false }, mockCtx);
      expect(openApiRes.status).toBe(200);
      const openApiBody = (await openApiRes.json()) as { objectDispatched: boolean; path: string };
      expect(openApiBody).toEqual({ objectDispatched: true, path: "/openapi.json" });
      expect(handleMock).toHaveBeenCalledTimes(2);
    });
  });
});
