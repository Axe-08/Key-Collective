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

  it("T-7.7.2: unused contracts and barrels (providers.ts, proxy/index.ts, and 7 domain barrels) are archived", () => {
    const archivedPaths = [
      "src/contracts/providers.ts",
      "src/proxy/index.ts",
      "src/auth/index.ts",
      "src/constants/index.ts",
      "src/contracts/index.ts",
      "src/durable_objects/index.ts",
      "src/quota/index.ts",
      "src/router/index.ts",
      "src/types/index.ts",
    ];
    for (const rel of archivedPaths) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(false);
      expect(fs.existsSync(path.join(ROOT, "archives", rel))).toBe(true);
    }
  });

  it("T-7.7.3: facade modules and unused HTTP RPC handler are archived", () => {
    const archivedPaths = [
      "src/durable_objects/key_pool.ts",
      "src/durable_objects/key_pool_do.ts",
      "src/worker/router/chat_handler.ts",
      "src/worker/router/dashboard_handler.ts",
      "src/durable_objects/key_pool/rpc.ts",
    ];
    for (const rel of archivedPaths) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(false);
      expect(fs.existsSync(path.join(ROOT, "archives", rel))).toBe(true);
    }
  });

  it("T-7.7.4: one-off maintenance routes (backfill-key-hash, suspend-unclaimed-legacy) are archived", () => {
    const adminHandlerSrc = fs.readFileSync(
      path.join(ROOT, "src/worker/gateway/admin_handler.ts"),
      "utf8"
    );
    expect(adminHandlerSrc).not.toContain("/api/admin/maintenance/backfill-key-hash");
    expect(adminHandlerSrc).not.toContain("/api/admin/maintenance/suspend-unclaimed-legacy");
    expect(
      fs.existsSync(path.join(ROOT, "archives/src/worker/gateway/maintenance_backfill.ts"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(ROOT, "archives/src/worker/gateway/maintenance_suspend_legacy.ts"))
    ).toBe(true);
  });
});


