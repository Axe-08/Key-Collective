import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSeedSql } from "../../../scripts/seed_local.mjs";

describe("seed_local.mjs", () => {
  it("builds SQL seeding dev tenants alice and bob and never tenant 'default'", async () => {
    const sql = await buildSeedSql({
      geminiKeys: ["gemini-key-abc"],
      groqKeys: ["groq-key-xyz"],
    });

    expect(sql).toContain("usr_goog_dev_alice");
    expect(sql).toContain("usr_goog_dev_bob");
    expect(sql).not.toMatch(/'default'/);
  });

  it("refuses to run with --remote", () => {
    const scriptPath = path.resolve(__dirname, "../../../scripts/seed_local.mjs");
    const result = spawnSync("node", [scriptPath, "--remote"], {
      encoding: "utf-8",
    });

    expect(result.status).not.toBe(0);
  });
});
