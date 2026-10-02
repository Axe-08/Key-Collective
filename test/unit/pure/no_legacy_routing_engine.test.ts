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
