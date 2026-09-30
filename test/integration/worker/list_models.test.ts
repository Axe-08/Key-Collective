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
    const body = (await response.json()) as { data: Array<{ owned_by: string }> };

    expect(body.data.length).toBeGreaterThan(0);

    for (const model of body.data) {
      expect(["google", "groq"]).toContain(model.owned_by);
      expect(DISALLOWED_PROVIDERS).not.toContain(model.owned_by);
    }
  });
});
