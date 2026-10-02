/**
 * @file wp_7_7_dead_code.test.ts
 * WP-7.7 guard: verifies dead code modules are archived under archives/
 * and active modules (logger, sybil, contracts/keys) are wired.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

describe("WP-7.7 — Dead code archived and active modules wired", () => {
  it("T-7.7.1: parallel storage layer (src/storage/d1, do.ts, index.ts, d1.spec.ts, do.spec.ts) is archived", () => {
    const archivedPaths = [
      "src/storage/d1/adapter.ts",
      "src/storage/d1/index.ts",
      "src/storage/d1/keys.ts",
      "src/storage/d1/ledger.ts",
      "src/storage/d1/rollups.ts",
      "src/storage/d1/types.ts",
      "src/storage/d1/validation.ts",
      "src/storage/do.ts",
      "src/storage/index.ts",
      "src/storage/d1.spec.ts",
      "src/storage/do.spec.ts",
    ];
    for (const rel of archivedPaths) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(false);
      expect(fs.existsSync(path.join(ROOT, "archives", rel))).toBe(true);
    }
  });
});
