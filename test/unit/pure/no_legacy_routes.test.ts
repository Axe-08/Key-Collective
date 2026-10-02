/**
 * @file no_legacy_routes.test.ts
 * WP-7.1 guard: verifies src/worker/api/legacy_routes.ts has been archived
 * and no legacy route table, LEGACY_SUNSET env var, or legacy_route_hit
 * telemetry event remains in active source or configuration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".spec.ts")) {
      results.push(full);
    }
  }
  return results;
}

describe("WP-7.1 — Legacy API routes archived and retired", () => {
  it("src/worker/api/legacy_routes.ts is moved to archives/src/worker/api/legacy_routes.ts", () => {
    expect(fs.existsSync(path.join(ROOT, "src/worker/api/legacy_routes.ts"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "archives/src/worker/api/legacy_routes.ts"))).toBe(true);
  });

  it("no file in src/ references legacy_routes, LEGACY_SUNSET, or legacy_route_hit", () => {
    const files = collectTsFiles(path.join(ROOT, "src"));
    const offenders: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      if (/legacy_routes|LEGACY_SUNSET|legacy_route_hit/.test(content)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("wrangler.jsonc contains no LEGACY_SUNSET variable", () => {
    const wrangler = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf-8");
    expect(wrangler).not.toContain("LEGACY_SUNSET");
  });
});
