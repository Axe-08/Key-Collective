import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ALL_MODEL_DEFINITIONS } from "../../../src/router/registry/catalog";
import { ModelRegistry } from "../../../src/router/registry/registry";
import { cuWeight } from "../../../src/router/registry/helpers";
import { sortCandidates } from "../../../src/router/capability/sorter";
import type { ModelDef } from "../../../src/types/models";

// T-F.3.3 (RA-09): Credit Units are the only price unit; cheapest = lowest CU weight.

function model(id: string, cuBase: bigint, cuInPer1k: bigint, cuOutPer1k: bigint, aliases: string[] = []): ModelDef {
  return {
    id,
    provider: "google",
    logicalAliases: aliases,
    contextWindow: 1_000_000,
    maxOutputTokens: 8192,
    cuBase,
    cuInPer1k,
    cuCachedPer1k: 0n,
    cuOutPer1k,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    isActive: true,
  };
}

// Listed in reverse cost order so insertion order cannot satisfy the assertions.
const pro = model("cu-pro", 50n, 5n, 20n, ["shared"]);
const flash = model("cu-flash", 10n, 1n, 4n, ["shared"]);
const lite = model("cu-lite", 5n, 1n, 2n, ["shared"]);

const MICRO_PATTERN = /microdollar|micro_cu|CostPerMTokMicro|µ\$/i;

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectSources(full));
    else if (/\.(ts|svelte|js|mjs)$/.test(e.name)) out.push(full);
  }
  return out;
}

describe("T-F.3.3 cheapest model by Credit Units", () => {
  it("cuWeight is cuBase + cuInPer1k + cuOutPer1k", () => {
    expect(cuWeight(flash)).toBe(15n);
    expect(cuWeight(lite)).toBe(8n);
    expect(cuWeight(pro)).toBe(75n);
  });

  it("getCheapestModel and findCandidates order by CU weight", () => {
    const registry = new ModelRegistry([pro, flash, lite]);
    expect(registry.getCheapestModel([pro, flash, lite])?.id).toBe("cu-lite");
    expect(registry.findCandidates().map((m) => m.id)).toEqual(["cu-lite", "cu-flash", "cu-pro"]);
  });

  it("an alias shared by several models resolves to the cheapest by CU", () => {
    const registry = new ModelRegistry([pro, flash, lite]);
    expect(registry.resolveAlias("shared")).toBe("cu-lite");
  });

  it("the cost-asc capability sort orders by CU weight", () => {
    expect(sortCandidates([pro, flash, lite], "cost-asc").map((m) => m.id)).toEqual([
      "cu-lite",
      "cu-flash",
      "cu-pro",
    ]);
  });

  it("no catalog model carries a microdollar price field", () => {
    for (const m of ALL_MODEL_DEFINITIONS) {
      for (const key of Object.keys(m)) {
        expect(key).not.toMatch(/Micro/);
      }
    }
  });

  it("src and ui/src contain no microdollar references", () => {
    const root = process.cwd();
    const hits: string[] = [];
    for (const file of [...collectSources(path.join(root, "src")), ...collectSources(path.join(root, "ui/src"))]) {
      const lines = fs.readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        if (MICRO_PATTERN.test(line)) hits.push(`${path.relative(root, file)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
