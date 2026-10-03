import { describe, expect, it } from "vitest";
import { findViolations, isScanned, scan, selftest } from "../../../scripts/check-ui-literals.mjs";

// T-F.7.7 (RA-11): the UI literal guard is pattern-based, so it catches new invented data.
describe("check-ui-literals", () => {
  it("passes its own positive and negative samples", () => {
    expect(selftest()).toEqual([]);
  });

  it.each([
    ["A.svelte", "<span>Edge p50 7ms</span>", "ms-in-markup"],
    ["A.svelte", "<div>Node fra-2 via SIN-3</div>", "region-id"],
    ["a.ts", "const node = 'iad-edge-07';", "region-id"],
    ["a.ts", "const asn = 'ASN 64512';", "region-id"],
    ["a.ts", "const proof = '0123456789abcdef0123456789abcdef';", "long-hex"],
    ["a.ts", "const who = 'ops@example.org';", "email"],
    ["A.svelte", "<span>Trust <strong>87 / 100</strong></span>", "score-literal"],
  ])("flags a new invented literal in %s: %s", (file, code, rule) => {
    expect(findViolations(code, file).map((v) => v.rule)).toContain(rule);
  });

  it("does not flag ms in script code or real computed values in markup", () => {
    const code = '<script lang="ts">\n  const timeoutMs = 250; const label = "250ms";\n</script>\n<p>{latencyMs}ms</p>';
    expect(findViolations(code, "A.svelte").filter((v) => v.rule === "ms-in-markup")).toEqual([]);
  });

  it("skips tests and mocks", () => {
    expect(isScanned("lib/Foo.svelte")).toBe(true);
    expect(isScanned("lib/foo.ts")).toBe(true);
    expect(isScanned("lib/Foo.test.ts")).toBe(false);
    expect(isScanned("lib/Foo.dom.test.ts")).toBe(false);
    expect(isScanned("lib/mocks/data.ts")).toBe(false);
    expect(isScanned("test/dom_setup.ts")).toBe(false);
  });

  it("ui/src is clean, and every allowlist entry still matches", () => {
    const { violations, unusedAllowlist } = scan();
    expect(violations).toEqual([]);
    expect(unusedAllowlist).toEqual([]);
  });
});
