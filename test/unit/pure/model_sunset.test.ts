import { describe, it, expect } from "vitest";
import { ALL_MODEL_DEFINITIONS } from "../../../src/router/registry/catalog";
import { ModelRegistry } from "../../../src/router/registry/registry";
import { CascadeRouter } from "../../../src/router/cascade/router";
import { ModelRoutesHandler } from "../../../src/worker/router/model_routes";
import type { ModelDef } from "../../../src/types/models";

// T-F.3.2: a model whose deprecatedAt or sunsetAt has passed is neither routable nor listed.

const AFTER_SUNSET = Date.parse("2027-05-08T00:00:00.000Z");
const BEFORE_SUNSET = Date.parse("2026-10-03T00:00:00.000Z");

function registryAt(nowMs: number, models: readonly ModelDef[] = ALL_MODEL_DEFINITIONS): ModelRegistry {
  return new ModelRegistry({ models, now: () => nowMs });
}

async function listedIds(registry: ModelRegistry): Promise<string[]> {
  const res = new ModelRoutesHandler().handleListModels(new Request("https://api.test/v1/models"), registry);
  const body = (await res.json()) as { data: Array<{ id: string }> };
  return body.data.map((m) => m.id);
}

function autoCandidates(registry: ModelRegistry): string[] {
  return new CascadeRouter({ registry })
    .getCandidates({ modelAlias: "auto", messages: [{ role: "user", content: "hi" }], stream: false })
    .map((m) => m.id);
}

describe("T-F.3.2 sunset and deprecated models", () => {
  it("routes and lists gemini-3.1-flash-lite before its sunset date", async () => {
    const registry = registryAt(BEFORE_SUNSET);
    expect(registry.resolveModel("gemini-3.1-flash-lite")?.id).toBe("gemini-3.1-flash-lite");
    expect(autoCandidates(registry)).toContain("gemini-3.1-flash-lite");
    expect(await listedIds(registry)).toContain("gemini-3.1-flash-lite");
  });

  it("does not route or list gemini-3.1-flash-lite once its sunset date has passed", async () => {
    const registry = registryAt(AFTER_SUNSET);
    expect(registry.resolveModel("gemini-3.1-flash-lite")).toBeUndefined();
    expect(autoCandidates(registry)).not.toContain("gemini-3.1-flash-lite");
    expect(await listedIds(registry)).not.toContain("gemini-3.1-flash-lite");
    expect(await listedIds(registry)).toContain("gemini-3.5-flash-lite");
  });

  it("skips a model whose deprecatedAt has passed, including as an alias chain link", async () => {
    const models = ALL_MODEL_DEFINITIONS.map((m) =>
      m.id === "gemini-3.8-flash" ? { ...m, deprecatedAt: "2026-10-01T00:00:00.000Z" } : m
    );
    const registry = registryAt(BEFORE_SUNSET, models);
    expect(registry.resolveModel("gemini-3.8-flash")).toBeUndefined();
    expect(registry.resolveAlias("smart-fast")).toBe("openai/gpt-oss-120b");
    expect(await listedIds(registry)).not.toContain("gemini-3.8-flash");
  });

  it("defaults to the wall clock", () => {
    const models = ALL_MODEL_DEFINITIONS.map((m) =>
      m.id === "gemini-3.7-flash" ? { ...m, sunsetAt: new Date(Date.now() - 60_000).toISOString() } : m
    );
    expect(new ModelRegistry(models).resolveModel("gemini-3.7-flash")).toBeUndefined();
  });
});
