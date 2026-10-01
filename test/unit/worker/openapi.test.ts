import { describe, expect, it } from "vitest";
import { OPENAPI_SPEC } from "../../../src/worker/openapi_spec";
import { ModelRoutesHandler } from "../../../src/worker/router/model_routes";

describe("OpenAPI Specification (T-2.7.4)", () => {
  it("lists exactly one server: https://api.key-col.axe08.tech/v1", () => {
    expect(OPENAPI_SPEC.servers).toHaveLength(1);
    expect(OPENAPI_SPEC.servers[0].url).toBe("https://api.key-col.axe08.tech/v1");
    expect(OPENAPI_SPEC.servers[0].description).toBe("Canonical API Gateway");
  });

  it("formats all paths without the /v1 prefix as relative URLs under /v1", () => {
    const pathKeys = Object.keys(OPENAPI_SPEC.paths);
    expect(pathKeys.length).toBeGreaterThan(0);

    for (const path of pathKeys) {
      expect(path.startsWith("/v1")).toBe(false);
    }

    expect(OPENAPI_SPEC.paths).toHaveProperty("/chat/completions");
    expect(OPENAPI_SPEC.paths).toHaveProperty("/models");
    expect(OPENAPI_SPEC.paths).toHaveProperty("/models/{model_id}");
    expect(OPENAPI_SPEC.paths).toHaveProperty("/health");

    expect(OPENAPI_SPEC.paths).not.toHaveProperty("/v1/chat/completions");
    expect(OPENAPI_SPEC.paths).not.toHaveProperty("/v1/models");
    expect(OPENAPI_SPEC.paths).not.toHaveProperty("/v1/models/{id}");
  });

  it("serves the spec from ModelRoutesHandler with single server and relative paths", async () => {
    const handler = new ModelRoutesHandler();
    const response = handler.handleOpenApiSpec();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const spec = (await response.json()) as typeof OPENAPI_SPEC;
    expect(spec.servers).toHaveLength(1);
    expect(spec.servers[0].url).toBe("https://api.key-col.axe08.tech/v1");

    for (const path of Object.keys(spec.paths)) {
      expect(path.startsWith("/v1")).toBe(false);
    }
  });
});
