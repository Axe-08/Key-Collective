/**
 * Integration test: GET /v1/models must only list models from the
 * free-tier-callable providers (google, groq). No other provider's
 * models should ever be exposed through the catalog endpoint.
 */

import { describe, it, expect } from "vitest";
import { ModelRoutesHandler } from "../../../src/worker/router/model_routes";
import { ModelRegistry } from "../../../src/router/registry/registry";
import { ALL_MODEL_DEFINITIONS } from "../../../src/router/registry/catalog";

const DISALLOWED_PROVIDERS = [
  "openai",
  "anthropic",
  "deepseek",
  "cohere",
  "mistral",
  "together",
  "cerebras",
  "sambanova",
];

describe("GET /v1/models catalog restriction", () => {
  it("lists only google/groq models and excludes disallowed providers", async () => {
    const registry = new ModelRegistry([...ALL_MODEL_DEFINITIONS]);
    const handler = new ModelRoutesHandler();

    const request = new Request("https://example.com/v1/models");
    const response = handler.handleListModels(request, registry);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{
        id: string;
        owned_by: string;
        kc: {
          cu_base: number;
          cu_in_per_1k: number;
          cu_cached_per_1k: number;
          cu_out_per_1k: number;
        };
      }>;
    };

    expect(body.data.length).toBeGreaterThan(0);

    for (const model of body.data) {
      expect(["google", "groq"]).toContain(model.owned_by);
      expect(DISALLOWED_PROVIDERS).not.toContain(model.owned_by);

      expect(model.kc).toBeDefined();
      expect(typeof model.kc.cu_base).toBe("number");
      expect(typeof model.kc.cu_in_per_1k).toBe("number");
      expect(typeof model.kc.cu_cached_per_1k).toBe("number");
      expect(typeof model.kc.cu_out_per_1k).toBe("number");
      expect(Number.isFinite(model.kc.cu_base)).toBe(true);
      expect(Number.isFinite(model.kc.cu_in_per_1k)).toBe(true);
      expect(Number.isFinite(model.kc.cu_cached_per_1k)).toBe(true);
      expect(Number.isFinite(model.kc.cu_out_per_1k)).toBe(true);
      expect(model.kc.cu_base).toBeGreaterThanOrEqual(0);
      expect(model.kc.cu_in_per_1k).toBeGreaterThanOrEqual(0);
      expect(model.kc.cu_cached_per_1k).toBeGreaterThanOrEqual(0);
      expect(model.kc.cu_out_per_1k).toBeGreaterThanOrEqual(0);
    }
  });

  it("includes kc weight fields in GET /v1/models/:id response", async () => {
    const registry = new ModelRegistry([...ALL_MODEL_DEFINITIONS]);
    const handler = new ModelRoutesHandler();

    const request = new Request("https://example.com/v1/models/gemini-3.5-flash");
    const response = handler.handleGetModel(request, "gemini-3.5-flash", registry);

    expect(response.status).toBe(200);
    const model = (await response.json()) as {
      id: string;
      kc: {
        cu_base: number;
        cu_in_per_1k: number;
        cu_cached_per_1k: number;
        cu_out_per_1k: number;
      };
    };

    expect(model.kc).toBeDefined();
    expect(typeof model.kc.cu_base).toBe("number");
    expect(typeof model.kc.cu_in_per_1k).toBe("number");
    expect(typeof model.kc.cu_cached_per_1k).toBe("number");
    expect(typeof model.kc.cu_out_per_1k).toBe("number");
    expect(model.kc.cu_base).toBe(10);
    expect(model.kc.cu_in_per_1k).toBe(1);
    expect(model.kc.cu_cached_per_1k).toBe(0);
    expect(model.kc.cu_out_per_1k).toBe(4);
  });
});
