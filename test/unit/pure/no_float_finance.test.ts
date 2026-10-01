import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

export interface Violation {
  file: string;
  line: number;
  match: string;
  rule: string;
}

export const FORBIDDEN_CU_FLOAT_RULES = [
  {
    name: "parseFloat on CU identifier",
    regex: /parseFloat\([^)]*\b\w*(?:Cu|_cu)\b[^)]*\)/g,
  },
  {
    name: "toFixed on CU identifier",
    regex: /\b\w*(?:Cu|_cu)\s*\.\s*toFixed\(/g,
  },
  {
    name: "Math.round on CU identifier",
    regex: /Math\.round\([^)]*\b\w*(?:Cu|_cu)\b[^)]*\)/g,
  },
  {
    name: "Number() on CU identifier ending in Cu or _cu",
    regex: /Number\([^)]*\b\w*(?:Cu|_cu)\b[^)]*\)/g,
  },
];

export function scanCodeForCuFloatViolations(code: string, filePath = "snippet.ts"): Violation[] {
  const violations: Violation[] = [];
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of FORBIDDEN_CU_FLOAT_RULES) {
      rule.regex.lastIndex = 0;
      const matches = line.match(rule.regex);
      if (matches) {
        for (const match of matches) {
          violations.push({
            file: filePath,
            line: i + 1,
            match,
            rule: rule.name,
          });
        }
      }
    }
  }

  return violations;
}

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".spec.ts")
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("Zero-Float CU Financial Math Integrity (T-2.1.3)", () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const targetDirs = [
    path.join(projectRoot, "src/quota"),
    path.join(projectRoot, "src/pool"),
    path.join(projectRoot, "src/router/registry"),
    path.join(projectRoot, "src/storage"),
  ];

  it("detects forbidden float operations in sample snippets", () => {
    expect(scanCodeForCuFloatViolations("const x = Number(communityDebtCu);").length).toBe(1);
    expect(scanCodeForCuFloatViolations("const r = parseFloat(daily_cu);").length).toBe(1);
    expect(scanCodeForCuFloatViolations("const s = balanceCu.toFixed(2);").length).toBe(1);
    expect(scanCodeForCuFloatViolations("const m = Math.round(usedCu);").length).toBe(1);
    expect(scanCodeForCuFloatViolations("const n = Number(communityDebtMicroCu * 100n / dailyContributedCu);").length).toBe(1);
  });

  it("permits safe integer and bigint operations in sample snippets", () => {
    expect(scanCodeForCuFloatViolations("const x = BigInt(communityDebtCu);").length).toBe(0);
    expect(scanCodeForCuFloatViolations("const r = communityDebtCu * 100n / dailyContributedCu;").length).toBe(0);
    expect(scanCodeForCuFloatViolations("const s = communityDebtCu.toString();").length).toBe(0);
  });

  it("ensures zero float operations on CU identifiers across src/quota, src/pool, src/router/registry, src/storage", () => {
    const allFiles = targetDirs.flatMap(collectSourceFiles);
    expect(allFiles.length).toBeGreaterThan(0);

    const allViolations: Violation[] = [];

    for (const file of allFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const relativePath = path.relative(projectRoot, file);
      const violations = scanCodeForCuFloatViolations(content, relativePath);
      allViolations.push(...violations);
    }

    expect(allViolations).toEqual([]);
  });
});
