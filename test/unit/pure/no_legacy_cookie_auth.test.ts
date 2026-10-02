/**
 * @file no_legacy_cookie_auth.test.ts
 * WP-7.2 guard (T-7.2.3): verifies legacy kc_auth_token cookie fallback has been archived
 * and no reference to kc_auth_token remains in src/.
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

describe("WP-7.2 T-7.2.3 — Legacy cookie-based auth token fallback archived", () => {
  it("archived bearer_auth.ts and legacy_cookie_auth.ts exist under archives/", () => {
    expect(fs.existsSync(path.join(ROOT, "archives/src/worker/router/dashboard/bearer_auth.ts"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "archives/src/worker/router/dashboard/legacy_cookie_auth.ts"))).toBe(true);
  });

  it("no file in src/ references kc_auth_token", () => {
    const files = collectTsFiles(path.join(ROOT, "src"));
    const offenders: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes("kc_auth_token")) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
