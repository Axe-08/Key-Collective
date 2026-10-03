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

  it("T-7.7.5: src/utils/logger.ts is wired into dashboard handler, coordinator DO, and key pool DO", () => {
    const consumers = [
      "src/worker/router/dashboard/handler.ts",
      "src/pool/coordinator_do.ts",
      "src/durable_objects/key_pool/key_pool_do.ts",
      "src/worker/router/dashboard/keys/post_key.ts",
      "src/worker/router/core/key_resolver.ts",
    ];
    for (const rel of consumers) {
      const content = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(content).toMatch(/from\s+["'][^"']*utils\/logger["']/);
    }
  });

  it("T-7.7.6: sybil engine is wired into src/auth/github/link_flow.ts and src/auth/sybil/index.ts is retained", () => {
    const linkFlow = fs.readFileSync(path.join(ROOT, "src/auth/github/link_flow.ts"), "utf8");
    expect(linkFlow).toContain("evaluateAntiSybil");
    expect(linkFlow).toContain("communityEligible");
    expect(fs.existsSync(path.join(ROOT, "src/auth/sybil/index.ts"))).toBe(true);
  });

  it("T-7.7.8: src/contracts/keys.ts is wired into key_pool_do.ts and get_keys.ts", () => {
    const keyPoolDo = fs.readFileSync(
      path.join(ROOT, "src/durable_objects/key_pool/key_pool_do.ts"),
      "utf8"
    );
    const getKeys = fs.readFileSync(
      path.join(ROOT, "src/worker/router/dashboard/keys/get_keys.ts"),
      "utf8"
    );
    expect(keyPoolDo).toMatch(/from\s+["'][^"']*contracts\/keys["']/);
    expect(getKeys).toMatch(/from\s+["'][^"']*contracts\/keys["']/);
  });

  it("T-7.7.9: zero microdollar, micro_cu, or µ$ leftovers in src/ and ui/src/", () => {
    const collectFiles = (dir: string): string[] => {
      const out: string[] = [];
      if (!fs.existsSync(dir)) return out;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...collectFiles(full));
        } else if (entry.isFile() && /\.(ts|tsx|svelte|js|mjs)$/.test(entry.name)) {
          out.push(full);
        }
      }
      return out;
    };

    const files = [
      ...collectFiles(path.join(ROOT, "src")),
      ...collectFiles(path.join(ROOT, "ui/src")),
    ];

    const forbidden = /microdollar|micro_cu|µ\$/i;
    const hits: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      if (forbidden.test(content)) {
        hits.push(path.relative(ROOT, file));
      }
    }

    expect(hits).toEqual([]);
  });

  it("T-7.7.7: scripts/reachability.mjs exists, passes, and is wired into package.json gate", async () => {
    const scriptPath = path.join(ROOT, "scripts/reachability.mjs");
    expect(fs.existsSync(scriptPath)).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.gate).toContain("node scripts/reachability.mjs");

    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("node", [scriptPath], { cwd: ROOT, encoding: "utf8" });
    expect(out).toContain("Reachability check passed");
  });
});

