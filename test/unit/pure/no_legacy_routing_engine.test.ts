import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Legacy Routing Engine Retired (T-7.5.1)", () => {
  it("src/ contains zero occurrences of ROUTING_ENGINE, selfKeyRouted, or checkSelfKeyAvailable", () => {
    const srcDir = path.resolve(process.cwd(), "src");

    const collectTsFiles = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          results.push(...collectTsFiles(full));
        } else if (e.isFile() && e.name.endsWith(".ts")) {
          results.push(full);
        }
      }
      return results;
    };

    const offending: string[] = [];
    for (const file of collectTsFiles(srcDir)) {
      const content = fs.readFileSync(file, "utf-8");
      if (/ROUTING_ENGINE|selfKeyRouted|checkSelfKeyAvailable/.test(content)) {
        offending.push(path.relative(process.cwd(), file));
      }
    }

    expect(offending).toEqual([]);
    expect(fs.existsSync(path.resolve(process.cwd(), "src/router/leases/engine.ts"))).toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), "archives/src/router/leases/engine.ts"))).toBe(true);
  });
});

describe("KeyPoolDO Private Keys Only & Legacy getKey Archived (T-7.5.2)", () => {
  it("KeyPoolDO does not load other tenants' COMMUNITY keys or define legacy getKey(provider, tenantId)", () => {
    const doPath = path.resolve(process.cwd(), "src/durable_objects/key_pool/key_pool_do.ts");
    const content = fs.readFileSync(doPath, "utf-8");

    expect(content).not.toMatch(/k\.pool_type\s*=\s*'COMMUNITY'\s*AND\s*k\.community_routing_status/);
    expect(content).not.toMatch(/getKey\b.*provider.*tenantId/);
    expect(content).not.toMatch(/checkD1KeyStatus/);
    expect(fs.existsSync(path.resolve(process.cwd(), "archives/src/durable_objects/key_pool/legacy_get_key.ts"))).toBe(true);
  });
});

describe("wrangler.jsonc & package.json Clean of ROUTING_ENGINE (T-7.5.3)", () => {
  it("wrangler.jsonc and package.json contain zero occurrences of ROUTING_ENGINE or test:workers:legacy", () => {
    const wrangler = fs.readFileSync(path.resolve(process.cwd(), "wrangler.jsonc"), "utf-8");
    const pkg = fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8");

    expect(wrangler).not.toMatch(/ROUTING_ENGINE/);
    expect(pkg).not.toMatch(/ROUTING_ENGINE|test:workers:legacy/);
  });
});

describe("Test Suite Clean of ROUTING_ENGINE (T-7.5.4)", () => {
  it("test/ and tests/ contain zero occurrences of ROUTING_ENGINE", () => {
    const selfPath = path.resolve(process.cwd(), "test/unit/pure/no_legacy_routing_engine.test.ts");
    const collectFiles = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          results.push(...collectFiles(full));
        } else if (e.isFile() && e.name.endsWith(".ts") && full !== selfPath) {
          results.push(full);
        }
      }
      return results;
    };

    const offending: string[] = [];
    for (const file of [
      ...collectFiles(path.resolve(process.cwd(), "test")),
      ...collectFiles(path.resolve(process.cwd(), "tests")),
    ]) {
      const content = fs.readFileSync(file, "utf-8");
      if (/ROUTING_ENGINE/.test(content)) {
        offending.push(path.relative(process.cwd(), file));
      }
    }

    expect(offending).toEqual([]);
  });
});

