import { describe, it, expect } from "vitest";
import {
  ALL_MODEL_DEFINITIONS,
  DEFAULT_MODEL_DEFINITIONS,
  MODEL_ALIAS_CHAINS,
} from "../../../src/router/registry/catalog";
import { ModelRegistry } from "../../../src/router/registry/registry";
import { cuWeight } from "../../../src/router/registry/helpers";
import { CascadeRouter } from "../../../src/router/cascade/router";

// T-F.3.1 (RA-06): the catalog lists only models the providers offer (PHASEF_PLAN §2 live check).
// Limits come from ai.google.dev/gemini-api/docs/models/<id> and console.groq.com/docs/models (2026-10-03).

const GOOGLE = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro-preview",
];
const GROQ = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];
const REMOVED = [
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "qwen/qwen3.6-27b",
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
];

function byId(id: string) {
  const m = ALL_MODEL_DEFINITIONS.find((x) => x.id === id);
  if (!m) throw new Error(`missing ${id}`);
  return m;
}

function candidatesFor(alias: string): string[] {
  const router = new CascadeRouter({ registry: new ModelRegistry(ALL_MODEL_DEFINITIONS) });
  return router.getCandidates({ modelAlias: alias, messages: [{ role: "user", content: "hi" }], stream: false }).map((m) => m.id);
}

describe("T-F.3.1 model catalog", () => {
  it("contains exactly the verified Google and Groq models", () => {
    expect(ALL_MODEL_DEFINITIONS.map((m) => m.id).sort()).toEqual([...GOOGLE, ...GROQ].sort());
    expect(DEFAULT_MODEL_DEFINITIONS.map((m) => m.id).sort()).toEqual([...GOOGLE, ...GROQ].sort());
    for (const id of GOOGLE) expect(byId(id).provider).toBe("google");
    for (const id of GROQ) expect(byId(id).provider).toBe("groq");
  });

  it("drops retired and unavailable models", () => {
    const ids = new Set(ALL_MODEL_DEFINITIONS.map((m) => m.id));
    for (const id of REMOVED) expect(ids.has(id), id).toBe(false);
  });

  it("uses the published context windows and output limits", () => {
    for (const id of GOOGLE) {
      expect(byId(id).contextWindow, id).toBe(1_048_576);
      expect(byId(id).maxOutputTokens, id).toBe(65_536);
    }
    for (const id of ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]) {
      expect(byId(id).contextWindow, id).toBe(131_072);
      expect(byId(id).maxOutputTokens, id).toBe(65_536);
      expect(byId(id).supportsVision, id).toBe(false);
    }
    expect(byId("qwen/qwen3.8-27b").contextWindow).toBe(131_072);
    expect(byId("qwen/qwen3.8-27b").maxOutputTokens).toBe(16_384);
  });

  it("marks gemini-3.1-flash-lite for shutdown on 2027-05-07 and nothing else", () => {
    expect(byId("gemini-3.1-flash-lite").sunsetAt).toBe("2027-05-07T00:00:00.000Z");
    for (const m of ALL_MODEL_DEFINITIONS.filter((x) => x.id !== "gemini-3.1-flash-lite")) {
      expect(m.sunsetAt ?? null, m.id).toBeNull();
    }
  });

  it("uses the §2.2 CU weight classes", () => {
    expect(cuWeight(byId("gemini-3.5-flash-lite"))).toBe(8n); // Flash-Lite 5/1/0/2
    expect(cuWeight(byId("gemini-3.1-flash-lite"))).toBe(8n);
    expect(cuWeight(byId("gemini-3.8-flash"))).toBe(15n); // Flash 10/1/0/4
    expect(cuWeight(byId("gemini-3.1-pro-preview"))).toBe(75n); // Pro 50/5/1/20
    expect(cuWeight(byId("openai/gpt-oss-20b"))).toBe(7n); // Groq small 5/1/0/1
    expect(cuWeight(byId("openai/gpt-oss-120b"))).toBe(16n); // Groq large 10/2/0/4
  });

  it("defines the alias chains from the plan", () => {
    expect(MODEL_ALIAS_CHAINS).toEqual({
      "smart-fast": ["gemini-3.8-flash", "openai/gpt-oss-120b"],
      "coder-high": ["gemini-3.1-pro-preview", "openai/gpt-oss-120b"],
      "open-groq": ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
      fast: ["gemini-3.5-flash-lite", "openai/gpt-oss-20b"],
    });
  });

  it.each(Object.entries({
    "smart-fast": ["gemini-3.8-flash", "openai/gpt-oss-120b"],
    "coder-high": ["gemini-3.1-pro-preview", "openai/gpt-oss-120b"],
    "open-groq": ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
    fast: ["gemini-3.5-flash-lite", "openai/gpt-oss-20b"],
  }))("alias %s resolves to its chain in order", (alias, chain) => {
    expect(new ModelRegistry(ALL_MODEL_DEFINITIONS).resolveAlias(alias)).toBe(chain[0]);
    expect(candidatesFor(alias).slice(0, 2)).toEqual(chain);
  });

  it("auto starts with the cheapest model by CU and orders the rest by CU", () => {
    const ids = candidatesFor("auto");
    expect(ids[0]).toBe("openai/gpt-oss-20b");
    const weights = ids.map((id) => cuWeight(byId(id)));
    for (let i = 1; i < weights.length; i++) expect(weights[i - 1] <= weights[i]).toBe(true);
  });
});
