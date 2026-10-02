#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const uiDir = path.resolve(rootDir, "ui/src");

const FORBIDDEN_PATTERNS = [
  {
    regex: /avgLatencyMs:\s*(238|114|79|385|242|118|82|380)\b/,
    message: "Invented average latency number in circuit state",
  },
  {
    regex: /aud_init_/,
    message: "Synthetic initial audit log ID",
  },
  {
    regex: /builder@keycollective\.io/,
    message: "Invented fallback user email address",
  },
  {
    regex: /Auto-rerouted to Key #04 in 8ms/,
    message: "Invented shield auto-reroute message",
  },
  {
    regex: /sybilScore\s*\?\?\s*92\b/,
    message: "Invented fallback Sybil trust score (92)",
  },
  {
    regex: /key\.rpm_limit\s*\|\|\s*60\b/,
    message: "Invented fallback RPM limit (60)",
  },
  {
    regex: /key\.rpd_limit\s*\|\|\s*10000\b/,
    message: "Invented fallback RPD limit (10000)",
  },
  {
    regex: /Oct 14, 2024/,
    message: "Invented hardcoded timestamp in UI",
  },
  {
    regex: /dailyUsagePercent/,
    message: "Synthetic dailyUsagePercent in UI",
  },
  {
    regex: /microdollars|micro_dollars/i,
    message: "Deprecated microdollars currency reference in UI",
  },
];

function getFilesRecursively(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.resolve(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath));
    } else if (file.endsWith(".svelte") || file.endsWith(".ts")) {
      // Exclude test files
      if (!file.includes(".test.") && !file.includes(".spec.")) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

let hasError = false;
const files = getFilesRecursively(uiDir);

for (const file of files) {
  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    for (const { regex, message } of FORBIDDEN_PATTERNS) {
      if (regex.test(line)) {
        console.error(
          `[FAIL] ${path.relative(rootDir, file)}:${idx + 1} - ${message}\n  Line: ${line.trim()}`
        );
        hasError = true;
      }
    }
  });
}

if (hasError) {
  console.error("\n❌ Found invented data / microdollars violations in UI code.");
  process.exit(1);
} else {
  console.log("✅ No invented UI literals or microdollars violations found.");
  process.exit(0);
}
