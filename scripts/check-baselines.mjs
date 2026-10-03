#!/usr/bin/env node
// Count baseline guard (WP-G.1 T-G.1.5)
// Counts swallows in src/, console.* calls in src/ outside src/utils/logger.ts,
// and @ts-ignore / @ts-expect-error across src/, test*, and ui/src/.
// Fails if any count exceeds scripts/baselines.json.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
let rootDir = resolve(__dirname, "..");

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--root" && args[i + 1]) {
    rootDir = resolve(args[i + 1]);
    i++;
  }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "archives") {
        continue;
      }
      walk(full, out);
    } else if (/\.(ts|tsx|js|mjs|svelte)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const baselinesPath = join(rootDir, "scripts", "baselines.json");
const baselines = JSON.parse(readFileSync(baselinesPath, "utf8"));

const srcRoot = join(rootDir, "src");
const loggerFile = join(srcRoot, "utils", "logger.ts");
const srcFiles = walk(srcRoot).filter((f) => !/\.(test|spec)\.ts$/.test(f));

const testDirs = existsSync(rootDir)
  ? readdirSync(rootDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("test"))
      .map((e) => join(rootDir, e.name))
  : [];

const tsTargetFiles = [
  ...walk(srcRoot),
  ...testDirs.flatMap((d) => walk(d)),
  ...walk(join(rootDir, "ui", "src")),
];

const VOID_ERR_RE = /void\s+_?(err|e|error)\s*;/;
const CATCH_SWALLOW_RE = /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(\{\s*\}|undefined|null)\s*\)/;
const CONSOLE_RE = /\bconsole\.(log|warn|error|info|debug|trace)\s*\(/;
const TS_SUPPRESS_RE = new RegExp("@ts-" + "(ignore|expect-error)");

let voidErr = 0;
let catchSwallow = 0;
let consoleCount = 0;
let tsSuppressions = 0;

for (const file of srcFiles) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    if (VOID_ERR_RE.test(line)) voidErr++;
    if (CATCH_SWALLOW_RE.test(line)) catchSwallow++;
    if (file !== loggerFile && CONSOLE_RE.test(line)) {
      consoleCount++;
    }
  }
}

for (const file of tsTargetFiles) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    if (TS_SUPPRESS_RE.test(line)) {
      tsSuppressions++;
    }
  }
}

const counts = {
  swallows: voidErr + catchSwallow,
  voidErr,
  catchSwallow,
  console: consoleCount,
  tsSuppressions,
};

let failed = false;
for (const [key, limit] of Object.entries(baselines)) {
  const actual = counts[key];
  if (typeof actual === "number" && actual > limit) {
    console.error(`BASELINE FAIL: ${key} count (${actual}) exceeded baseline (${limit})`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `baselines ok (swallows=${counts.swallows} [voidErr=${counts.voidErr}, catch=${counts.catchSwallow}], console=${counts.console}, tsSuppressions=${counts.tsSuppressions})`
);
