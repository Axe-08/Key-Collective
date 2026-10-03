import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const WP_SH = resolve(ROOT, "scripts/wp.sh");

describe("WP-G.1 guardrails", () => {
  it("T-G.1.1: wp.sh selftest passes and forbid() includes all required rules", () => {
    const out = execFileSync("bash", [WP_SH, "selftest"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out).toContain("selftest ok");

    const script = readFileSync(WP_SH, "utf8");
    expect(script).toContain("swallowed error: log it or rethrow");
    expect(script).toContain("swallowed promise rejection");
    expect(script).toContain("type suppression");
    expect(script).toContain("skipped test");
  });
});
